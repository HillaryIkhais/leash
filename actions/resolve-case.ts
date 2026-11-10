/**
 * Resolve-case — AUTONOMOUS AGENT WORKFLOW.
 * The agent receives a support case, inspects the order, determines resolution,
 * executes permitted actions through LEASH, and produces a complete resolution outcome.
 * All actions go through LEASH enforcement with framework-verified caller identity.
 *
 * HONESTY: The resolution status reflects actual execution outcomes.
 * - "resolved_with_refund": all required actions succeeded, refund executed
 * - "resolved_no_refund": all required actions succeeded, no refund warranted
 * - "partial_refund_rejected": refund rejected by LEASH (budget/count), response drafted
 * - "partial_response_failed": response drafting failed
 * - "failed": required action (inspect-order) failed
 */
import { defineAction, ActionContractError } from "@agent-native/core/action";
import { getDb } from "../server/db";
import { z } from "zod";
import { supportCases, contractEvents, contracts } from "../server/db/schema";
import { approveForCase, leash, resolveContractForCase } from "../server/lib/leash";
import { resolveCaller } from "../server/lib/leash-caller";
import { eq, desc } from "drizzle-orm";

const RESOLUTION_STEPS = [
  "inspect-order",
  "determine-resolution",
  "execute-refund",
  "draft-response",
  "close-case",
] as const;

export default defineAction({
  description:
    "Autonomously resolve a support case through LEASH-governed actions. The agent inspects the order, determines the appropriate resolution, attempts refunds (LEASH enforces authority), drafts customer response, and closes the case. Resolution status honestly reflects which actions succeeded or failed.",
  schema: z.object({
    caseId: z.string().describe("Support case to resolve"),
    requestIdPrefix: z.string().default("resolve").describe("Prefix for idempotency keys"),
  }),
  run: async (input, ctx) => {
    const db = getDb();
    const prefix = input.requestIdPrefix;
    const now = Date.now();

    // Derive caller from framework execution context — NOT hardcoded
    const caller = resolveCaller({}, ctx);

    // Get the case details
    const [supportCase] = await db
      .select()
      .from(supportCases)
      .where(eq(supportCases.id, input.caseId))
      .limit(1);

    if (!supportCase) {
      throw new ActionContractError("Support case not found", {
        errorCode: "case_not_found",
        details: { caseId: input.caseId },
      });
    }

    // Get the active contract for this case
    const contractId = await resolveContractForCase(input.caseId);
    if (!contractId) {
      throw new ActionContractError("No active run contract for this case", {
        errorCode: "contract_not_found",
        details: { caseId: input.caseId },
      });
    }

    const [contract] = await db
      .select()
      .from(contracts)
      .where(eq(contracts.id, contractId))
      .limit(1);

    if (!contract || contract.status !== "ACTIVE") {
      throw new ActionContractError("Run contract is not active", {
        errorCode: "contract_not_active",
        details: { contractId, status: contract?.status },
      });
    }

    const resolution: {
      step: string;
      action: string;
      requestId: string;
      outcome: "approved" | "rejected" | "replayed";
      details: any;
      timestamp: number;
    }[] = [];

    let refundExecuted = false;
    let refundAmount = 0;
    let customerResponse = "";
    let resolutionReason = "";
    let inspectSucceeded = false;
    let refundSucceeded = false;
    let responseSucceeded = false;

    // STEP 1: Inspect the order (REQUIRED)
    const inspectRequestId = `${prefix}-inspect-${now}`;
    const inspectApproval = await approveForCase(input.caseId, {
      action: "inspect-order",
      amountCents: 0,
      refund: false,
      requestId: inspectRequestId,
    }, { caller });

    resolution.push({
      step: "inspect-order",
      action: "inspect-order",
      requestId: inspectRequestId,
      outcome: inspectApproval.outcome,
      details: inspectApproval.outcome === "approved" ? { order: supportCase } : inspectApproval.decision,
      timestamp: Date.now(),
    });

    if (inspectApproval.outcome === "approved") {
      await leash.settle(inspectRequestId);
      inspectSucceeded = true;
    }

    // If inspect fails, the resolution cannot proceed honestly
    if (!inspectSucceeded) {
      const failStatus = "failed";
      await db.update(supportCases)
        .set({ 
          status: failStatus,
          resolvedAt: Date.now(),
          resolutionRefundCents: 0,
          resolutionReason: "Required action 'inspect-order' failed: " + inspectApproval.decision?.message,
        })
        .where(eq(supportCases.id, input.caseId));

      await db.insert(contractEvents).values({
        id: `ev_${crypto.randomUUID()}`,
        contractId,
        type: "CASE_RESOLVED",
        action: "close-case",
        caller,
        amountCents: 0,
        code: "inspect_failed",
        detail: JSON.stringify({
          resolutionStatus: failStatus,
          refundAmountCents: 0,
          customerResponse: "",
          resolutionReason: "Required action 'inspect-order' failed",
          failedStep: "inspect-order",
        }),
        createdAt: Date.now(),
      });

      return {
        ok: true,
        caseId: input.caseId,
        contractId,
        resolution: {
          status: failStatus,
          refundAmountCents: 0,
          customerResponse: "",
          resolutionReason: "Required action 'inspect-order' failed",
          steps: resolution,
        },
      };
    }

    // STEP 2: Determine resolution based on complaint and order
    // The agent analyzes the complaint and decides on a refund amount
    // NO agent-side cap — let LEASH enforce the contract budget
    const complaint = supportCase.complaint.toLowerCase();
    let determinedRefundCents = 0;

    if (complaint.includes("damaged") || complaint.includes("broken") || complaint.includes("snap")) {
      // Full refund for damaged items — may exceed contract budget, LEASH will reject
      determinedRefundCents = supportCase.orderTotalCents;
      resolutionReason = "Item arrived damaged - full refund warranted";
    } else if (complaint.includes("late") || complaint.includes("delay")) {
      // 50% refund for late delivery
      determinedRefundCents = Math.floor(supportCase.orderTotalCents * 0.5);
      resolutionReason = "Late delivery - partial refund warranted";
    } else if (complaint.includes("wrong") || complaint.includes("incorrect")) {
      // Full refund for wrong item
      determinedRefundCents = supportCase.orderTotalCents;
      resolutionReason = "Wrong item shipped - full refund warranted";
    } else {
      // Default: 25% goodwill refund
      determinedRefundCents = Math.floor(supportCase.orderTotalCents * 0.25);
      resolutionReason = "General complaint - goodwill partial refund";
    }

    resolution.push({
      step: "determine-resolution",
      action: "determine-resolution",
      requestId: `${prefix}-decide-${now}`,
      outcome: "approved",
      details: {
        determinedRefundCents,
        resolutionReason,
        orderTotalCents: supportCase.orderTotalCents,
        contractBudgetCents: contract.budgetCents,
        contractMaxRefunds: contract.maxRefunds,
        contractRefundsUsed: contract.refundsUsed,
        remainingBudgetCents: contract.budgetCents - contract.spentCents,
      },
      timestamp: Date.now(),
    });

    // STEP 3: Execute refund — attempt the determined amount
    // LEASH will reject if it exceeds budget or refund count
    if (determinedRefundCents > 0 && contract.maxRefunds > contract.refundsUsed) {
      const refundRequestId = `${prefix}-refund-${now}`;
      const refundApproval = await approveForCase(input.caseId, {
        action: "issue-refund",
        amountCents: determinedRefundCents,
        refund: true,
        requestId: refundRequestId,
      }, { caller });

      resolution.push({
        step: "execute-refund",
        action: "issue-refund",
        requestId: refundRequestId,
        outcome: refundApproval.outcome,
        details: refundApproval.outcome === "approved"
          ? { amountCents: determinedRefundCents, refundId: `rf_${crypto.randomUUID()}` }
          : refundApproval.decision,
        timestamp: Date.now(),
      });

      if (refundApproval.outcome === "approved") {
        await leash.settle(refundRequestId);
        refundExecuted = true;
        refundSucceeded = true;
        refundAmount = determinedRefundCents;

        // Record the refund event
        await db.insert(contractEvents).values({
          id: `ev_${crypto.randomUUID()}`,
          contractId,
          type: "REFUND_ISSUED",
          action: "issue-refund",
          caller,
          amountCents: determinedRefundCents,
          code: null,
          detail: JSON.stringify({
            refundId: `rf_${crypto.randomUUID()}`,
            orderRef: supportCase.orderRef,
            reason: resolutionReason,
          }),
          createdAt: Date.now(),
        });
      }
    } else if (determinedRefundCents > 0) {
      // Refund warranted but count exhausted
      resolution.push({
        step: "execute-refund",
        action: "issue-refund",
        requestId: `${prefix}-refund-skipped-${now}`,
        outcome: "rejected",
        details: {
          reason: "Refund count exhausted",
          determinedRefundCents,
          refundsUsed: contract.refundsUsed,
          maxRefunds: contract.maxRefunds,
        },
        timestamp: Date.now(),
      });
    } else {
      // No refund warranted
      resolution.push({
        step: "execute-refund",
        action: "issue-refund",
        requestId: `${prefix}-refund-skipped-${now}`,
        outcome: "rejected",
        details: {
          reason: "No refund warranted",
          determinedRefundCents: 0,
        },
        timestamp: Date.now(),
      });
    }

    // STEP 4: Draft customer response (REQUIRED for resolution)
    const responseRequestId = `${prefix}-response-${now}`;
    customerResponse = generateCustomerResponse(
      supportCase.customer,
      supportCase.orderRef,
      refundExecuted,
      refundAmount,
      resolutionReason
    );

    const responseApproval = await approveForCase(input.caseId, {
      action: "draft-response",
      amountCents: 0,
      refund: false,
      requestId: responseRequestId,
    }, { caller });

    resolution.push({
      step: "draft-response",
      action: "draft-response",
      requestId: responseRequestId,
      outcome: responseApproval.outcome,
      details: responseApproval.outcome === "approved"
        ? { draft: customerResponse }
        : responseApproval.decision,
      timestamp: Date.now(),
    });

    if (responseApproval.outcome === "approved") {
      await leash.settle(responseRequestId);
      responseSucceeded = true;
    }

    // STEP 5: Determine honest resolution status
    // Required actions: inspect-order, draft-response
    // Refund is attempted but may be rejected by LEASH (that's enforcement working)
    let resolutionStatus: string;
    if (!responseSucceeded) {
      resolutionStatus = "partial_response_failed";
    } else if (determinedRefundCents > 0 && !refundSucceeded && contract.maxRefunds > contract.refundsUsed) {
      // Refund was warranted and attempted but rejected (budget/count) - enforcement worked
      resolutionStatus = "partial_refund_rejected";
    } else if (refundExecuted) {
      resolutionStatus = "resolved_with_refund";
    } else {
      resolutionStatus = "resolved_no_refund";
    }

    const closeRequestId = `${prefix}-close-${now}`;

    resolution.push({
      step: "close-case",
      action: "close-case",
      requestId: closeRequestId,
      outcome: "approved",
      details: {
        resolutionStatus,
        refundAmountCents: refundAmount,
        customerResponse,
      },
      timestamp: Date.now(),
    });

    // Persist case resolution status
    await db.update(supportCases)
      .set({ 
        status: resolutionStatus,
        resolvedAt: Date.now(),
        resolutionRefundCents: refundAmount,
        resolutionReason,
      })
      .where(eq(supportCases.id, input.caseId));

    // Record case resolution event
    await db.insert(contractEvents).values({
      id: `ev_${crypto.randomUUID()}`,
      contractId,
      type: "CASE_RESOLVED",
      action: "close-case",
      caller,
      amountCents: refundAmount,
      code: resolutionStatus.startsWith("partial_") ? resolutionStatus : null,
      detail: JSON.stringify({
        resolutionStatus,
        refundAmountCents: refundAmount,
        customerResponse,
        resolutionReason,
      }),
      createdAt: Date.now(),
    });

    return {
      ok: true,
      caseId: input.caseId,
      contractId,
      resolution: {
        status: resolutionStatus,
        refundAmountCents: refundAmount,
        customerResponse,
        resolutionReason,
        steps: resolution,
      },
    };
  },
});

function generateCustomerResponse(
  customer: string,
  orderRef: string,
  refundExecuted: boolean,
  refundAmount: number,
  reason: string
): string {
  const refundText = refundExecuted
    ? `We have recorded a simulated refund of $${(refundAmount / 100).toFixed(2)} for this case. This is a demo — no actual payment was processed.`
    : "We were unable to process a refund for this case.";

  return `Dear ${customer},

Thank you for contacting us about order ${orderRef}. We sincerely apologize for the inconvenience you experienced.

${reason}.

${refundText}

We value your business and hope to restore your confidence in our service. If you have any further questions, please don't hesitate to reach out.

Best regards,
Customer Support Team (LEASH Demo)`;
}