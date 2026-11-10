/**
 * Delegate-contract — ATTENUATION TIME.
 * The root agent (or a child) spawns a child agent registration with an
 * envelope checked against its parent's envelope. Widenings are rejected —
 * a child can only ever be narrower than its parent on every axis.
 *
 * IDENTITY: The childLabel registered here becomes the VERIFIED identity
 * used by the enforcer. The framework's delegationDepth maps to this label
 * at execution time. Caller-supplied childLabel in action inputs is IGNORED.
 */
import { defineAction } from "@agent-native/core/action";
import { getDb } from "../server/db";
import { z } from "zod";
import { checkAttenuation } from "../server/lib/leash-engine";
import { resolveCaller } from "../server/lib/leash-caller";
import { contracts, contractDelegates, contractEvents } from "../server/db/schema";
import { EVENT_TYPE } from "../server/lib/leash-constants";
import { eq, and } from "drizzle-orm";

export default defineAction({
  description:
    "Register a child agent inside a run contract with an attenuated envelope. The child's action set, refund count and budget cap must fit inside the parent envelope. The childLabel becomes the verified identity for enforcement.",
  schema: z.object({
    contractId: z.string(),
    parentLabel: z.string().describe("Label of the parent delegate; empty means the root agent"),
    childLabel: z.string().min(1).describe("Label for the new child agent (becomes verified identity)"),
    permittedActions: z.array(z.string()).min(1),
    maxRefunds: z.number().int().min(0),
    budgetCapCents: z.number().int().min(0),
  }),
  run: async (input, ctx) => {
    const db = getDb();
    const now = Date.now();
    const caller = resolveCaller(input as any, ctx);

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, input.contractId)).limit(1);
    if (!contract || contract.status !== "ACTIVE") {
      return { ok: false, error: "run contract not active" };
    }

    // The parent envelope
    let parentEnvelope: { permittedActions: string[]; maxRefunds: number; budgetCents: number; expiresAt: number; id: string } | null;
    if (!input.parentLabel) {
      parentEnvelope = {
        permittedActions: JSON.parse(contract.permittedActions),
        // effective parent counts remaining budget unlocked by children
        maxRefunds: Math.max(0, contract.maxRefunds - contract.refundsUsed),
        budgetCents: Math.max(0, contract.budgetCents - contract.spentCents),
        expiresAt: contract.expiresAt,
        id: "",
      };
    } else {
      const [parent] = await db.select().from(contractDelegates)
        .where(and(eq(contractDelegates.contractId, input.contractId), eq(contractDelegates.label, input.parentLabel)))
        .limit(1);
      if (!parent) return { ok: false, error: `parent delegate '${input.parentLabel}' not found` };
      parentEnvelope = {
        permittedActions: JSON.parse(parent.permittedActions),
        maxRefunds: parent.maxRefunds,
        budgetCents: parent.budgetCapCents,
        expiresAt: contract.expiresAt,
        id: parent.id,
      };
    }

    const gate = checkAttenuation(parentEnvelope, {
      permittedActions: input.permittedActions,
      maxRefunds: input.maxRefunds,
      budgetCents: input.budgetCapCents,
      expiresAt: contract.expiresAt,
    });
    if (!gate.ok) {
      // attempted widening is recorded — the ledger is the proof
      await db.insert(contractEvents).values({
        id: `ev_${crypto.randomUUID()}`,
        contractId: input.contractId,
        type: EVENT_TYPE.REJECTED,
        action: "delegate-contract",
        caller: caller,
        amountCents: null,
        code: gate.code,
        detail: JSON.stringify({ message: gate.message, child: input.childLabel }),
        createdAt: now,
      });
      return { ok: false, code: gate.code, message: gate.message };
    }

    const id = `dg_${crypto.randomUUID()}`;
    await db.insert(contractDelegates).values({
      id,
      contractId: input.contractId,
      parentDelegateId: parentEnvelope.id || null,
      label: input.childLabel,
      permittedActions: JSON.stringify(input.permittedActions),
      maxRefunds: input.maxRefunds,
      budgetCapCents: input.budgetCapCents,
      createdAt: now,
    });
    await db.insert(contractEvents).values({
      id: `ev_${crypto.randomUUID()}`,
      contractId: input.contractId,
      type: EVENT_TYPE.DELEGATED,
      action: null,
      caller: caller,
      amountCents: null,
      code: null,
      detail: JSON.stringify({
        child: input.childLabel,
        permitted: input.permittedActions,
        maxRefunds: input.maxRefunds,
        budgetCapCents: input.budgetCapCents,
      }),
      createdAt: now,
    });
    return { ok: true, delegateId: id, childLabel: input.childLabel };
  },
});
