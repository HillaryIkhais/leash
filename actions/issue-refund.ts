/**
 * Issue-refund — THE HEADLINE BOUNDARY.
 * Order of operations, every call:
 *   1. approve(): idempotency -> evaluate() -> atomic budget/count holds
 *   2. side effect (recorded refund)
 *   3. settle(): hold becomes permanent spend
 * Rejections throw ActionContractError — the framework surfaces the error
 * code identically across UI, agent tool-result, HTTP and MCP surfaces.
 */
import { defineAction, ActionContractError } from "@agent-native/core/action";
import { getDb } from "@agent-native/core/db";
import { z } from "zod";
import { supportCases, contractEvents } from "../server/db/schema";
import { leash } from "../server/lib/leash";
import { resolveCaller } from "../server/lib/leash-caller";
import { eq } from "drizzle-orm";

export default defineAction({
  description:
    "Issue a refund for the case's order. Requires an active contract permitting 'issue-refund' with sufficient budget and remaining refund count.",
  schema: z.object({
    caseId: z.string(),
    amountCents: z.number().int().positive().describe("Refund amount in cents"),
    requestId: z.string().describe("Caller-provided idempotency key"),
    childLabel: z.string().optional().describe("Declared identity of a child agent executing this call"),
  }),
  run: async (input, ctx) => {
    const caller = resolveCaller(input, ctx);

    const approval = await leash.approve(input.caseId, {
      action: "issue-refund",
      amountCents: input.amountCents,
      refund: true,
      now: Date.now(),
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

    // ---- side effect begins ----
    const db = getDb();
    const refundId = `rf_${crypto.randomUUID()}`;
    const [victim] = await db.select().from(supportCases).where(eq(supportCases.id, input.caseId)).limit(1);

    await db.insert(contractEvents).values({
      id: `ev_${crypto.randomUUID()}`,
      contractId: input.caseId,
      type: "REFUND_ISSUED",
      action: "issue-refund",
      caller,
      amountCents: input.amountCents,
      code: null,
      detail: JSON.stringify({ refundId, orderRef: victim?.orderRef ?? "unknown" }),
      createdAt: Date.now(),
    });
    // ---- side effect ends ----

    await leash.settle(input.requestId);
    return { ok: true, receiptId: approval.receiptId, refundId, remainingCents: approval.decision?.remainingCents };
  },
});
