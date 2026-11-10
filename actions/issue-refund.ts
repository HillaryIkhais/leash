/**
 * Issue-refund — THE HEADLINE BOUNDARY.
 * Order of operations, every call:
 *   1. approve(): idempotency -> evaluate() -> atomic budget/count holds
 *   2. side effect (recorded refund)
 *   3. settle(): hold becomes permanent spend
 *   On side-effect failure: release() returns the allowance
 * Rejections throw ActionContractError — the framework surfaces the error
 * code identically across UI, agent tool-result, HTTP and MCP surfaces.
 *
 * DELEGATION: Child agent identity is now verified by the framework's
 * delegation context. The caller string "subagent:<label>" is extracted
 * from the framework-verified delegationDepth and matched against the
 * contractDelegates registry. Caller-supplied childLabel is IGNORED.
 */
import { defineAction, ActionContractError } from "@agent-native/core/action";
import { getDb } from "../server/db";
import { z } from "zod";
import { supportCases, contractEvents, contractReservations } from "../server/db/schema";
import { approveForCase, leash } from "../server/lib/leash";
import { resolveCaller } from "../server/lib/leash-caller";
import { eq } from "drizzle-orm";

export default defineAction({
  description:
    "Issue a refund for the case's order. Requires an active contract permitting 'issue-refund' with sufficient budget and remaining refund count.",
  schema: z.object({
    caseId: z.string(),
    amountCents: z.number().int().positive().describe("Refund amount in cents"),
    requestId: z.string().describe("Caller-provided idempotency key"),
  }),
  run: async (input, ctx) => {
    const caller = resolveCaller(input, ctx);

    const approval = await approveForCase(input.caseId, {
      action: "issue-refund",
      amountCents: input.amountCents,
      refund: true,
      requestId: input.requestId,
    }, { caller });

    if (approval.outcome === "replayed") {
      return { ok: true, replayed: true, earlier: approval.replayOf };
    }
    if (approval.outcome === "rejected") {
      throw new ActionContractError(approval.decision?.message ?? "contract rejected", {
        errorCode: approval.decision?.code ?? "contract_rejected",
        details: { caller, action: "issue-refund", amountCents: input.amountCents },
      });
    }

    // Side effect with proper reservation lifecycle:
    // - On success: settle() makes the hold permanent
    // - On failure: release() returns the allowance
    let settled = false;
    try {
      const db = getDb();
      const refundId = `rf_${crypto.randomUUID()}`;
      const [victim] = await db.select().from(supportCases).where(eq(supportCases.id, input.caseId)).limit(1);
      const [receipt] = await db.select()
        .from(contractReservations)
        .where(eq(contractReservations.requestId, input.requestId))
        .limit(1);

      await db.insert(contractEvents).values({
        id: `ev_${crypto.randomUUID()}`,
        contractId: receipt?.contractId ?? approval.receiptId ?? input.caseId,
        type: "REFUND_ISSUED",
        action: "issue-refund",
        caller,
        amountCents: input.amountCents,
        code: null,
        detail: JSON.stringify({ refundId, orderRef: victim?.orderRef ?? "unknown" }),
        createdAt: Date.now(),
      });

      settled = true;
      await leash.settle(input.requestId);
      return { ok: true, receiptId: approval.receiptId, refundId: `rf_${crypto.randomUUID()}`, remainingCents: approval.decision?.remainingCents };
    } finally {
      if (!settled) {
        // Side effect failed — release the reservation so allowance returns
        await leash.release(input.requestId);
      }
    }
  },
});