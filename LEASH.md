# LEASH — the authority contract for autonomous work

A human issues a **run contract** — refund ceiling $25, max one refund,
permitted and forbidden actions, ten minutes to live. Every agent, child
agent, and connected MCP client that touches that case inherits and is
enforced against the same live contract, until the human ends it.

**The framework decides whether a caller may call an action. LEASH decides
whether this run may continue.**

Framework authorization (RBAC, `authorize`, org membership, OAuth scopes)
is deployment-static: who-by-deployment may run what. LEASH is the missing
layer — run-scoped, cumulative, attenuative, expiring, revocable.

## The six properties (each has a test or a live demo beat)

| # | Property | Where it lives |
|---|---|---|
| 1 | **Atomic budget reservation** — concurrent calls cannot both spend the last allowance | `holdBudget()` conditional update, `server/lib/leash-db-bridge.ts`; enforcer unwind in `leash-enforce.ts` `approve()` |
| 2 | **Delegation attenuation** — child envelope always narrower than parent | `delegate-contract.ts` + `checkAttenuation()` (`server/lib/leash-engine.ts`) |
| 3 | **Run-wide enforcement** — same gate for UI/agent/HTTP/MCP callers | every `actions/*.ts` calls `leash.approve()` first; caller resolved from dispatch surface |
| 4 | **Immediate revocation** — held authorizations die; there is no grace for a cached token | contract re-read from DB at every evaluation; `revoke-contract.ts` |
| 5 | **Idempotency** — replay cannot double-execute | `requestId` reservation insert; `REPLAYED` receipts |
| 6 | **Immutable receipts** — executed, replayed, rejected, released, revoked distinguishable | `contract_events` append-only ledger |

## Test coverage

Run the engine's adversarial suite (zero dependencies, Node built-ins):

```
node --experimental-strip-types --test tests/leash-engine.node.ts
```

15/15 passing: revocation precedes everything; expiry holds at the exact
boundary millisecond; forbidden beats not-permitted in truthfulness; count
limit fires before budget math; the $25 ceiling is exact (integer cents —
$18 leaves $7, one cent over rejects); the attenuation matrix rejects
child action-, count-, and budget-widening.

## Honesty table

- Demo refunds are simulated; no payment rail is wired.
- Child-agent identity is **declared** (`childLabel` in the call), not
  cryptographic; the enforcer records it, and the ledger shows the claim.
- The events ledger is append-only by code convention (never updated by
  the wrapper); not hardened against a raw SQL writer.
- The DB bridge uses conditional single-statement updates for atomic
  holds; correctness under concurrency is the UPDATE clause, not
  transaction isolation.
- The `mcp:<label>` caller attribution relies on the framework's MCP
  dispatch context.

## File map

```
server/lib/leash-engine.ts      pure decision engine (revoked→expired→forbidden→permitted→count→budget)
server/lib/leash-enforce.ts     replay/holds/settle/release lifecycle around the engine
server/lib/leash-db-bridge.ts   drizzle bridge: conditional updates, double-spend-proof
server/lib/leash-constants.ts   shared enums
server/db/schema.ts             contracts, delegates, reservations, events, support cases
actions/*.ts                    issue/revoke/delegate contracts; inspect/refund/draft/owner/get-run
tests/leash-engine.node.ts      the adversarial suite
```
