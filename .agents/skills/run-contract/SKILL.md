---
name: run-contract
description: How to work inside a LEASH run — requesting authority, honoring limits, delegating children, handling rejections.
---

# Working inside a run contract

When you are assigned a support case, your FIRST duty is to find the active
run contract for it: call `get-run` with its contractId. Know your envelope:

- Refund ceiling and remaining budget (`remainingCents`).
- How many refunds may still be issued (`maxRefunds - refundsUsed`).
- Which actions are permitted, which are forbidden.
- When the contract expires.

## The rules of the run

1. **Every side effect goes through the gate.** Before you call a
   state-changing action, decide the action's requestId (a stable id per
   intended call, e.g. `refund-<caseId>-1`) and call the action. Replaying
   the same requestId can never double-execute; that is a property, not a
   workaround.
2. **A rejection is a boundary, not an obstacle.** If the run contract
   rejects your call, do NOT retry with mutated arguments to evade the
   reason. Report the rejection honestly, then ask the issuing human.
3. **Delegation attenuates.** To bring in a child agent, call
   `delegate-contract` with a child envelope that is strictly narrower —
   fewer permitted actions, fewer refunds, tighter budget — than yours.
   Widening attempts are recorded as rejections in the ledger.
4. **Children identify themselves.** Callers execute actions with their
   `childLabel` so receipts attribute work to delegates; a child executes
   only within its declared envelope.
5. **Revocation is immediate.** If the human revokes the contract, the next
   call you make fails — your held authorization is worth nothing. Stop and
   wait for guidance; never attempt work through other surfaces.

## Rejection codes you will see

- `contract_revoked` — authority ended. Stop.
- `contract_expired` — the run's lifetime elapsed. Ask for a new contract.
- `forbidden_action` — explicitly denied; never retry.
- `action_not_permitted` — outside your permitted set; ask the issuer.
- `count_limit_exceeded` — the contract allows no more of this action type.
- `budget_exceeded` — the ceiling is spent, possibly by a concurrent call.
- `delegate_envelope_violation` — outside your own delegated envelope
  (action, amount cap, or refund count). Ask the parent to widen the
  envelope first; never impersonate another caller.
- `delegate_not_found` — you declared a childLabel that is not registered
  on this contract. Register it via `delegate-contract` first.
