/**
 * Revoke-contract — HUMAN ONLY, immediate, collective.
 * Revocation hits every caller at their next evaluation: root agent,
 * children, MCP clients — held authorizations die because enforcement
 * re-reads the contract from the DB at every side effect boundary.
 */
import { defineAction } from "@agent-native/core/action";
import { getDb } from "@agent-native/core/db";
import { z } from "zod";
import { contracts, contractEvents } from "../server/db/schema";
import { EVENT_TYPE } from "../server/lib/leash-constants";
import { eq } from "drizzle-orm";

export default defineAction({
  description: "Revoke a run contract immediately. Human-only; takes effect for every caller at their next action.",
  agentTool: false,
  mcpTool: false,
  schema: z.object({ contractId: z.string() }),
  run: async ({ contractId }) => {
    const db = getDb();
    const now = Date.now();
    const updated = await db.update(contracts)
      .set({ status: "REVOKED", revokedAt: now })
      .where(eq(contracts.id, contractId))
      .returning({ id: contracts.id });

    if (updated.length === 0) return { ok: false, error: "contract not found" };

    await db.insert(contractEvents).values({
      id: `ev_${crypto.randomUUID()}`,
      contractId,
      type: EVENT_TYPE.REVOKED,
      action: null,
      caller: "frontend",
      amountCents: null,
      code: null,
      detail: JSON.stringify({ note: "held authorizations terminate at next evaluation" }),
      createdAt: now,
    });
    return { ok: true, contractId };
  },
});
