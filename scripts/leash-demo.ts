/**
 * LEASH demo — the delegation story with verifiable credentials, executed
 * against the real enforcement stack (engine + enforcer + the bridge contract,
 * in memory; the production bridge is drizzle-over-Postgres with the same
 * conditional updates).
 *
 * Run: pnpm demo
 *   (equivalently: node --experimental-transform-types \
 *      --import ./tests/register-ts-resolve.mjs scripts/leash-demo.ts)
 *
 * This demo uses the VERIFIABLE CREDENTIAL model:
 * - Delegates are registered with a high-entropy credential
 * - The credential is shown ONLY ONCE at registration (in the DELEGATED event)
 * - Child agents MUST present the credential as "subagent:<label>:<credential>"
 * - The enforcer verifies the credential against the stored hash
 */
import { LeashEnforcer, type ApproveResult } from "../server/lib/leash-enforce";
import { EVENT_TYPE } from "../server/lib/leash-constants";
import { MemoryLeashDB } from "../tests/memory-leash-db.ts";

const db = new MemoryLeashDB();
const leash = new LeashEnforcer(db);

// The issuer contracts, in cents: a $25.00 refund ceiling, max two refunds,
// ten minutes to live. change-account-owner is explicitly forbidden.
const T0 = db.clock;
db.seedContract("ct_demo_1", {
  budgetCents: 2500,
  maxRefunds: 2,
  permittedActions: JSON.stringify(["inspect-order", "issue-refund", "draft-response"]),
  forbiddenActions: JSON.stringify(["change-account-owner"]),
  expiresAt: T0 + 600_000,
});

// The parent delegates: helper gets a full envelope, reader a narrow one
// (reads only — no refunds, no money).
// NOTE: In the real system, credentials are generated at registration and shown
// only once in the DELEGATED event. For this demo, we'll manually add the
// credential hashes to simulate the registration output.
// Credential for "helper": "helper_credential_demo"
// Credential for "reader": "reader_credential_demo"
const HELPER_CREDENTIAL = "helper_credential_demo";
const READER_CREDENTIAL = "reader_credential_demo";
const HELPER_HASH = require("crypto").createHash("sha256").update(HELPER_CREDENTIAL).digest("hex");
const READER_HASH = require("crypto").createHash("sha256").update(READER_CREDENTIAL).digest("hex");

db.seedDelegate("ct_demo_1", "helper", {
  permittedActions: ["inspect-order", "issue-refund", "draft-response"],
  maxRefunds: 2,
  budgetCapCents: 2500,
  credentialHash: HELPER_HASH,
});
db.seedDelegate("ct_demo_1", "reader", {
  permittedActions: ["inspect-order"],
  maxRefunds: 0,
  budgetCapCents: 0,
  credentialHash: READER_HASH,
});

const approve = (requestId: string, action: string, caller: string, amountCents = 0, refund = false) =>
  leash.approve("ct_demo_1", { action, requestId, amountCents, refund }, { caller });

const banner = (n: string, title: string) =>
  console.log(`\n— Beat ${n}: ${title}`);

/** One line per decision, typed by the discriminated ApproveResult. */
function report(result: ApproveResult): string {
  if (result.outcome === "approved") {
    return `approved | receipt ${result.receiptId} | ${result.decision.remainingCents} cents remaining`;
  }
  if (result.outcome === "rejected") {
    return `rejected | ${result.decision.code} | ${result.decision.message}`;
  }
  return `replayed | replayOf: ${result.replayOf}`;
}

banner("1", "registered delegate 'helper' performs an ALLOWED action");
// App provides caller="subagent:helper:<credential>" — enforcer verifies credential hash
const ok = await approve("rq-01", "issue-refund", `subagent:helper:${HELPER_CREDENTIAL}`, 1800, true);
console.log("  decision:", report(ok));
await leash.settle("rq-01");

banner("2", "delegate attempts an action OUTSIDE its delegation (forbidden list)");
const forbidden = await approve("rq-02", "change-account-owner", `subagent:helper:${HELPER_CREDENTIAL}`);
console.log("  decision:", report(forbidden));

banner("3", "delegate attempts an action NOT IN the permitted set");
const notPermitted = await approve("rq-03", "open-case", `subagent:helper:${HELPER_CREDENTIAL}`);
console.log("  decision:", report(notPermitted));

banner("4", "delegate attempts to EXCEED the budget ($18.00 spent + $7.01 vs $25.00)");
const overspend = await approve("rq-04", "issue-refund", `subagent:helper:${HELPER_CREDENTIAL}`, 701, true);
console.log("  decision:", report(overspend));

banner("5", "duplicate requestId replays — no double execution");
const replay = await approve("rq-01", "issue-refund", `subagent:helper:${HELPER_CREDENTIAL}`, 1800, true);
console.log("  decision:", report(replay));

banner("6", "failed side effect releases the allowance");
const doomed = await approve("rq-06", "issue-refund", `subagent:helper:${HELPER_CREDENTIAL}`, 700, true);
console.log("  approved:", doomed.outcome, "| receipt:", doomed.outcome === "approved" ? doomed.receiptId : "—");
const released = await leash.release("rq-06");
console.log("  side effect failed -> released:", released, "| allowance returned, RELEASED receipt written");

banner("7", "registered delegate 'reader' acts OUTSIDE ITS OWN envelope (attenuation, enforced live)");
// Reader delegate only has inspect-order, no refunds, no budget
const envelope = await approve("rq-07", "issue-refund", `subagent:reader:${READER_CREDENTIAL}`, 100, true);
console.log("  decision:", report(envelope));

banner("8", "parent REVOKES the contract; further use is rejected");
db.contracts.get("ct_demo_1")!.status = "REVOKED";
db.events.push({
  id: "ev-revoke-demo", contractId: "ct_demo_1", type: EVENT_TYPE.REVOKED, action: null,
  caller: "issuer", amountCents: null, code: null,
  detail: JSON.stringify({ note: "held authorizations terminate at next evaluation" }),
  createdAt: db.clock,
});
const afterRevoke = await approve("rq-08", "inspect-order", `subagent:helper:${HELPER_CREDENTIAL}`);
console.log("  decision:", report(afterRevoke));

banner("9", "invalid credential is rejected");
const badCred = await approve("rq-09", "issue-refund", `subagent:helper:bad_credential`, 100, true);
console.log("  decision:", report(badCred));

banner("10", "the receipt ledger shows what happened and why");
for (const e of [...db.events].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
  const amt = e.amountCents == null ? "" : ` $${(e.amountCents / 100).toFixed(2)}`;
  console.log(`  [${e.type.padEnd(9)}] ${e.caller.padEnd(25)} ${(e.action ?? "").padEnd(21)}${amt} ${e.code ?? ""}`);
}

const counts = db.events.reduce<Record<string, number>>((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
console.log("\nTotals:", JSON.stringify(counts));
console.log("Contract final state:", JSON.stringify(db.contracts.get("ct_demo_1"), null, 1));

if (
  (counts.EXECUTED ?? 0) !== 2 || // rq-01 settled, rq-06 approved-then-released
  (counts.REJECTED ?? 0) !== 6 || // forbidden, not-permitted, budget wall, envelope, revoked, bad cred
  (counts.REPLAYED ?? 0) !== 1 ||
  (counts.RELEASED ?? 0) !== 1 ||
  (counts.REVOKED ?? 0) !== 1
) {
  console.error("DEMO FAILED — unexpected receipt distribution");
  process.exit(1);
}
const final = db.contracts.get("ct_demo_1")!;
if (final.spentCents !== 1800 || final.refundsUsed !== 1) {
  console.error("DEMO FAILED — released allowance did not return");
  process.exit(1);
}
console.log("\nDEMO OK — 2 executed (1 released), 6 rejected, 1 replayed, 1 revoked; net spend $18.00 of $25.00");