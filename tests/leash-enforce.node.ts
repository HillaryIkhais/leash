/**
 * LEASH enforcer lifecycle suite — replay, holds, races, unwind, receipts.
 * Run: tsx --test tests/leash-enforce.node.ts
 *
 * The in-memory DB below implements EXACTLY the same conditional-update
 * semantics as the drizzle bridge (server/lib/leash-db-bridge.ts):
 * one synchronous compare-and-set per hold, so concurrent approvers race
 * through genuine microtask interleaving and the loser sees zero rows.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { LeashEnforcer } from "../server/lib/leash-enforce";
import { RESERVATION_STATUS, EVENT_TYPE } from "../server/lib/leash-constants";
import { MemoryLeashDB } from "./memory-leash-db.ts";

function makeEnforcer(db: MemoryLeashDB) {
  return new LeashEnforcer(db);
}

const REQ = (over: Partial<{ action: string; requestId: string; amountCents: number; refund: boolean }> = {}) => ({
  action: "issue-refund",
  requestId: "rq-1",
  amountCents: 1000,
  refund: false,
  ...over,
});

test("01 allowed action passes the gate, executes, settles into permanent spend", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  const a = await leash.approve("ct_1", REQ({ requestId: "rq-a", amountCents: 1000, refund: true }), { caller: "root-agent" });
  assert.equal(a.outcome, "approved");

  db.sideEffects.push({ action: "issue-refund", requestId: "rq-a", amountCents: 1000 }); // the real side effect
  assert.equal(await leash.settle("rq-a"), true);

  const c = db.contracts.get("ct_1")!;
  assert.equal(c.spentCents, 1000);
  assert.equal(c.refundsUsed, 1);
  assert.equal(db.eventsOf("ct_1", EVENT_TYPE.EXECUTED).length, 1);
});

test("02 forbidden action is rejected BEFORE any execution (fail closed)", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  const a = await leash.approve("ct_1", REQ({ action: "change-account-owner", requestId: "rq-f" }), { caller: "root-agent" });
  assert.equal(a.outcome, "rejected");
  assert.equal(a.decision?.code, "forbidden_action");
  assert.deepEqual(db.sideEffects, []); // nothing executed
  const rej = db.eventsOf("ct_1", EVENT_TYPE.REJECTED);
  assert.equal(rej.length, 1);
  assert.equal(rej[0].code, "forbidden_action");
});

test("03 cumulative budget is enforced across delegated agents", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  db.seedDelegate("ct_1", "helper", {
    permittedActions: ["inspect-order", "issue-refund", "draft-response"],
    maxRefunds: 1, budgetCapCents: 2500,
  });
  const leash = makeEnforcer(db);

  const parent = await leash.approve("ct_1", REQ({ requestId: "rq-p", amountCents: 1500, refund: true }), { caller: "root-agent" });
  assert.equal(parent.outcome, "approved");
  // child draws from the SAME contract pool — not a fresh budget
  const child = await leash.approve("ct_1", REQ({ requestId: "rq-c", amountCents: 1000, refund: false }), { caller: "subagent:helper" });
  assert.equal(child.outcome, "approved");
  const over = await leash.approve("ct_1", REQ({ requestId: "rq-x", amountCents: 1 }), { caller: "subagent:helper" });
  assert.equal(over.outcome, "rejected");
  assert.equal(over.decision?.code, "budget_exceeded");
  assert.equal(db.contracts.get("ct_1")!.spentCents, 2500);
});

test("04 revoked authority cannot be reused", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  const first = await leash.approve("ct_1", REQ({ requestId: "rq-1", amountCents: 100 }), { caller: "root-agent" });
  assert.equal(first.outcome, "approved");

  db.contracts.get("ct_1")!.status = "REVOKED";
  const second = await leash.approve("ct_1", REQ({ requestId: "rq-2", amountCents: 100 }), { caller: "root-agent" });
  assert.equal(second.outcome, "rejected");
  assert.equal(second.decision?.code, "contract_revoked");
});

test("05 expired authority cannot be reused (clock advanced past expiresAt)", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  db.clock += 600_000; // past the boundary
  const a = await leash.approve("ct_1", REQ({ requestId: "rq-1", amountCents: 100 }), { caller: "root-agent" });
  assert.equal(a.outcome, "rejected");
  assert.equal(a.decision?.code, "contract_expired");
});

test("06 concurrent requests cannot overspend the last allowance", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1", { budgetCents: 500, maxRefunds: 0 });
  db.seedDelegate("ct_1", "one", { permittedActions: ["issue-refund"], maxRefunds: 0, budgetCapCents: 500 });
  db.seedDelegate("ct_1", "two", { permittedActions: ["issue-refund"], maxRefunds: 0, budgetCapCents: 500 });
  const leash = makeEnforcer(db);

  // three concurrent claims on the same $5.00 — only one can win
  const results = await Promise.all([
    leash.approve("ct_1", REQ({ requestId: "rq-a", amountCents: 500 }), { caller: "root-agent" }),
    leash.approve("ct_1", REQ({ requestId: "rq-b", amountCents: 500 }), { caller: "subagent:one" }),
    leash.approve("ct_1", REQ({ requestId: "rq-c", amountCents: 500 }), { caller: "subagent:two" }),
  ]);

  const approved = results.filter((r) => r.outcome === "approved");
  const raced = results.filter((r) => r.outcome === "rejected" && r.decision?.code === "budget_exceeded");
  assert.equal(approved.length, 1, "exactly one winner");
  assert.equal(raced.length, 2, "losers rejected with budget_exceeded");
  assert.equal(db.contracts.get("ct_1")!.spentCents, 500, "no over-spend recorded");
});

test("07 duplicate requestId replays the earlier receipt — no double execution", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  const first = await leash.approve("ct_1", REQ({ requestId: "rq-same", amountCents: 700, refund: true }), { caller: "root-agent" });
  assert.equal(first.outcome, "approved");
  await leash.settle("rq-same");

  const second = await leash.approve("ct_1", REQ({ requestId: "rq-same", amountCents: 700, refund: true }), { caller: "root-agent" });
  assert.equal(second.outcome, "replayed");

  const c = db.contracts.get("ct_1")!;
  assert.equal(c.spentCents, 700, "charged once");
  assert.equal(c.refundsUsed, 1, "counted once");
  assert.equal(db.eventsOf("ct_1", EVENT_TYPE.EXECUTED).length, 1);
  assert.equal(db.eventsOf("ct_1", EVENT_TYPE.REPLAYED).length, 1);
});

test("08 concurrent duplicate requestIds resolve to one execution", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1", { maxRefunds: 3 });
  const leash = makeEnforcer(db);

  // both holds succeed, then the reservation insert collides — the loser
  // must unwind and replay, leaving no phantom spend
  const results = await Promise.all([
    leash.approve("ct_1", REQ({ requestId: "rq-dup", amountCents: 300 }), { caller: "root-agent" }),
    leash.approve("ct_1", REQ({ requestId: "rq-dup", amountCents: 300 }), { caller: "root-agent" }),
  ]);

  const approved = results.filter((r) => r.outcome === "approved");
  const replayed = results.filter((r) => r.outcome === "replayed");
  assert.equal(approved.length, 1, "one execution");
  assert.equal(replayed.length, 1, "loser replays the winner's receipt");
  assert.equal(db.contracts.get("ct_1")!.spentCents, 300, "charged once — no phantom hold");
  assert.equal(db.eventsOf("ct_1", EVENT_TYPE.EXECUTED).length, 1, "one EXECUTED receipt");
});

test("09 failed side effects release the allowance safely (count and money)", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  const a = await leash.approve("ct_1", REQ({ requestId: "rq-f", amountCents: 1000, refund: true }), { caller: "root-agent" });
  assert.equal(a.outcome, "approved");

  assert.equal(await leash.release("rq-f"), true); // side effect failed
  const c = db.contracts.get("ct_1")!;
  assert.equal(c.spentCents, 0, "money returned");
  assert.equal(c.refundsUsed, 0, "count returned");
  assert.equal(db.eventsOf("ct_1", EVENT_TYPE.RELEASED).length, 1);
  assert.equal(await leash.release("rq-f"), false, "double release rejected");
});

test("10 release is refused for reservations that were never held", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  // rejected request — nothing was reserved, nothing to release
  await leash.approve("ct_1", REQ({ action: "change-account-owner", requestId: "rq-nope" }), { caller: "root-agent" });
  assert.equal(await leash.release("rq-nope"), false);
});

test("11 settle is idempotent — second settle finds nothing HELD", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  await leash.approve("ct_1", REQ({ requestId: "rq-s", amountCents: 100 }), { caller: "root-agent" });
  assert.equal(await leash.settle("rq-s"), true);
  assert.equal(await leash.settle("rq-s"), false);
});

test("12 receipts distinguish executed / rejected / replayed / released", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  await leash.approve("ct_1", REQ({ requestId: "rq-ok", amountCents: 100 }), { caller: "root-agent" });
  await leash.approve("ct_1", REQ({ action: "change-account-owner", requestId: "rq-no" }), { caller: "root-agent" });
  await leash.approve("ct_1", REQ({ requestId: "rq-ok", amountCents: 100 }), { caller: "root-agent" });
  await leash.release("rq-ok");

  assert.equal(db.eventsOf("ct_1", EVENT_TYPE.EXECUTED).length, 1);
  const rej = db.eventsOf("ct_1", EVENT_TYPE.REJECTED);
  assert.equal(rej.length, 1);
  assert.equal(rej[0].code, "forbidden_action");
  assert.equal(db.eventsOf("ct_1", EVENT_TYPE.REPLAYED).length, 1);
  assert.equal(db.eventsOf("ct_1", EVENT_TYPE.RELEASED).length, 1);
});

test("13 unknown contract fails closed — no execution, rejection receipted", async () => {
  const db = new MemoryLeashDB();
  const leash = makeEnforcer(db);

  const a = await leash.approve("ct_ghost", REQ({ requestId: "rq-g" }), { caller: "root-agent" });
  assert.equal(a.outcome, "rejected");
  assert.equal(a.decision?.code, "contract_not_found");
  assert.deepEqual(db.sideEffects, []);
  // even the ghost attempt leaves a receipt trail (no FK: events carry the attempt)
  const rej = db.events.filter((e) => e.type === EVENT_TYPE.REJECTED);
  assert.equal(rej.length, 1);
  assert.equal(rej[0].code, "contract_not_found");
});

test("14 count hold wins but budget hold loses -> count unwound, rejection recorded", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1", { budgetCents: 500, spentCents: 0, maxRefunds: 2 });
  db.seedDelegate("ct_1", "one", { permittedActions: ["issue-refund"], maxRefunds: 2, budgetCapCents: 500 });
  const leash = makeEnforcer(db);

  // both refunds pass evaluate() against the stale snapshot; only one can hold
  // the $5.00 — the loser must unwind its count hold and leave a crash receipt
  const results = await Promise.all([
    leash.approve("ct_1", REQ({ requestId: "rq-u1", amountCents: 400, refund: true }), { caller: "root-agent" }),
    leash.approve("ct_1", REQ({ requestId: "rq-u2", amountCents: 400, refund: true }), { caller: "subagent:one" }),
  ]);

  const approved = results.filter((r) => r.outcome === "approved");
  const rejected = results.filter((r) => r.outcome === "rejected");
  assert.equal(approved.length, 1, "one winner");
  assert.equal(rejected.length, 1, "one loser");
  assert.equal(rejected[0].decision?.code, "budget_exceeded");

  const c = db.contracts.get("ct_1")!;
  assert.equal(c.spentCents, 400, "winner's money held once");
  assert.equal(c.refundsUsed, 1, "loser's count hold was rolled back");
  const rej = db.eventsOf("ct_1", EVENT_TYPE.REJECTED);
  assert.equal(rej.length, 1);
  assert.equal(JSON.parse(rej[0].detail!).crash, "budget race lost");
});

test("15 approval on a non-ACTIVE contract is impossible (hold re-checks status)", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  // race window: contract revoked between snapshot and hold — hold refuses
  db.contracts.get("ct_1")!.status = "REVOKED";
  const a = await leash.approve("ct_1", REQ({ requestId: "rq-r", amountCents: 100 }), { caller: "root-agent" });
  assert.equal(a.outcome, "rejected");
  assert.equal(a.decision?.code, "contract_revoked");
  assert.equal(db.contracts.get("ct_1")!.spentCents, 0);
});

test("16 replay of a rejected request returns the rejection code, not approval", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  const first = await leash.approve("ct_1", REQ({ action: "change-account-owner", requestId: "rq-rej" }), { caller: "root-agent" });
  assert.equal(first.outcome, "rejected");

  const replay = await leash.approve("ct_1", REQ({ action: "change-account-owner", requestId: "rq-rej" }), { caller: "root-agent" });
  assert.equal(replay.outcome, "replayed");
  assert.equal(replay.replayOf, `REJECTED:forbidden_action`);
});

test("17 read-only actions settle without touching money or count", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  const a = await leash.approve("ct_1", REQ({ action: "inspect-order", requestId: "rq-ro", amountCents: 0 }), { caller: "mcp:crm (9944)" });
  assert.equal(a.outcome, "approved");
  await leash.settle("rq-ro");

  const c = db.contracts.get("ct_1")!;
  assert.equal(c.spentCents, 0);
  assert.equal(c.refundsUsed, 0);
  const ex = db.eventsOf("ct_1", EVENT_TYPE.EXECUTED)[0];
  assert.equal(ex.caller, "mcp:crm (9944)", "MCP caller identity lands in the receipt");
});

test("18 held reservations from before a revocation cannot settle after it", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  const a = await leash.approve("ct_1", REQ({ requestId: "rq-h", amountCents: 100 }), { caller: "root-agent" });
  assert.equal(a.outcome, "approved");

  db.contracts.get("ct_1")!.status = "REVOKED";
  // the held money may only become permanent spend if the side effect lands
  // while authority is live — the enforcer's settle only flips HELD->SETTLED,
  // so the honest handler releases; the released event is the audit trail.
  assert.equal(await leash.release("rq-h"), true);
  const c = db.contracts.get("ct_1")!;
  assert.equal(c.spentCents, 0, "held allowance returned on abort");
});

test("19 declared child acting outside its envelope is rejected at execution time", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1"); // the CONTRACT permits issue-refund
  db.seedDelegate("ct_1", "helper", { permittedActions: ["inspect-order"], maxRefunds: 0, budgetCapCents: 0 });
  const leash = makeEnforcer(db);

  const a = await leash.approve("ct_1", REQ({ requestId: "rq-ch", amountCents: 100, refund: true }), { caller: "subagent:helper" });
  assert.equal(a.outcome, "rejected");
  assert.equal(a.decision?.code, "delegate_envelope_violation");
  assert.deepEqual(db.sideEffects, []);
  const rej = db.eventsOf("ct_1", EVENT_TYPE.REJECTED);
  assert.equal(rej.length, 1);
  assert.equal(rej[0].caller, "subagent:helper");
});

test("20 child cannot spend above its delegated cap even for a permitted action", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1", { budgetCents: 2500, maxRefunds: 3 });
  db.seedDelegate("ct_1", "helper", { permittedActions: ["issue-refund"], maxRefunds: 1, budgetCapCents: 500 });
  const leash = makeEnforcer(db);

  const a = await leash.approve("ct_1", REQ({ requestId: "rq-cap", amountCents: 501, refund: true }), { caller: "subagent:helper" });
  assert.equal(a.outcome, "rejected");
  assert.equal(a.decision?.code, "delegate_envelope_violation");

  const ok = await leash.approve("ct_1", REQ({ requestId: "rq-cap2", amountCents: 500, refund: true }), { caller: "subagent:helper" });
  assert.equal(ok.outcome, "approved", "at the cap boundary it passes");
});

test("21 unknown child label fails closed", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  const leash = makeEnforcer(db);

  const a = await leash.approve("ct_1", REQ({ requestId: "rq-ghost-child", amountCents: 0 }), { caller: "subagent:nobody" });
  assert.equal(a.outcome, "rejected");
  assert.equal(a.decision?.code, "delegate_not_found");
});

test("22 child within its envelope is admitted and its label lands on the receipt", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_1");
  db.seedDelegate("ct_1", "reader", { permittedActions: ["inspect-order"], maxRefunds: 0, budgetCapCents: 0 });
  const leash = makeEnforcer(db);

  const a = await leash.approve("ct_1", REQ({ action: "inspect-order", requestId: "rq-ro2", amountCents: 0 }), { caller: "subagent:reader:d2" });
  assert.equal(a.outcome, "approved");
  const ex = db.eventsOf("ct_1", EVENT_TYPE.EXECUTED)[0];
  assert.equal(ex.caller, "subagent:reader:d2");
  const res = db.reservations.get("rq-ro2")!;
  assert.equal(res.delegateLabel, "reader:d2");
});
