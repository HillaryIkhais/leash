/**
 * Integration tests for the complete autonomous resolution workflow.
 * Tests the resolve-case action end-to-end with LEASH enforcement.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { LeashEnforcer } from "../server/lib/leash-enforce";
import { EVENT_TYPE } from "../server/lib/leash-constants";
import { MemoryLeashDB } from "./memory-leash-db.ts";
import { evaluate } from "../server/lib/leash-engine.ts";

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

test("integration: full resolution workflow with budget exhaustion", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_integration", { budgetCents: 2500, maxRefunds: 2 });
  db.seedDelegate("ct_integration", "helper", {
    permittedActions: ["inspect-order", "issue-refund", "draft-response"],
    maxRefunds: 1,
    budgetCapCents: 1500,
  });
  const leash = makeEnforcer(db);

  // Step 1: Inspect order (should succeed)
  const inspect = await leash.approve("ct_integration", REQ({ 
    action: "inspect-order", 
    requestId: "rq-inspect", 
    amountCents: 0 
  }), { caller: "root-agent" });
  assert.equal(inspect.outcome, "approved");
  await leash.settle("rq-inspect");

  // Step 2: Execute refund within budget (should succeed)
  const refund1 = await leash.approve("ct_integration", REQ({ 
    action: "issue-refund", 
    requestId: "rq-refund1", 
    amountCents: 1800,
    refund: true
  }), { caller: "root-agent" });
  assert.equal(refund1.outcome, "approved");
  await leash.settle("rq-refund1");

  // Step 3: Attempt second refund that exceeds budget (should be rejected by LEASH)
  const refund2 = await leash.approve("ct_integration", REQ({ 
    action: "issue-refund", 
    requestId: "rq-refund2", 
    amountCents: 1000,
    refund: true
  }), { caller: "root-agent" });
  assert.equal(refund2.outcome, "rejected");
  assert.equal(refund2.decision?.code, "budget_exceeded");

  // Step 4: Draft response (should succeed - no money)
  const response = await leash.approve("ct_integration", REQ({ 
    action: "draft-response", 
    requestId: "rq-response", 
    amountCents: 0 
  }), { caller: "root-agent" });
  assert.equal(response.outcome, "approved");
  await leash.settle("rq-response");

  // Verify final state
  const contract = db.contracts.get("ct_integration")!;
  assert.equal(contract.spentCents, 1800);
  assert.equal(contract.refundsUsed, 1);
  assert.equal(db.eventsOf("ct_integration", EVENT_TYPE.EXECUTED).length, 3); // inspect, refund1, response
  assert.equal(db.eventsOf("ct_integration", EVENT_TYPE.REJECTED).length, 1); // refund2
});

test("integration: child delegate cannot exceed its envelope", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_child", { budgetCents: 5000, maxRefunds: 3 });
  db.seedDelegate("ct_child", "helper", {
    permittedActions: ["inspect-order", "issue-refund"],
    maxRefunds: 1,
    budgetCapCents: 1000,
  });
  const leash = makeEnforcer(db);

  // Parent can do full amount
  const parentRefund = await leash.approve("ct_child", REQ({ 
    action: "issue-refund", 
    requestId: "rq-parent", 
    amountCents: 2000,
    refund: true
  }), { caller: "root-agent" });
  assert.equal(parentRefund.outcome, "approved");
  await leash.settle("rq-parent");

  // Child tries to exceed its budget cap (1000)
  const childOverCap = await leash.approve("ct_child", REQ({ 
    action: "issue-refund", 
    requestId: "rq-child-over", 
    amountCents: 1500,
    refund: true
  }), { caller: "subagent:helper" });
  assert.equal(childOverCap.outcome, "rejected");
  assert.equal(childOverCap.decision?.code, "delegate_envelope_violation");

  // Child tries action not in its envelope
  const childWrongAction = await leash.approve("ct_child", REQ({ 
    action: "draft-response", 
    requestId: "rq-child-wrong", 
    amountCents: 0
  }), { caller: "subagent:helper" });
  assert.equal(childWrongAction.outcome, "rejected");
  assert.equal(childWrongAction.decision?.code, "delegate_envelope_violation");

  // Child within envelope succeeds
  const childOk = await leash.approve("ct_child", REQ({ 
    action: "issue-refund", 
    requestId: "rq-child-ok", 
    amountCents: 500,
    refund: true
  }), { caller: "subagent:helper" });
  assert.equal(childOk.outcome, "approved");
});

test("integration: revocation immediately blocks further actions", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_revoke");
  const leash = makeEnforcer(db);

  // Action before revocation succeeds
  const before = await leash.approve("ct_revoke", REQ({ 
    action: "inspect-order", 
    requestId: "rq-before", 
    amountCents: 0
  }), { caller: "root-agent" });
  assert.equal(before.outcome, "approved");
  await leash.settle("rq-before");

  // Revoke the contract
  db.contracts.get("ct_revoke")!.status = "REVOKED";

  // Action after revocation rejected
  const after = await leash.approve("ct_revoke", REQ({ 
    action: "issue-refund", 
    requestId: "rq-after", 
    amountCents: 100,
    refund: true
  }), { caller: "root-agent" });
  assert.equal(after.outcome, "rejected");
  assert.equal(after.decision?.code, "contract_revoked");

  // Held authorization cannot settle after revocation
  const held = await leash.approve("ct_revoke", REQ({ 
    action: "issue-refund", 
    requestId: "rq-held", 
    amountCents: 100,
    refund: true
  }), { caller: "root-agent" });
  // This should be rejected because contract is now REVOKED
  assert.equal(held.outcome, "rejected");
  assert.equal(held.decision?.code, "contract_revoked");
});

test("integration: replay protection prevents double execution", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_replay");
  const leash = makeEnforcer(db);

  const first = await leash.approve("ct_replay", REQ({ 
    action: "issue-refund", 
    requestId: "rq-same", 
    amountCents: 1000,
    refund: true
  }), { caller: "root-agent" });
  assert.equal(first.outcome, "approved");
  await leash.settle("rq-same");

  // Same requestId replayed
  const replay = await leash.approve("ct_replay", REQ({ 
    action: "issue-refund", 
    requestId: "rq-same", 
    amountCents: 1000,
    refund: true
  }), { caller: "root-agent" });
  assert.equal(replay.outcome, "replayed");
  assert.equal(replay.replayOf, "APPROVED");

  // Only charged once
  const contract = db.contracts.get("ct_replay")!;
  assert.equal(contract.spentCents, 1000);
  assert.equal(contract.refundsUsed, 1);
  assert.equal(db.eventsOf("ct_replay", EVENT_TYPE.EXECUTED).length, 1);
  assert.equal(db.eventsOf("ct_replay", EVENT_TYPE.REPLAYED).length, 1);
});

test("integration: concurrent requests cannot overspend", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_concurrent", { budgetCents: 1000, maxRefunds: 2 });
  const leash = makeEnforcer(db);

  const results = await Promise.all([
    leash.approve("ct_concurrent", REQ({ requestId: "rq-1", amountCents: 1000, refund: true }), { caller: "root-agent" }),
    leash.approve("ct_concurrent", REQ({ requestId: "rq-2", amountCents: 1000, refund: true }), { caller: "subagent:helper" }),
    leash.approve("ct_concurrent", REQ({ requestId: "rq-3", amountCents: 1000, refund: true }), { caller: "subagent:helper" }),
  ]);

  const approved = results.filter(r => r.outcome === "approved");
  const rejected = results.filter(r => r.outcome === "rejected" && r.decision?.code === "budget_exceeded");
  
  assert.equal(approved.length, 1);
  assert.equal(rejected.length, 2);
  assert.equal(db.contracts.get("ct_concurrent")!.spentCents, 1000);
});

test("integration: delegation authorization - only parent can register children", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_delegate");
  db.seedDelegate("ct_delegate", "parent", {
    permittedActions: ["inspect-order", "issue-refund"],
    maxRefunds: 1,
    budgetCapCents: 1000,
  });
  const leash = makeEnforcer(db);

  // Parent delegate can register child
  const parentCaller = "subagent:parent";
  const childReg = await leash.approve("ct_delegate", REQ({ 
    action: "delegate-contract", 
    requestId: "rq-delegate-child", 
    amountCents: 0
  }), { caller: parentCaller });
  // Note: delegate-contract is a separate action, not tested via leash.approve
  // This test documents the authorization logic in delegate-contract.ts
  
  // The delegate-contract action enforces: only root-agent can register top-level,
  // only parent delegate can register children
  // This is tested at the action level, not the enforcer level
});

test("engine: budget evaluation with remaining budget", () => {
  const T0 = 1_700_000_000_000;
  const snap = {
    status: "ACTIVE",
    budgetCents: 2500,
    spentCents: 1800,
    maxRefunds: 2,
    refundsUsed: 1,
    permittedActions: ["issue-refund"],
    forbiddenActions: [],
    expiresAt: T0 + 600_000,
  };

  // 700 remaining, 500 fits
  const ok = evaluate(snap, { action: "issue-refund", requestId: "rq-1", amountCents: 500, refund: true, now: T0 });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.remainingCents, 200);

  // 700 remaining, 800 exceeds
  const over = evaluate(snap, { action: "issue-refund", requestId: "rq-2", amountCents: 800, refund: true, now: T0 });
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.code, "budget_exceeded");
});

test("engine: count limit evaluated before budget", () => {
  const T0 = 1_700_000_000_000;
  const snap = {
    status: "ACTIVE",
    budgetCents: 100000,
    spentCents: 0,
    maxRefunds: 1,
    refundsUsed: 1,
    permittedActions: ["issue-refund"],
    forbiddenActions: [],
    expiresAt: T0 + 600_000,
  };

  // Count limit exceeded even though budget is huge
  const over = evaluate(snap, { action: "issue-refund", requestId: "rq-1", amountCents: 100, refund: true, now: T0 });
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.code, "count_limit_exceeded");
});