/**
 * Issue-contract — HUMAN ONLY. This is the authority grant itself.
 * agentTool: false, mcpTool: false → UI/HTTP only. Agents can never grant
 * themselves authority; only the issuer can.
 */
import { defineAction } from "@agent-native/core/action";
import { getDb } from "@agent-native/core/db";
import { z } from "zod";
import { supportCases } from "../server/db/schema";
import { EVENT_TYPE } from "../server/lib/leash-constants";
import { eq } from "drizzle-orm";

export default defineAction({
  description:
    "Issue a run contract for a support case. Human-only: sets the refund ceiling, maximum refunds, permitted and forbidden actions, and expiry.",
  agentTool: false,
  mcpTool: false,
  schema: z.object({
    caseId: z.string().describe("Support case id"),
    title: z.string().min(1).default("Support run"),
    budgetCents: z.number().int().positive().max(100000).describe("Total money this run may move, in cents"),
    maxRefunds: z.number().int().min(0).max(10).describe("Maximum refund actions this run may perform"),
    permittedActions: z.array(z.string()).min(1),
    forbiddenActions: z.array(z.string()).default([]),
    minutes: z.number().int().min(1).max(120).default(10).describe("Contract lifetime in minutes"),
  }),
  run: async (input) => {
    const db = getDb();
    const id = `ct_${crypto.randomUUID()}`;
    const now = Date.now();

    const [has] = await db.select().from(supportCases).where(eq(supportCases.id, input.caseId)).limit(1);
    if (!has) {
      return { ok: false, error: "no such case" };
    }

    // Only one ACTIVE contract per case: re-issuance supersedes by revoking
    // the old one explicitly (authority transfer leaves a receipt).
    const actives = await db.select().from(contracts).where(eq(contracts.caseId, input.caseId));
    for (const c of actives) {
      if (c.status === "ACTIVE") {
        await db.update(contracts)
          .set({ status: "REVOKED", revokedAt: now })
          .where(eq(contracts.id, c.id));
        await db.insert(contractEvents).values({
          id: `ev_${crypto.randomUUID()}`,
          contractId: c.id,
          type: EVENT_TYPE.REVOKED,
          action: null,
          caller: "frontend",
          amountCents: null,
          code: "superseded_by_reissue",
          detail: JSON.stringify({ supersededBy: id }),
          createdAt: now,
        });
      }
    }

    await db.insert(contracts).values({
      id,
      caseId: input.caseId,
      title: input.title,
      status: "ACTIVE",
      budgetCents: input.budgetCents,
      spentCents: 0,
      maxRefunds: input.maxRefunds,
      refundsUsed: 0,
      permittedActions: JSON.stringify(input.permittedActions),
      forbiddenActions: JSON.stringify(input.forbiddenActions),
      issuedBy: "issuer",
      expiresAt: now + input.minutes * 60 * 1000,
      revokedAt: null,
      createdAt: now,
    });
    await db.insert(contractEvents).values({
      id: `ev_${crypto.randomUUID()}`,
      contractId: id,
      type: EVENT_TYPE.ISSUED,
      action: null,
      caller: "frontend",
      amountCents: null,
      code: null,
      detail: JSON.stringify({
        budget: input.budgetCents,
        maxRefunds: input.maxRefunds,
        permitted: input.permittedActions,
        forbidden: input.forbiddenActions,
        expiresAt: now + input.minutes * 60 * 1000,
      }),
      createdAt: now,
    });

    return { ok: true, contractId: id, expiresAt: now + input.minutes * 60 * 1000 };
  },
});
