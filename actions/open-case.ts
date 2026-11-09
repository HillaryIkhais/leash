/**
 * Open-case — demo seeding. Frontend-only; creates the support case that
 * the run contract binds to.
 */
import { defineAction } from "@agent-native/core/action";
import { getDb } from "@agent-native/core/db";
import { z } from "zod";
import { supportCases } from "../server/db/schema";

export default defineAction({
  description: "Open a support case. Frontend-only seeding for the demo.",
  agentTool: false,
  mcpTool: false,
  schema: z.object({
    customer: z.string(),
    orderRef: z.string(),
    orderTotalCents: z.number().int().positive(),
    complaint: z.string(),
  }),
  run: async (input) => {
    const db = getDb();
    const id = `sc_${crypto.randomUUID()}`;
    await db.insert(supportCases).values({ ...input, id, createdAt: Date.now() });
    return { ok: true, caseId: id };
  },
});
