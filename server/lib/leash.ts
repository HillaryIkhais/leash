/**
 * LEASH singleton — actions import `leash` and call approve()/settle()/release().
 * Every app action's run() must begin with:
 *   const approval = await leash.approve(contractId, req, ctx);
 *   if (approval.outcome !== "approved") return fail(...);
 * Approval output is also a receipt id; after the real side effect, settle().
 */
import { LeashEnforcer } from "./leash-enforce";
import { makeLeashBridge } from "./leash-db-bridge";

export const leash = new LeashEnforcer(makeLeashBridge());
export type { ApproveResult } from "./leash-enforce";
