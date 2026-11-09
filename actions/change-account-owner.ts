/**
 * Change-account-owner — THE FORBIDDEN BEAT.
 * Callable from every surface; RBAC admits it; the run contract denies it.
 * Every attempt becomes a REJECTED receipt with code forbidden_action.
 */
import { defineAction, ActionContractError } from "@agent-native/core/action";
import { z } from "zod";
import { leash } from "../server/lib/leash";
import { resolveCaller } from "../server/lib/leash-caller";

export default defineAction({
  description:
    "Transfer account ownership for the case. Normally forbidden under a support run contract; every attempt is recorded.",
  schema: z.object({
    caseId: z.string(),
    requestId: z.string(),
    newOwner: z.string().describe("Who the account is being transferred to"),
  }),
  run: async (input, ctx) => {
    const caller = resolveCaller(input, ctx);
    const approval = await leash.approve(input.caseId, {
      action: "change-account-owner",
      amountCents: 0,
      refund: false,
      now: Date.now(),
      requestId: input.requestId,
    }, { caller });

    if (approval.outcome === "replayed") return { ok: true, replayed: true, earlier: approval.replayOf };
    if (approval.outcome === "rejected") {
      throw new ActionContractError(approval.decision?.message ?? "contract rejected", {
        errorCode: approval.decision?.code ?? "contract_rejected",
        details: { caller, action: "change-account-owner" },
      });
    }
    await leash.settle(input.requestId);
    return { ok: true, receiptId: approval.receiptId, owner: input.newOwner };
  },
});
