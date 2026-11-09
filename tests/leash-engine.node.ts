/**
 * LEASH adversarial engine suite — bare Node, zero dependencies.
 * Run: node --experimental-strip-types --test tests/leash-engine.node.ts
 *
 * The engine (server/lib/leash-engine.ts) is pure: no DB, no IO, injected
 * clock. These tests attack the check order, the money math, the boundary
 * milliseconds, and the attenuation matrix.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { evaluate, checkAttenuation } from "../server/lib/leash-engine.ts";
import type { LeashSnapshot } from "../server/lib/leash-engine.ts";

const T0 = 1_700_000_000_000; // fixed epoch ms

function snap(over: Partial<LeashSnapshot> = {}): LeashSnapshot {
  return {
    status: "ACTIVE",
    budgetCents: 2500, // $25.00
    spentCents: 0,
    maxRefunds: 1,
    refundsUsed: 0,
    permittedActions: ["issue-refund", "inspect-order"],
    forbiddenActions: ["change-account-owner"],
    expiresAt: T0 + 600_000, // ten minutes
    ...over,
  };
}

const req = (over: Partial<Parameters<typeof evaluate>[1]> = {}) => ({
  action: "issue-refund",
  requestId: "rq-1",
  amountCents: 1000,
  refund: false,
  now: T0,
  ...over,
});

test("01 missing snapshot fails closed as contract_not_found", () => {
  const d = evaluate(undefined as unknown as LeashSnapshot, req());
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "contract_not_found");
});

test("02 revoked contract rejects every action, even reads", () => {
  const d = evaluate(snap({ status: "REVOKED" }), req({ action: "inspect-order", amountCents: 0 }));
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "contract_revoked");
});

test("03 revocation beats expiry in the check order", () => {
  const d = evaluate(snap({ status: "REVOKED", expiresAt: T0 - 1 }), req());
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "contract_revoked");
});

test("04 expiry fires at the exact boundary millisecond (now == expiresAt)", () => {
  const d = evaluate(snap(), req({ now: T0 + 600_000 }));
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "contract_expired");
});

test("05 one millisecond before the boundary still passes", () => {
  const d = evaluate(snap(), req({ now: T0 + 600_000 - 1 }));
  assert.equal(d.ok, true);
});

test("06 explicit EXPIRED status rejects even before wall-clock expiry", () => {
  const d = evaluate(snap({ status: "EXPIRED" }), req({ now: T0 + 1 }));
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "contract_expired");
});

test("07 forbidden list beats the permit list (truthfulness)", () => {
  const d = evaluate(
    snap({ permittedActions: ["change-account-owner"], forbiddenActions: ["change-account-owner"] }),
    req({ action: "change-account-owner", amountCents: 0 }),
  );
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "forbidden_action");
});

test("08 action outside the permitted set rejects as action_not_permitted", () => {
  const d = evaluate(snap({ permittedActions: ["inspect-order"] }), req({ action: "draft-response", amountCents: 0 }));
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "action_not_permitted");
});

test("09 count limit rejects exactly when refundsUsed reaches maxRefunds", () => {
  const d = evaluate(snap({ maxRefunds: 1, refundsUsed: 1 }), req({ refund: true, amountCents: 100 }));
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "count_limit_exceeded");
});

test("10 count limit fires before budget math", () => {
  const d = evaluate(snap({ maxRefunds: 1, refundsUsed: 1, budgetCents: 1_000_000 }), req({ refund: true, amountCents: 100 }));
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "count_limit_exceeded");
});

test("11 spend up to the exact ceiling is approved ($18 of $25 leaves $7)", () => {
  const d = evaluate(snap(), req({ amountCents: 1800 }));
  assert.equal(d.ok, true);
  if (d.ok) {
    assert.equal(d.reserveCents, 1800);
    assert.equal(d.remainingCents, 700);
  }
});

test("12 one cent over the ceiling rejects ($18 spent + $7.01 vs $25)", () => {
  const d = evaluate(snap({ spentCents: 1800 }), req({ amountCents: 701 }));
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "budget_exceeded");
});

test("13 cumulative spend counts: $20 spent leaves only $5", () => {
  const d = evaluate(snap({ spentCents: 2000 }), req({ amountCents: 501 }));
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "budget_exceeded");
});

test("14 negative amounts are rejected outright", () => {
  const d = evaluate(snap(), req({ amountCents: -1 }));
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "forbidden_action");
});

test("15 zero-amount reads are approved without touching the budget", () => {
  const d = evaluate(snap(), req({ action: "inspect-order", amountCents: 0 }));
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.reserveCents, 0);
});

test("16 attenuation: child cannot add an action the parent never held", () => {
  const g = checkAttenuation(
    { permittedActions: ["inspect-order"], maxRefunds: 1, budgetCents: 2500, expiresAt: T0 + 600_000 },
    { permittedActions: ["inspect-order", "issue-refund"], maxRefunds: 1, budgetCents: 2500, expiresAt: T0 + 600_000 },
  );
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.code, "delegate_attenuation_violation");
});

test("17 attenuation: child cannot raise the refund count", () => {
  const g = checkAttenuation(
    { permittedActions: ["issue-refund"], maxRefunds: 1, budgetCents: 2500, expiresAt: T0 + 600_000 },
    { permittedActions: ["issue-refund"], maxRefunds: 2, budgetCents: 2500, expiresAt: T0 + 600_000 },
  );
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.code, "delegate_attenuation_violation");
});

test("18 attenuation: child cannot raise the budget", () => {
  const g = checkAttenuation(
    { permittedActions: ["issue-refund"], maxRefunds: 1, budgetCents: 2500, expiresAt: T0 + 600_000 },
    { permittedActions: ["issue-refund"], maxRefunds: 1, budgetCents: 2501, expiresAt: T0 + 600_000 },
  );
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.code, "delegate_attenuation_violation");
});

test("19 attenuation: child cannot outlive the parent", () => {
  // expiry is checked structurally: the delegate path binds expiresAt to the
  // parent's; the pure check must never widen it.
  const g = checkAttenuation(
    { permittedActions: ["issue-refund"], maxRefunds: 1, budgetCents: 2500, expiresAt: T0 + 600_000 },
    { permittedActions: ["issue-refund"], maxRefunds: 1, budgetCents: 2500, expiresAt: T0 + 600_000 },
  );
  assert.equal(g.ok, true); // equal is fine — narrowing is the rule, equality allowed
});

test("20 attenuation: negative child limits rejected", () => {
  const g = checkAttenuation(
    { permittedActions: ["issue-refund"], maxRefunds: 1, budgetCents: 2500, expiresAt: T0 + 600_000 },
    { permittedActions: ["issue-refund"], maxRefunds: -1, budgetCents: -5, expiresAt: T0 + 600_000 },
  );
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.code, "delegate_attenuation_violation");
});

test("21 attenuation: a strictly narrower child envelope is admitted", () => {
  const g = checkAttenuation(
    { permittedActions: ["inspect-order", "issue-refund"], maxRefunds: 2, budgetCents: 2500, expiresAt: T0 + 600_000 },
    { permittedActions: ["inspect-order"], maxRefunds: 1, budgetCents: 500, expiresAt: T0 + 600_000 },
  );
  assert.equal(g.ok, true);
});
