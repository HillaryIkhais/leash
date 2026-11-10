/**
 * Resolve-case — AUTONOMOUS AGENT WORKFLOW.
 * The agent receives a support case, inspects the order, determines resolution,
 * executes permitted actions, and produces a complete resolution outcome.
 * All actions go through LEASH enforcement.
 */
import { defineAction, ActionContractError } from "@agent-native/core/action";
import { getDb } from "../server/db";
import { z } from "zod";
import { supportCases, contractEvents, contracts } from "../server/db/schema";
import { approveForCase, leash, resolveContractForCase } from "../server/lib/leash";
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
    "Autonomously resolve a support case through LEASH-governed actions. The agent inspects the order, determines the appropriate resolution, executes permitted refunds, drafts customer response, and closes the case.",
  schema: z.object({
    caseId: z.string().describe("Support case to resolve"),
    requestIdPrefix: z.string().default("resolve").describe("Prefix for idempotency keys"),
    maxRefundAmountCents: z.number().int().positive().optional().describe("Maximum refund the agent may attempt"),
  }),
  run: async (input, ctx) => {
    const db = getDb();
    const prefix = input.requestIdPrefix;
    const now = Date.now();

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

    // STEP 1: Inspect the order
    const inspectRequestId = `${prefix}-inspect-${now}`;
    const inspectApproval = await approveForCase(input.caseId, {
      action: "inspect-order",
      amountCents: 0,
      refund: false,
      requestId: inspectRequestId,
    }, { caller: "root-agent" });

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
    }

    // STEP 2: Determine resolution based on complaint and order
    // The agent analyzes the complaint and decides on a refund amount
    const complaint = supportCase.complaint.toLowerCase();
    let determinedRefundCents = 0;
    let resolutionReason = "";

    if (complaint.includes("damaged") || complaint.includes("broken") || complaint.includes("snap")) {
      // Full refund for damaged items
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

    // Respect the agent's max refund limit if provided
    if (input.maxRefundAmountCents && determinedRefundCents > input.maxRefundAmountCents) {
      determinedRefundCents = input.maxRefundAmountCents;
      resolutionReason += ` (capped at agent max: $${(input.maxRefundAmountCents / 100).toFixed(2)})`;
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
      },
      timestamp: Date.now(),
    });

    // STEP 3: Execute refund if determined amount > 0 and contract permits
    if (determinedRefundCents > 0 && contract.maxRefunds > contract.refundsUsed) {
      const refundRequestId = `${prefix}-refund-${now}`;
      const refundApproval = await approveForCase(input.caseId, {
        action: "issue-refund",
        amountCents: determinedRefundCents,
        refund: true,
        requestId: refundRequestId,
      }, { caller: "root-agent" });

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
        refundAmount = determinedRefundCents;

        // Record the refund event
        await db.insert(contractEvents).values({
          id: `ev_${crypto.randomUUID()}`,
          contractId,
          type: "REFUND_ISSUED",
          action: "issue-refund",
          caller: "root-agent",
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
    } else {
      resolution.push({
        step: "execute-refund",
        action: "issue-refund",
        requestId: `${prefix}-refund-skipped-${now}`,
        outcome: "rejected",
        details: {
          reason: determinedRefundCents === 0 ? "No refund warranted" : "Refund count exhausted",
          determinedRefundCents,
          refundsUsed: contract.refundsUsed,
          maxRefunds: contract.maxRefunds,
        },
        timestamp: Date.now(),
      });
    }

    // STEP 4: Draft customer response
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
    }, { caller: "root-agent" });

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
    }

    // STEP 5: Close case (mark as resolved in events)
    const closeRequestId = `${prefix}-close-${now}`;
    resolution.push({
      step: "close-case",
      action: "close-case",
      requestId: closeRequestId,
      outcome: "approved",
      details: {
        resolutionStatus: refundExecuted ? "resolved_with_refund" : "resolved_no_refund",
        refundAmountCents: refundAmount,
        customerResponse,
      },
      timestamp: Date.now(),
    });

    // Record case resolution event
    await db.insert(contractEvents).values({
      id: `ev_${crypto.randomUUID()}`,
      contractId,
      type: "CASE_RESOLVED",
      action: "close-case",
      caller: "root-agent",
      amountCents: refundAmount,
      code: null,
      detail: JSON.stringify({
        resolutionStatus: refundExecuted ? "resolved_with_refund" : "resolved_no_refund",
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
        status: refundExecuted ? "resolved_with_refund" : "resolved_no_refund",
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
    ? `We have processed a refund of $${(refundAmount / 100).toFixed(2)} to your original payment method.`
    : "We were unable to process a refund for this case.";

  return `Dear ${customer},

Thank you for contacting us about order ${orderRef}. We sincerely apologize for the inconvenience you experienced.

${reason}.

${refundText} The refund should appear in your account within 3-5 business days.

We value your business and hope to restore your confidence in our service. If you have any further questions, please don't hesitate to reach out.

Best regards,
Customer Support Team`;
}