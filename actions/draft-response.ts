/**
 * Draft-response — the "correctly permitted" beat: no money moves, the
 * caller is allowed and receives an EXECUTED receipt. Proves enforcement
 * admits legitimate work, not everything.
 *
 * DELEGATION: Child agent identity is now verified by the framework's
 * delegation context. The caller string "subagent:<label>" is extracted
 * from the framework-verified delegationDepth and matched against the
 * contractDelegates registry. Caller-supplied childLabel is IGNORED.
 */
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { approveForCase, leash } from "../server/lib/leash";
import { resolveCaller } from "../server/lib/leash-caller";

export default defineAction({
  description: "Draft a customer response for the case. Requires an active contract permitting 'draft-response'.",
  schema: z.object({
    caseId: z.string(),
    requestId: z.string(),
    draft: z.string().min(1).describe("The drafted customer response"),
  }),
  run: async (input, ctx) => {
    const caller = resolveCaller(input, ctx);
    const approval = await approveForCase(input.caseId, {
      action: "draft-response",
      amountCents: 0,
      refund: false,
      requestId: input.requestId,
    }, { caller });

    if (approval.outcome === "replayed") return { ok: true, replayed: true, earlier: approval.replayOf };
    if (approval.outcome === "rejected") {
      return { ok: false, rejected: true, code: approval.decision?.code, message: approval.decision?.message };
    }

    let settled = false;
    try {
      await leash.settle(input.requestId);
      settled = true;
      return { ok: true, receiptId: approval.receiptId, stored: input.draft };
    } finally {
      if (!settled) {
        await leash.release(input.requestId);
      }
    }
  },
});