/**
 * LEASH DB bridge — implements the enforcer's storage contract over drizzle.
 *
 * Double-spend protection lives here, as single conditional updates:
 *   holdBudget: UPDATE contracts SET spent = spent + amt
 *               WHERE id = ? AND spent + amt <= budget AND status = ACTIVE
 *   holdCount:  UPDATE contracts SET refunds_used = refunds_used + 1
 *               WHERE id = ? AND refunds_used < max_refunds
 * One row changed = hold won. Zero rows = concurrent call consumed the
 * allowance; the enforcer unwinds and rejects. Works without transactions
 * (PGlite local, Neon serverless prod).
 *
 * RECONCILE: verify the db accessor shape against the scaffold's db index
 * (getDb vs direct import of a db client object).
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@agent-native/core/db";
import {
  contracts,
  contractReservations,
  contractEvents,
  type InferSelectModel,
} from "../db/schema";

type ContractRow = InferSelectModel<typeof contracts>;

export function makeLeashBridge() {
  const now = () => Date.now();
  const db = () => getDb();

  return {
    now,

    async queryContracts(contractId: string): Promise<ContractRow | undefined> {
      const [row] = await db()
        .select()
        .from(contracts)
        .where(eq(contracts.id, contractId))
        .limit(1);
      return row;
    },

    async queryReservation(requestId: string) {
      const [row] = await db()
        .select()
        .from(contractReservations)
        .where(eq(contractReservations.requestId, requestId))
        .limit(1);
      return row as import("./leash-enforce").ReservationRow | undefined;
    },

    async insertReservation(row: import("./leash-enforce").ReservationRow): Promise<void> {
      await db().insert(contractReservations).values({
        id: row.requestId,
        requestId: row.requestId,
        contractId: row.contractId,
        delegateLabel: row.delegateLabel,
        action: row.action,
        amountCents: row.amountCents ?? 0,
        outcome: row.outcome,
        status: row.status,
        createdAt: now(),
      });
    },

    async insertEvent(ev: {
      id: string; contractId: string; type: string; action: string | null;
      caller: string; amountCents: number | null; code: string | null;
      detail: string | null; createdAt: number;
    }): Promise<void> {
      await db().insert(contractEvents).values(ev);
    },

    async holdBudget(contractId: string, amount: number): Promise<boolean> {
      const updated = await db().update(contracts)
        .set({ spentCents: sql`${contracts.spentCents} + ${amount}` })
        .where(and(
          eq(contracts.id, contractId),
          eq(contracts.status, "ACTIVE"),
          sql`${contracts.spentCents} + ${amount} <= ${contracts.budgetCents}`,
        ))
        .returning({ id: contracts.id });
      return updated.length > 0;
    },

    async releaseBudget(contractId: string, amount: number): Promise<boolean> {
      const updated = await db().update(contracts)
        .set({ spentCents: sql`${contracts.spentCents} - ${amount}` })
        .where(and(eq(contracts.id, contractId), sql`${contracts.spentCents} >= ${amount}`))
        .returning({ id: contracts.id });
      return updated.length > 0;
    },

    async holdCount(contractId: string): Promise<boolean> {
      const updated = await db().update(contracts)
        .set({ refundsUsed: sql`${contracts.refundsUsed} + 1` })
        .where(and(
          eq(contracts.id, contractId),
          sql`${contracts.refundsUsed} < ${contracts.maxRefunds}`,
        ))
        .returning({ id: contracts.id });
      return updated.length > 0;
    },

    async releaseCount(contractId: string): Promise<boolean> {
      const updated = await db().update(contracts)
        .set({ refundsUsed: sql`${contracts.refundsUsed} - 1` })
        .where(and(eq(contracts.id, contractId), sql`${contracts.refundsUsed} > 0`))
        .returning({ id: contracts.id });
      return updated.length > 0;
    },

    async updateReservationStatus(requestId: string, to: string, from: string): Promise<boolean> {
      const updated = await db().update(contractReservations)
        .set({ status: to })
        .where(and(
          eq(contractReservations.requestId, requestId),
          eq(contractReservations.status, from),
        ))
        .returning({ id: contractReservations.id });
      return updated.length > 0;
    },
  };
}
