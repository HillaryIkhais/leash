/**
 * Inspect-order — read path through the same gate. Even reads receive
 * receipts: the run board shows the whole decision surface uniformly.
 * Money does not move; enforced for presence/quota/expiry only.
 */
import { defineAction } from "@agent-native/core/action";
import { getDb } from "../server/db";
import { z } from "zod";
import { supportCases } from "../server/db/schema";
import { leash, approveForCase } from "../server/lib/leash";
import { resolveCaller } from "../server/lib/leash-caller";
import { eq } from "drizzle-orm";

export default defineAction({
  description: "Inspect the order attached to the support case. Requires an active contract permitting 'inspect-order'.",
  schema: z.object({
    caseId: z.string(),
    requestId: z.string().describe("Caller-provided idempotency key"),
  }),
  run: async (input, ctx) => {
    const approval = await approveForCase(input.caseId, {
      action: "inspect-order",
      amountCents: 0,
      refund: false,
      requestId: input.requestId,
    }, { caller: resolveCaller(input, ctx) });

    if (approval.outcome === "replayed") {
      return { ok: true, replayed: true, earlier: approval.replayOf };
    }
    if (approval.outcome === "rejected") {
      return {
        ok: false,
        rejected: true,
        code: approval.decision?.code,
        message: approval.decision?.message,
      };
    }

    // Side effect: pure read — no budget/count holds, but still settle for receipt
    let settled = false;
    try {
      const [order] = await getDb()
        .select()
        .from(supportCases)
        .where(eq(supportCases.id, input.caseId))
        .limit(1);

      settled = true;
      await leash.settle(input.requestId);
      return { ok: true, receiptId: approval.receiptId, order };
    } finally {
      if (!settled) {
        await leash.release(input.requestId);
      }
    }
  },
});