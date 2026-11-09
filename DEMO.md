# LEASH demo — run-scoped authority contracts

**One command, offline, real enforcement (engine + enforcer + the exact conditional-update bridge semantics):**

```bash
pnpm demo
```

## What you will see

A support case with a $25.00 / 2-refund / 10-minute run contract. A child agent `subagent:helper` works the case; a second child `subagent:reader` is restricted to reads only.

| Beat | Action | Decision | Code | What it proves |
|------|--------|----------|------|----------------|
| 1 | Child refunds $18.00 | approved | — | Permitted action executes; remaining budget tracks correctly ($7.00 left) |
| 2 | Child transfers account owner | rejected | `forbidden_action` | Denial list beats the permit list |
| 3 | Child opens a new case | rejected | `action_not_permitted` | Actions outside the permitted set fail |
| 4 | Child refunds $7.01 | rejected | `budget_exceeded` | `$25.01 exceeds the $25.00 ceiling` — exact-cent enforcement |
| 5 | Replays beat 1's requestId | replayed | `APPROVED` | Idempotency — duplicate request never double-executes |
| 6 | Child refunds $7.00, side effect fails | approved → released | — | Failed side effect returns allowance; RELEASED receipt written |
| 7 | Reader child refunds $1.00 | rejected | `delegate_envelope_violation` | Execution-time attenuation — child enforced against its own narrower envelope, not just the contract |
| 8 | Parent revokes the contract | rejected | `contract_revoked` | Revocation kills every held authorization immediately |
| 9 | Receipt ledger | — | — | Every decision recorded: EXECUTED, REJECTED:<code>, REPLAYED, RELEASED, REVOKED |

## Terminal output

```
— Beat 1: child agent performs an ALLOWED action
  decision: approved | receipt rq-01 | 700 cents remaining

— Beat 2: child attempts an action OUTSIDE its delegation (forbidden list)
  decision: rejected | forbidden_action | change-account-owner is forbidden under this run contract

— Beat 3: child attempts an action NOT IN the permitted set
  decision: rejected | action_not_permitted | open-case is not in the permitted set

— Beat 4: child attempts to EXCEED the budget ($18.00 spent + $7.01 vs $25.00)
  decision: rejected | budget_exceeded | total $25.01 exceeds the $25.00 ceiling

— Beat 5: duplicate requestId replays — no double execution
  decision: replayed | replayOf: APPROVED

— Beat 6: failed side effect releases the allowance
  approved: approved | receipt: rq-06
  side effect failed -> released: true | allowance returned, RELEASED receipt written

— Beat 7: reader child acts OUTSIDE ITS OWN envelope (attenuation, enforced live)
  decision: rejected | delegate_envelope_violation | issue-refund is not in child 'reader's delegated envelope

— Beat 8: parent REVOKES the delegation; further use is rejected
  decision: rejected | contract_revoked | run contract revoked by issuer

— Beat 9: the receipt ledger shows what happened and why
  [EXECUTED ] subagent:helper     issue-refund          $18.00
  [RELEASED ] system              issue-refund          $7.00 released_after_failure
  [EXECUTED ] subagent:helper     issue-refund          $7.00
  [REJECTED ] subagent:helper     change-account-owner  $0.00 delegate_envelope_violation
  [REJECTED ] subagent:reader:d2  issue-refund          $1.00 delegate_envelope_violation
  [REPLAYED ] subagent:helper     issue-refund          $18.00 APPROVED
  [REJECTED ] subagent:helper     inspect-order         $0.00 contract_revoked
  [REVOKED  ] issuer
  [REJECTED ] subagent:helper     issue-refund          $7.01 budget_exceeded
  [REJECTED ] subagent:helper     open-case             $0.00 action_not_permitted

DEMO OK — 2 executed (1 released), 5 rejected, 1 replayed, 1 revoked; net spend $18.00 of $25.00
```

## UI walkthrough (control room, `/run/<contractId>`)

Open `pnpm dev`, then:

1. **Issue a contract** — open a support case, set refund ceiling ($25.00), max refunds (2), lifetime (10 min), permitted actions (`inspect-order`, `issue-refund`, `draft-response`), forbidden (`change-account-owner`). Navigate to the control room.
2. **Run enforcement beats** — one-tap buttons: Inspect order (EXECUTED), Refund $18.00 (EXECUTED), Refund $70.00 (REJECTED budget_exceeded), Change account owner (REJECTED forbidden_action), Delegate child (narrower envelope), Child tries refund (REJECTED delegate_envelope_violation), Replay last refund (REPLAYED), Revoke run.
3. **Watch the receipt ledger** — every decision appends to `contract_events`; the control room renders it live with type, code, caller, and amount.
4. **Watch the budget bar** — remaining cents and refunds-used update after every call.
5. **Click Revoke** — every subsequent beat is rejected with `contract_revoked`.

## The invariant

**A delegated sub-agent must never possess more authority than its parent.** Beat 7 proves this at execution time: the `reader` child's envelope is narrower than the contract's, and the enforcer rejects its refund even though the contract itself would allow it.
