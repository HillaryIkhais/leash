/**
 * Get-run — the control room's data feed. One action returns the live
 * contract, delegate roster, exposed budget posture, and the immutable
 * receipt ledger. The UI, the agent's own introspection, and MCP clients
 * all read the same truth.
 */
import { defineAction } from "@agent-native/core/action";
import { getDb } from "../server/db";
import { z } from "zod";
import { contracts, contractDelegates, contractEvents, contractReservations, supportCases } from "../server/db/schema";
import { desc, eq } from "drizzle-orm";

export default defineAction({
  description: "Read the live state of a run contract: limits, delegates, receipts timeline.",
  schema: z.object({ contractId: z.string() }),
  run: async ({ contractId }) => {
    const db = getDb();
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId)).limit(1);
    if (!contract) return { ok: false, error: "contract not found" };

    const [kids, events, reservations, [supportCase]] = await Promise.all([
      db.select().from(contractDelegates).where(eq(contractDelegates.contractId, contractId)),
      db.select().from(contractEvents).where(eq(contractEvents.contractId, contractId)).orderBy(desc(contractEvents.createdAt)).limit(100),
      db.select().from(contractReservations).where(eq(contractReservations.contractId, contractId)),
      db.select().from(supportCases).where(eq(supportCases.id, contract.caseId)).limit(1),
    ]);

    return {
      ok: true,
      contract: {
        ...contract,
        permittedActions: JSON.parse(contract.permittedActions),
        forbiddenActions: JSON.parse(contract.forbiddenActions),
        remainingCents: contract.budgetCents - contract.spentCents,
      },
      case: supportCase,
      delegates: kids.map((k) => ({ ...k, permittedActions: JSON.parse(k.permittedActions) })),
      receipts: events,
      reservations: reservations.length,
    };
  },
});
