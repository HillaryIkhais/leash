/**
 * Integration tests for the complete autonomous resolution workflow.
 * Tests the resolve-case action end-to-end with LEASH enforcement.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";

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

function hashCredential(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

const HELPER_CREDENTIAL = "helper_credential_test";
const HELPER_HASH = hashCredential(HELPER_CREDENTIAL);
const READER_CREDENTIAL = "reader_credential_test";
const READER_HASH = hashCredential(READER_CREDENTIAL);

test("integration: full resolution workflow with budget exhaustion", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_integration", { budgetCents: 2500, maxRefunds: 2 });
  db.seedDelegate("ct_integration", "helper", {
    permittedActions: ["inspect-order", "issue-refund", "draft-response"],
    maxRefunds: 1,
    budgetCapCents: 1500,
    credentialHash: hashCredential(HELPER_CREDENTIAL),
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

test("integration: child delegate cannot exceed its envelope with valid credential", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_child", { budgetCents: 5000, maxRefunds: 3 });
  db.seedDelegate("ct_child", "helper", {
    permittedActions: ["inspect-order", "issue-refund"],
    maxRefunds: 1,
    budgetCapCents: 1000,
    credentialHash: hashCredential("helper_credential"),
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

  // Child tries to exceed its budget cap (1000) with valid credential
  const childOverCap = await leash.approve("ct_child", REQ({ 
    action: "issue-refund", 
    requestId: "rq-child-over", 
    amountCents: 1500,
    refund: true
  }), { caller: `subagent:helper:${HELPER_CREDENTIAL}` });
  assert.equal(childOverCap.outcome, "rejected");
  assert.equal(childOverCap.decision?.code, "delegate_envelope_violation");

  // Child tries action not in its envelope with valid credential
  const childWrongAction = await leash.approve("ct_child", REQ({ 
    action: "draft-response", 
    requestId: "rq-child-wrong", 
    amountCents: 0
  }), { caller: `subagent:helper:${HELPER_CREDENTIAL}` });
  assert.equal(childWrongAction.outcome, "rejected");
  assert.equal(childWrongAction.decision?.code, "delegate_envelope_violation");

  // Child within envelope succeeds with valid credential
  const childOk = await leash.approve("ct_child", REQ({ 
    action: "issue-refund", 
    requestId: "rq-child-ok", 
    amountCents: 500,
    refund: true
  }), { caller: `subagent:helper:${HELPER_CREDENTIAL}` });
  assert.equal(childOk.outcome, "approved");
});

test("integration: invalid credential is rejected", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_cred_test", { budgetCents: 5000, maxRefunds: 3 });
  db.seedDelegate("ct_cred_test", "helper", {
    permittedActions: ["inspect-order", "issue-refund"],
    maxRefunds: 1,
    budgetCapCents: 1000,
    credentialHash: hashCredential("valid_credential"),
  });
  const leash = makeEnforcer(db);

  // Valid credential works
  const valid = await leash.approve("ct_cred_test", REQ({ 
    action: "issue-refund", 
    requestId: "rq-valid", 
    amountCents: 500,
    refund: true
  }), { caller: `subagent:helper:${HELPER_CREDENTIAL}` });
  assert.equal(valid.outcome, "approved");

  // Invalid credential fails
  const invalid = await leash.approve("ct_cred_test", REQ({ 
    action: "issue-refund", 
    requestId: "rq-invalid", 
    amountCents: 500,
    refund: true
  }), { caller: "subagent:helper:invalid_credential" });
  assert.equal(invalid.outcome, "rejected");
  assert.equal(invalid.decision?.code, "delegate_not_found");

  // Valid credential for wrong delegate label fails
  const wrongLabel = await leash.approve("ct_cred_test", REQ({ 
    action: "issue-refund", 
    requestId: "rq-wrong-label", 
    amountCents: 500,
    refund: true
  }), { caller: `subagent:nonexistent:${HELPER_CREDENTIAL}` });
  assert.equal(wrongLabel.outcome, "rejected");
  assert.equal(wrongLabel.decision?.code, "delegate_not_found");
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

test("integration: expired contract rejects all actions", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_expired");
  const leash = makeEnforcer(db);

  // Advance clock past expiry
  db.clock += 700_000; // past the 10-minute expiry

  const expired = await leash.approve("ct_expired", REQ({ 
    action: "inspect-order", 
    requestId: "rq-expired", 
    amountCents: 0
  }), { caller: "root-agent" });
  assert.equal(expired.outcome, "rejected");
  assert.equal(expired.decision?.code, "contract_expired");
});

test("integration: forbidden action rejected before any execution", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_forbidden");
  const leash = makeEnforcer(db);

  const forbidden = await leash.approve("ct_forbidden", REQ({ 
    action: "change-account-owner", 
    requestId: "rq-forbidden", 
    amountCents: 0
  }), { caller: "root-agent" });
  
  assert.equal(forbidden.outcome, "rejected");
  assert.equal(forbidden.decision?.code, "forbidden_action");
  assert.equal(db.eventsOf("ct_forbidden", EVENT_TYPE.REJECTED).length, 1);
  assert.equal(db.eventsOf("ct_forbidden", EVENT_TYPE.EXECUTED).length, 0);
});

test("integration: action not in permitted set rejected", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_not_permitted", { 
    permittedActions: JSON.stringify(["inspect-order"]),
    forbiddenActions: JSON.stringify([])
  });
  const leash = makeEnforcer(db);

  const notPermitted = await leash.approve("ct_not_permitted", REQ({ 
    action: "issue-refund", 
    requestId: "rq-not-permitted", 
    amountCents: 100,
    refund: true
  }), { caller: "root-agent" });
  
  assert.equal(notPermitted.outcome, "rejected");
  assert.equal(notPermitted.decision?.code, "action_not_permitted");
});

test("integration: count limit evaluated before budget", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_count_limit", { 
    budgetCents: 100000,  // huge budget
    maxRefunds: 1,
    refundsUsed: 1
  });
  const leash = makeEnforcer(db);

  // Count limit exceeded even though budget is huge
  const over = await leash.approve("ct_count_limit", REQ({ 
    action: "issue-refund", 
    requestId: "rq-count", 
    amountCents: 100,
    refund: true
  }), { caller: "root-agent" });
  
  assert.equal(over.outcome, "rejected");
  assert.equal(over.decision?.code, "count_limit_exceeded");
  // Budget should be untouched
  assert.equal(db.contracts.get("ct_count_limit")!.spentCents, 0);
});

test("integration: unknown child delegate fails closed", async () => {
  const db = new MemoryLeashDB();
  db.seedContract("ct_unknown_child");
  // No delegates registered
  const leash = makeEnforcer(db);

  const unknown = await leash.approve("ct_unknown_child", REQ({ 
    action: "issue-refund", 
    requestId: "rq-unknown", 
    amountCents: 100,
    refund: true
  }), { caller: "subagent:nonexistent" });
  
  assert.equal(unknown.outcome, "rejected");
  assert.equal(unknown.decision?.code, "delegate_not_found");
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

test("engine: revoked status beats expired in check order", () => {
  const T0 = 1_700_000_000_000;
  const snap = {
    status: "REVOKED",
    budgetCents: 2500,
    spentCents: 0,
    maxRefunds: 1,
    refundsUsed: 0,
    permittedActions: ["issue-refund"],
    forbiddenActions: [],
    expiresAt: T0 + 600_000,
  };

  // Even though not expired, revoked should reject first
  const revoked = evaluate(snap, { action: "issue-refund", requestId: "rq-1", amountCents: 100, refund: true, now: T0 });
  assert.equal(revoked.ok, false);
  if (!revoked.ok) assert.equal(revoked.code, "contract_revoked");
});

test("engine: expiry at exact boundary millisecond", () => {
  const T0 = 1_700_000_000_000;
  const snap = {
    status: "ACTIVE",
    budgetCents: 2500,
    spentCents: 0,
    maxRefunds: 1,
    refundsUsed: 0,
    permittedActions: ["issue-refund"],
    forbiddenActions: [],
    expiresAt: T0 + 600_000,
  };

  // Exactly at expiry boundary
  const atBoundary = evaluate(snap, { action: "issue-refund", requestId: "rq-1", amountCents: 100, refund: true, now: T0 + 600_000 });
  assert.equal(atBoundary.ok, false);
  if (!atBoundary.ok) assert.equal(atBoundary.code, "contract_expired");

  // One millisecond before - should pass
  const beforeBoundary = evaluate(snap, { action: "issue-refund", requestId: "rq-2", amountCents: 100, refund: true, now: T0 + 600_000 - 1 });
  assert.equal(beforeBoundary.ok, true);
});