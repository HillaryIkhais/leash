/**
 * LEASH enforcement wrapper.
 *
 * Wraps the pure engine with the DB truth:
 *   - replay detection by requestId (idempotency)
 *   - atomic budget hold: conditional single-statement UPDATE
 *       UPDATE contracts SET spent_cents = spent_cents + amt
 *       WHERE id = ? AND spent_cents + amt <= budget_cents
 *     Two concurrent calls cannot both spend the last allowance — one
 *     conditional update wins, the loser sees zero rows changed and is
 *     rejected. No transaction primitives required (works identically on
 *     PGlite locally and Neon serverless in production).
 *   - atomic count hold, same pattern for maxRefunds; bounded rollback:
 *     count first, then money; if money is lost, count is released.
 *   - after approval the caller performs the side effect; then either
 *     settle() (kept) or release() (side effect failed, allowance back).
 *
 * RECONCILE on scaffold landing: db client import + drizzle helpers.
 * Written against a minimal interface so it can be typed and reviewed
 * before the scaffold exists.
 */

import {
  evaluate,
  checkAttenuation,
  type LeashCallRequest,
  type LeashDecision,
  type LeashErrorCode,
  type LeashSnapshot,
} from "./leash-engine";
import { CONTRACT_STATUS, RESERVATION_STATUS, EVENT_TYPE } from "./leash-constants";

export interface LeashRow {
  id: string;
  status: string;
  budgetCents: number;
  spentCents: number;
  maxRefunds: number;
  refundsUsed: number;
  permittedActions: string; // JSON
  forbiddenActions: string; // JSON
  expiresAt: number;
}

export interface ReservationRow {
  requestId: string;
  contractId: string;
  delegateLabel: string | null;
  action: string;
  amountCents: number;
  outcome: string; // "APPROVED" | "REJECTED:<code>"
  status: string; // HELD | SETTLED | REFUNDED
}

export interface LeashContext {
  caller: string; // frontend | root-agent | subagent:<label> | mcp:<label> | http | cli
}

export interface ApproveResult {
  outcome: "approved" | "rejected" | "replayed";
  decision?: LeashDecision;
  replayOf?: string; // prior outcome code on replay
  receiptId?: string; // reservation id when approved
}

/**
 * Everything an action's run() MUST call before any side effect:
 *   const approval = await leash.approve(contractId, req, ctx);
 *   if (approval.outcome !== "approved") return fail(approval...)
 */
export class LeashEnforcer {
  constructor(
    private db: {
      queryContracts: (contractId: string) => Promise<LeashRow | undefined>;
      queryReservation: (requestId: string) => Promise<ReservationRow | undefined>;
      insertReservation: (row: ReservationRow) => Promise<void>;
      insertEvent: (row: {
        id: string;
        contractId: string;
        type: string;
        action: string | null;
        caller: string;
        amountCents: number | null;
        code: string | null;
        detail: string | null;
        createdAt: number;
      }) => Promise<void>;
      holdBudget: (contractId: string, amount: number) => Promise<boolean>;
      releaseBudget: (contractId: string, amount: number) => Promise<boolean>;
      holdCount: (contractId: string) => Promise<boolean>;
      releaseCount: (contractId: string) => Promise<boolean>;
      now: () => number;
    },
  ) {}

  async approve(
    contractId: string,
    req: LeashCallRequest,
    ctx: LeashContext,
  ): Promise<ApproveResult> {
    const now = this.db.now();

    // 0. idempotency — same requestId never executes twice.
    const prior = await this.db.queryReservation(req.requestId);
    if (prior) {
      await this.insertEventSafe(prior.contractId, {
        type: EVENT_TYPE.REPLAYED,
        action: prior.action,
        caller: ctx.caller,
        amountCents: prior.amountCents,
        code: prior.outcome,
        detail: JSON.stringify({ request_id: req.requestId }),
        createdAt: now,
      });
      return { outcome: "replayed", replayOf: prior.outcome };
    }

    const row = await this.db.queryContracts(contractId);
    const snap: LeashSnapshot = row
      ? {
          status: row.status,
          budgetCents: row.budgetCents,
          spentCents: row.spentCents,
          maxRefunds: row.maxRefunds,
          refundsUsed: row.refundsUsed,
          permittedActions: JSON.parse(row.permittedActions),
          forbiddenActions: JSON.parse(row.forbiddenActions),
          expiresAt: row.expiresAt,
        }
      : (undefined as unknown as LeashSnapshot);

    const decision = evaluate(snap, req);
    const reservation: ReservationRow = {
      requestId: req.requestId,
      contractId,
      delegateLabel: ctx.caller.startsWith("subagent:")
        ? ctx.caller.slice("subagent:".length)
        : null,
      action: req.action,
      amountCents: req.amountCents ?? 0,
      outcome: decision.ok ? "APPROVED" : `REJECTED:${decision.code}`,
      status: RESERVATION_STATUS.HELD,
    };

    if (!decision.ok) {
      await this.db.insertReservation(reservation);
      await this.insertEventSafe(contractId, {
        type: EVENT_TYPE.REJECTED,
        action: req.action,
        caller: ctx.caller,
        amountCents: req.amountCents ?? 0,
        code: decision.code,
        detail: JSON.stringify({ message: decision.message }),
        createdAt: now,
      });
      return { outcome: "rejected", decision };
    }

    // APPROVED path. Count first, then money (cheapest to roll back last).
    let heldCount = false;
    let heldMoney = false;
    if (req.refund) {
      heldCount = await this.db.holdCount(contractId);
      if (!heldCount) {
        const raced: LeashDecision = {
          ok: false,
          code: "count_limit_exceeded",
          message: `maxRefunds ${snap.maxRefunds} already consumed`,
        };
        await this.db.insertReservation({
          ...reservation,
          outcome: `REJECTED:${raced.code}`,
        });
        await this.insertEventSafe(contractId, {
          type: EVENT_TYPE.REJECTED,
          action: req.action,
          caller: ctx.caller,
          amountCents: req.amountCents ?? 0,
          code: raced.code,
          detail: JSON.stringify({ message: raced.message, crash: "count race lost" }),
          createdAt: now,
        });
        return { outcome: "rejected", decision: raced };
      }
    }
    if ((req.amountCents ?? 0) > 0) {
      heldMoney = await this.db.holdBudget(contractId, req.amountCents ?? 0);
      if (!heldMoney) {
        // unwind the count hold — bounded rollback, no tx needed
        if (heldCount) await this.db.releaseCount(contractId);
        const raced: LeashDecision = {
          ok: false,
          code: "budget_exceeded",
          message: "concurrent call consumed the remaining allowance",
        };
        await this.db.insertReservation({
          ...reservation,
          outcome: `REJECTED:${raced.code}`,
        });
        await this.insertEventSafe(contractId, {
          type: EVENT_TYPE.REJECTED,
          action: req.action,
          caller: ctx.caller,
          amountCents: req.amountCents ?? 0,
          code: raced.code,
          detail: JSON.stringify({ message: raced.message, crash: "budget race lost" }),
          createdAt: now,
        });
        return { outcome: "rejected", decision: raced };
      }
    }

    await this.db.insertReservation(reservation);
    await this.insertEventSafe(contractId, {
      type: EVENT_TYPE.EXECUTED,
      action: req.action,
      caller: ctx.caller,
      amountCents: req.amountCents ?? 0,
      code: null,
      detail: JSON.stringify({
        remainingCents: decision.remainingCents,
        request_id: req.requestId,
      }),
      createdAt: now,
    });
    return { outcome: "approved", decision, receiptId: req.requestId };
  }

  /** Side effect succeeded — the hold becomes permanent spend. */
  async settle(requestId: string): Promise<boolean> {
    return this.db.updateReservationStatus(requestId, RESERVATION_STATUS.SETTLED, RESERVATION_STATUS.HELD);
  }

  /** Side effect failed — allowance returns. Receipt stays (RELEASED event). */
  async release(requestId: string): Promise<boolean> {
    const res = await this.db.queryReservation(requestId);
    if (!res || res.outcome !== "APPROVED" || res.status !== RESERVATION_STATUS.HELD) return false;
    if (!this.db.updateReservationStatus(requestId, RESERVATION_STATUS.REFUNDED, RESERVATION_STATUS.HELD)) {
      return false;
    }
    if (res.amountCents > 0) await this.db.releaseBudget(res.contractId, res.amountCents);
    if (isRefundAction(res.action)) await this.db.releaseCount(res.contractId);
    await this.insertEventSafe(res.contractId, {
      type: EVENT_TYPE.RELEASED,
      action: res.action,
      caller: "system",
      amountCents: res.amountCents,
      code: "released_after_failure",
      detail: JSON.stringify({ request_id: requestId }),
      createdAt: this.db.now(),
    });
    return true;
  }

  private async insertEventSafe(contractId: string, ev: {
    type: string; action: string | null; caller: string;
    amountCents: number | null; code: string | null; detail: string | null; createdAt: number;
  }) {
    // events ledger only appends; if the contract row itself is absent
    // (not_found rejection), the ledger write is skipped silently.
    try {
      await this.db.insertEvent({ id: cryptoLikeId(), contractId, ...ev });
    } catch {
      /* ledger best-effort for not-found contracts */
    }
  }
}

function isRefundAction(action: string): boolean {
  return action === "issue-refund"; // kept in one place, reconciled with actions
}

function cryptoLikeId(): string {
  // crypto.randomUUID is available in Node >= 14.17 / browsers
  return globalThis.crypto.randomUUID();
}

export { checkAttenuation, evaluate };
export type { LeashErrorCode };
