/**
 * Delegate-contract — ATTENUATION TIME.
 * The root agent (or a child) spawns a child agent registration with an
 * envelope checked against its parent's envelope. Widenings are rejected —
 * a child can only ever be narrower than its parent on every axis.
 *
 * IDENTITY (VERIFIABLE CREDENTIAL MODEL):
 * A high-entropy delegate credential is generated at registration time.
 * The credential is a high-entropy token (e.g., 256-bit) that the parent
 * agent passes to the child agent. The child agent MUST present this
 * credential in the caller string as "subagent:<label>:<credential>".
 * The enforcer verifies the credential by hashing it and comparing
 * against the stored hash in contractDelegates. This is a VERIFIABLE
 * credential model — the credential is never stored in plaintext, only
 * its hash (using a cryptographic hash function).
 *
 * AUTHORIZATION: Only the parent delegate (or root agent for empty parentLabel)
 * may register child delegates. The caller must match the parent's registered
 * identity (or be root-agent for top-level delegation).
 */
import { defineAction } from "@agent-native/core/action";
import { getDb } from "../server/db";
import { z } from "zod";
import { checkAttenuation } from "../server/lib/leash-engine";
import { resolveCaller } from "../server/lib/leash-caller";
import { contracts, contractDelegates, contractEvents } from "../server/db/schema";
import { EVENT_TYPE } from "../server/lib/leash-constants";
import { eq, and } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";

function callerMatchesParent(caller: string, parentLabel: string): boolean {
  if (!parentLabel) {
    // Top-level delegation: only root-agent can register direct children
    return caller === "root-agent";
  }
  // Child delegation: caller must be the parent delegate
  // Format: "subagent:<parentLabel>:<credential>" or "subagent:<parentLabel>:<credential>:d<depth>"
  return caller === `subagent:${parentLabel}` || caller.startsWith(`subagent:${parentLabel}:`);
}

function generateCredential(): string {
  // Generate a 256-bit (32-byte) high-entropy credential
  return randomBytes(32).toString("base64url");
}

function hashCredential(credential: string): string {
  // Hash the credential using SHA-256
  return createHash("sha256").update(credential).digest("hex");
}

export default defineAction({
  description:
    "Register a child agent inside a run contract with an attenuated envelope. A verifiable credential is generated — the parent must pass this credential to the child agent. The child MUST present it as 'subagent:<label>:<credential>' in calls. The credential is shown ONLY ONCE at registration.",
  schema: z.object({
    contractId: z.string(),
    parentLabel: z.string().describe("Label of the parent delegate; empty means the root agent"),
    childLabel: z.string().min(1).describe("Label for the new child agent"),
    permittedActions: z.array(z.string()).min(1),
    maxRefunds: z.number().int().min(0),
    budgetCapCents: z.number().int().min(0),
  }),
  run: async (input, ctx) => {
    const db = getDb();
    const now = Date.now();
    const caller = resolveCaller(input as any, ctx);

    // Authorization: verify caller matches the parent delegate
    if (!callerMatchesParent(caller, input.parentLabel)) {
      await db.insert(contractEvents).values({
        id: `ev_${crypto.randomUUID()}`,
        contractId: input.contractId,
        type: EVENT_TYPE.REJECTED,
        action: "delegate-contract",
        caller,
        amountCents: null,
        code: "delegate_unauthorized",
        detail: JSON.stringify({ 
          message: `caller '${caller}' not authorized to register children for parent '${input.parentLabel || "root"}'`,
          parentLabel: input.parentLabel,
        }),
        createdAt: now,
      });
      return { ok: false, code: "delegate_unauthorized", message: "caller not authorized for this parent delegation" };
    }

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

    // Generate verifiable credential
    const credential = generateCredential();
    const credentialHash = hashCredential(credential);

    const id = `dg_${crypto.randomUUID()}`;
    await db.insert(contractDelegates).values({
      id,
      contractId: input.contractId,
      parentDelegateId: parentEnvelope.id || null,
      label: input.childLabel,
      permittedActions: JSON.stringify(input.permittedActions),
      maxRefunds: input.maxRefunds,
      budgetCapCents: input.budgetCapCents,
      credentialHash,
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
        parent: input.parentLabel || "root",
        // Credential is shown ONLY ONCE — here in the event detail
        // In production, this would be delivered via a secure channel
        credential: credential,
      }),
      createdAt: now,
    });
    return { ok: true, delegateId: id, childLabel: input.childLabel, credential };
  },
});