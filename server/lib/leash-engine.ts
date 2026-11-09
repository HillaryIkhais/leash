/**
 * LEASH pure evaluation engine.
 *
 * No DB, no IO — a decision function over an immutable snapshot of the
 * run contract. This is the part that must survive adversarial tests,
 * so it stays small, total (never throws), and integer-exact.
 *
 * Check order is the enforcement discipline — terminal-literal first,
 * money last:
 *   1. revoked        -> contract_revoked
 *   2. expired        -> contract_expired
 *   3. forbidden      -> forbidden_action
 *   4. not permitted  -> action_not_permitted
 *   5. count limit    -> count_limit_exceeded
 *   6. budget         -> budget_exceeded
 *
 * The framework decides whether a caller may call an action (static RBAC,
 * checked before run()). LEASH decides whether THIS RUN may continue
 * (cumulative, per-contract, evaluated here at every side effect).
 */

export type LeashErrorCode =
  | "contract_not_found"
  | "contract_revoked"
  | "contract_expired"
  | "forbidden_action"
  | "action_not_permitted"
  | "count_limit_exceeded"
  | "budget_exceeded"
  | "delegate_attenuation_violation"
  | "delegate_not_found"
  | "delegate_envelope_violation";

export interface LeashSnapshot {
  status: string; // ACTIVE | REVOKED | EXPIRED
  budgetCents: number;
  spentCents: number;
  maxRefunds: number;
  refundsUsed: number;
  permittedActions: string[];
  forbiddenActions: string[];
  expiresAt: number; // epoch ms
}

export interface LeashCallRequest {
  action: string;
  /** caller-provided idempotency key; same key replays the earlier receipt */
  requestId: string;
  /** money this call would move, cents; 0 for reads */
  amountCents?: number;
  /** refund-type actions consume one of maxRefunds */
  refund?: boolean;
}

/** The engine's input: a call request plus the ENFORCER's trusted clock. */
export type TimedLeashCallRequest = LeashCallRequest & { now: number };

export interface LeashApproval {
  ok: true;
  /** cents to reserve (same as requested amount) */
  reserveCents: number;
  /** remaining allowance after this reservation */
  remainingCents: number;
}

export interface LeashRejection {
  ok: false;
  code: LeashErrorCode;
  message: string;
}

export type LeashDecision = LeashApproval | LeashRejection;

/**
 * Attenuation: a child envelope may only ever be a strict subset of the
 * parent envelope it descends from. Called at delegation time, before a
 * child delegate row is written.
 */
export function checkAttenuation(
  parent: {
    permittedActions: string[];
    maxRefunds: number;
    budgetCents: number;
    expiresAt: number;
  },
  child: {
    permittedActions: string[];
    maxRefunds: number;
    budgetCents: number;
    expiresAt: number;
  },
): { ok: true } | { ok: false; code: LeashErrorCode; message: string } {
  const notInParent = child.permittedActions.filter(
    (a) => !parent.permittedActions.includes(a),
  );
  if (notInParent.length > 0) {
    return {
      ok: false,
      code: "delegate_attenuation_violation",
      message: `child attempts to gain actions the parent never held: ${notInParent.join(", ")}`,
    };
  }
  if (child.maxRefunds > parent.maxRefunds) {
    return {
      ok: false,
      code: "delegate_attenuation_violation",
      message: `child refund count ${child.maxRefunds} exceeds parent ${parent.maxRefunds}`,
    };
  }
  if (child.budgetCents > parent.budgetCents) {
    return {
      ok: false,
      code: "delegate_attenuation_violation",
      message: `child budget ${child.budgetCents}c exceeds parent ${parent.budgetCents}c`,
    };
  }
  if (child.maxRefunds < 0 || child.budgetCents < 0) {
    return {
      ok: false,
      code: "delegate_attenuation_violation",
      message: "negative child limits",
    };
  }
  return { ok: true };
}

export function evaluate(snap: LeashSnapshot, req: TimedLeashCallRequest): LeashDecision {
  // A missing snapshot is the caller's fault (no contract for this case).
  if (!snap) {
    return { ok: false, code: "contract_not_found", message: "no run contract for this case" };
  }

  // 1. revoked — revocation kills held authorizations immediately;
  //    there is no token-of-grace for previously approved callers.
  if (snap.status === "REVOKED") {
    return { ok: false, code: "contract_revoked", message: "run contract revoked by issuer" };
  }

  // 2. expired
  if (snap.status === "EXPIRED" || req.now >= snap.expiresAt) {
    return { ok: false, code: "contract_expired", message: "run contract expired" };
  }

  // 3. forbidden — explicit denial list beats the permit list
  if (snap.forbiddenActions.includes(req.action)) {
    return {
      ok: false,
      code: "forbidden_action",
      message: `${req.action} is forbidden under this run contract`,
    };
  }

  // 4. not permitted
  if (!snap.permittedActions.includes(req.action)) {
    return {
      ok: false,
      code: "action_not_permitted",
      message: `${req.action} is not in the permitted set`,
    };
  }

  // 5. count limit (refund-type actions)
  if (req.refund && snap.refundsUsed >= snap.maxRefunds) {
    return {
      ok: false,
      code: "count_limit_exceeded",
      message: `refund ${snap.refundsUsed + 1} exceeds maxRefunds ${snap.maxRefunds}`,
    };
  }

  // 6. budget — integer cents; the wall is spent+amount <= budget.
  const amount = req.amountCents ?? 0;
  if (amount < 0) {
    return { ok: false, code: "forbidden_action", message: "negative amount" };
  }
  if (snap.spentCents + amount > snap.budgetCents) {
    return {
      ok: false,
      code: "budget_exceeded",
      message: `total $${fmt(snap.spentCents + amount)} exceeds the $${fmt(snap.budgetCents)} ceiling`,
    };
  }

  return {
    ok: true,
    reserveCents: amount,
    remainingCents: snap.budgetCents - snap.spentCents - amount,
  };
}

function fmt(cents: number): string {
  return (cents / 100).toFixed(2);
}
