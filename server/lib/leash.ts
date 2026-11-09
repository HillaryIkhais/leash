/**
 * LEASH singleton — actions import { leash, approveForCase } and call
 * approve()/settle()/release(). Every gated action's run() must begin with:
 *   const approval = await approveForCase(caseId, req, ctx);
 *   if (approval.outcome !== "approved") return fail(...);
 * Approval output is also a receipt id; after the real side effect, settle().
 */
import { getDb } from "../db";
import { desc, eq } from "drizzle-orm";
import { LeashEnforcer } from "./leash-enforce";
import { makeLeashBridge } from "./leash-db-bridge";
import type { LeashCallRequest } from "./leash-engine";
import type { ApproveResult, LeashContext } from "./leash-enforce";
import { contracts } from "../db/schema";

export const leash = new LeashEnforcer(makeLeashBridge());
export type { ApproveResult } from "./leash-enforce";

/**
 * Actions are addressed by support case; contracts by id. Resolve the
 * latest contract bound to the case — issuance supersedes (revokes) older
 * contracts, so the newest row is the live authority, whatever its status
 * (ACTIVE evaluates, REVOKED/EXPIRED reject with the right code).
 */
export async function resolveContractForCase(caseId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.caseId, caseId))
    .orderBy(desc(contracts.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Case-addressed approval. The enforcer's clock (Date.now() at the server)
 * decides expiry — the request payload carries no time.
 */
export async function approveForCase(
  caseId: string,
  req: LeashCallRequest,
  ctx: LeashContext,
): Promise<ApproveResult> {
  const contractId = await resolveContractForCase(caseId);
  if (!contractId) {
    return {
      outcome: "rejected",
      decision: { ok: false, code: "contract_not_found", message: "no run contract for this case" },
    };
  }
  // the request payload carries no time — the enforcer stamps its own clock
  return leash.approve(contractId, req, ctx);
}
