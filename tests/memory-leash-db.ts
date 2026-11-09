/**
 * In-memory LEASH DB — implements EXACTLY the same conditional-update
 * semantics as the drizzle bridge (server/lib/leash-db-bridge.ts):
 * one synchronous compare-and-set per hold, so concurrent approvers race
 * through genuine microtask interleaving and the loser sees zero rows.
 *
 * Used by the enforcer test suite and the offline demo. The production
 * enforcer runs unchanged against the drizzle bridge over PGlite/Postgres.
 */
import type { LeashRow, ReservationRow } from "../server/lib/leash-enforce";

export class MemoryLeashDB {
  contracts = new Map<string, LeashRow>();
  delegates = new Map<string, { label: string; permittedActions: string; maxRefunds: number; budgetCapCents: number }>();
  reservations = new Map<string, ReservationRow>();
  events: Array<{
    id: string; contractId: string; type: string; action: string | null;
    caller: string; amountCents: number | null; code: string | null;
    detail: string | null; createdAt: number;
  }> = [];
  /** side effects recorded outside the gate — the enforcer must never let a forbidden one through */
  sideEffects: Array<{ action: string; requestId: string; amountCents: number }> = [];
  clock: number;

  constructor(clock = 1_700_000_000_000) {
    this.clock = clock;
  }

  now(): number {
    return this.clock;
  }

  seedContract(id: string, over: Partial<LeashRow> = {}) {
    this.contracts.set(id, {
      id,
      status: "ACTIVE",
      budgetCents: 2500,
      spentCents: 0,
      maxRefunds: 1,
      refundsUsed: 0,
      permittedActions: JSON.stringify(["inspect-order", "issue-refund", "draft-response"]),
      forbiddenActions: JSON.stringify(["change-account-owner"]),
      expiresAt: this.clock + 600_000,
      ...over,
    } as LeashRow);
  }

  async queryContracts(contractId: string): Promise<LeashRow | undefined> {
    return this.contracts.get(contractId);
  }

  seedDelegate(contractId: string, label: string, over: { permittedActions?: string[]; maxRefunds?: number; budgetCapCents?: number } = {}) {
    this.delegates.set(`${contractId}::${label}`, {
      label,
      permittedActions: JSON.stringify(over.permittedActions ?? ["inspect-order"]),
      maxRefunds: over.maxRefunds ?? 0,
      budgetCapCents: over.budgetCapCents ?? 0,
    });
  }

  async queryDelegate(contractId: string, label: string) {
    return this.delegates.get(`${contractId}::${label}`);
  }

  async queryReservation(requestId: string): Promise<ReservationRow | undefined> {
    return this.reservations.get(requestId);
  }

  async insertReservation(row: ReservationRow): Promise<void> {
    if (this.reservations.has(row.requestId)) {
      // same failure a real database raises on the unique request_id column
      throw new Error("UNIQUE constraint failed: contract_reservations.request_id");
    }
    this.reservations.set(row.requestId, { ...row });
  }

  async insertEvent(ev: (typeof this.events)[number]): Promise<void> {
    this.events.push({ ...ev });
  }

  /** UPDATE ... WHERE id=? AND status='ACTIVE' AND spent+amt<=budget — one row or zero. */
  async holdBudget(contractId: string, amount: number): Promise<boolean> {
    const c = this.contracts.get(contractId);
    if (!c) return false;
    if (c.status !== "ACTIVE") return false;
    if (c.spentCents + amount > c.budgetCents) return false;
    c.spentCents += amount;
    return true;
  }

  async releaseBudget(contractId: string, amount: number): Promise<boolean> {
    const c = this.contracts.get(contractId);
    if (!c || c.spentCents < amount) return false;
    c.spentCents -= amount;
    return true;
  }

  /** UPDATE ... WHERE id=? AND refunds_used<max_refunds — one row or zero. */
  async holdCount(contractId: string): Promise<boolean> {
    const c = this.contracts.get(contractId);
    if (!c || c.refundsUsed >= c.maxRefunds) return false;
    c.refundsUsed += 1;
    return true;
  }

  async releaseCount(contractId: string): Promise<boolean> {
    const c = this.contracts.get(contractId);
    if (!c || c.refundsUsed <= 0) return false;
    c.refundsUsed -= 1;
    return true;
  }

  async updateReservationStatus(requestId: string, to: string, from: string): Promise<boolean> {
    const r = this.reservations.get(requestId);
    if (!r || r.status !== from) return false;
    r.status = to;
    return true;
  }

  eventsOf(contractId: string, type: string) {
    return this.events.filter((e) => e.contractId === contractId && e.type === type);
  }
}
