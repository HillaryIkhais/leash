# LEASH — the authority contract for autonomous work

LEASH is a run-scoped authority contract for autonomous agents. A human issues
one live contract — *refund ceiling $25, max two refunds, these actions
permitted, that one forbidden, expires in ten minutes* — and every caller that
touches the run (parent agent, delegated child agents, MCP-connected tools,
UI, HTTP) is enforced against the same contract at every side effect, until
the human ends it.

**The framework decides whether a *caller* may call an action (RBAC, OAuth,
org roles). LEASH decides whether this *run* may continue.**

## The moment it matters

Your agent is authorized to refund up to $25 on a damaged order. It issues a
$18 refund. Then it retries the same request — without LEASH, that retry is a
second $18. Your agent spawns a child to investigate; without LEASH, that child
inherits the full $25 ceiling, not the $7 left. You hit revoke because the
customer changed their mind; without LEASH, held authorizations often keep
working because they were cached at deploy time.

Ordinary agent permissions answer "who may call this tool?" — set once, static,
per-deployment. They cannot answer what matters *during* a specific case:

- How much money may this run move in total? (cumulative, not per-call)
- How many times may it act? (count, not just scope)
- Until when is any of this valid? (expiry)
- If a child agent is spawned, how much authority does it inherit? (attenuation)
- If the human changes their mind mid-run, what stops the next call? (revocation)
- If a request is retried, what stops a double refund? (idempotency)

Without run-scoped answers, a delegated sub-agent silently inherits everything
its parent can do, retries double-spend, and a "stop" has no guaranteed
enforcement point. LEASH is that missing layer.

## How it works

A run contract is a row in `contracts`: integer-cent budget, refund count,
permitted/forbidden action lists, expiry (epoch ms), status. Every gated
action calls the same gate before any side effect:

```
approveForCase(caseId, { action, amountCents, requestId }, { caller })
  │
  ├─ replay check: same requestId?  → return the earlier receipt (idempotency)
  ├─ evaluate() — the pure engine, in check order:
  │     1. revoked      → contract_revoked
  │     2. expired      → contract_expired   (enforcer's clock, not the caller's)
  │     3. forbidden    → forbidden_action   (denial list beats the permit list)
  │     4. not permitted→ action_not_permitted
  │     5. count limit  → count_limit_exceeded
  │     6. budget       → budget_exceeded    (integer cents: spent + amount ≤ budget)
  ├─ atomic holds — single conditional UPDATEs against the contract row:
  │     UPDATE contracts SET spent_cents = spent_cents + amt
  │     WHERE id = ? AND status = 'ACTIVE' AND spent_cents + amt <= budget_cents
  │    Two concurrent calls cannot both spend the last allowance: one UPDATE
  │    wins, the loser sees zero rows changed, unwinds its count hold, and is
  │    rejected with the race recorded in the ledger.
  └─ after the real side effect: settle() (hold → permanent spend)
         or on failure: release() (allowance and count return, receipt stays)
```

### Delegation attenuation

The core invariant: **a delegated sub-agent must never possess more authority
than its parent.** `delegate-contract` checks the child's envelope against the
parent's with `checkAttenuation()` before any delegate row is written — a
child may narrow the action set, refund count, and budget cap, and may never
widen any axis. Widening attempts are rejected and recorded in the ledger.
At execution time every caller draws from the same contract pool, so child
spend counts against the parent's budget, never a fresh one.

### Revocation and expiry

The contract is re-read from the database at every evaluation — there is no
cached token to outlive its authority. `revoke-contract` (human-only) flips
the status; the next call from any caller is rejected with
`contract_revoked`. Expiry uses the enforcer's server clock at evaluation
time; the request payload carries no time (a caller cannot talk its way past
the wall).

### MCP and caller identity

Actions run through any dispatch surface (UI, agent tool, HTTP, MCP) hit the
same gate. The caller string is resolved from framework-verified context:
`frontend`, `root-agent`, `subagent:<label>:d<depth>`, or
`mcp:<client-name>` — and lands in every receipt.

## The receipts

Every decision appends to `contract_events`: `ISSUED`, `DELEGATED`,
`EXECUTED`, `REJECTED:<code>`, `REPLAYED`, `RELEASED`, `REVOKED`. The ledger
is the audit trail — the control room (`/run`) renders it live, and
`get-run` returns the same truth to the agent and to MCP clients.

## Reproducible demonstration

One command, offline, real enforcement paths (engine + enforcer + the exact
conditional-update bridge semantics; no database needed):

```bash
pnpm demo
```

What you will see — a child agent `subagent:helper` (full envelope) and a
second child `subagent:reader` (reads only) under a $25.00 / 2-refund /
10-minute contract:

1. Allowed refund of $18.00 → `approved`, $7.00 remaining
2. `change-account-owner` → rejected `forbidden_action` (on the denial list)
3. `open-case` → rejected `action_not_permitted` (not in the permitted set)
4. Another refund of $7.01 → rejected `budget_exceeded` (`total $25.01 exceeds the $25.00 ceiling`)
5. Replaying the first requestId → `replayed`, no double execution
6. A $7.00 refund whose side effect fails → `released`, allowance returned
7. The `reader` child attempts a refund → rejected `delegate_envelope_violation` (its own envelope, enforced live)
8. The parent revokes; the next call → rejected `contract_revoked`
9. The receipt ledger prints the whole story

## Install, configure, run

Requires Node ≥ 22.22 and pnpm 10 (via corepack).

```bash
git clone https://github.com/HillaryIkhais/leash.git
cd leash
./scripts/lean-install.sh   # or: corepack enable && pnpm install --frozen-lockfile && pnpm test
```

Configuration (`.env`, see `.env.example`): auth is on by default;
`BETTER_AUTH_SECRET` for production; `AUTH_DISABLED=true` only for local
preview. No payment rail is configured — refunds are recorded side effects.

Run it:

```bash
pnpm dev      # the app: chat, run control room at /run
pnpm test     # the security suites (offline)
pnpm demo     # the enforcement demonstration (offline)
```

The live workflow: open a support case, issue the run contract (human-only
action), then work the case from chat or the run board — every beat is
enforced and receipted.

## Tests

Two suites, zero runtime dependencies beyond Node built-ins:

```bash
pnpm test
# or explicitly:
node --experimental-transform-types --import ./tests/register-ts-resolve.mjs \
  --test tests/leash-engine.node.ts tests/leash-enforce.node.ts
```

- `tests/leash-engine.node.ts` — 21 adversarial cases against the pure
  engine: check-order truthfulness, boundary milliseconds, exact-cent
  ceilings, the attenuation matrix.
- `tests/leash-enforce.node.ts` — 22 lifecycle cases: replay/idempotency,
  concurrent double-spend races, hold unwind, release-after-failure,
  revocation before execution, receipt distinctions. The in-memory bridge
  implements exactly the drizzle bridge's conditional-update semantics, so
  concurrent tests race through genuine microtask interleaving.

## Architecture

```
server/lib/leash-engine.ts      pure decision engine (no DB, no IO, injected clock)
server/lib/leash-enforce.ts     replay / holds / delegate-envelope / settle / release lifecycle
server/lib/leash-db-bridge.ts   drizzle bridge: conditional updates, double-spend-proof
server/lib/leash-constants.ts   shared enums, canonical action names
server/db/schema.ts             contracts, delegates, reservations, events, support cases
scripts/leash-demo.ts           the 9-beat demonstration (offline)
tests/                          21 engine cases + 22 enforcer cases
server/lib/leash.ts             composition root: leash singleton + approveForCase
actions/issue-contract.ts       the authority grant itself (human-only)
actions/delegate-contract.ts    attenuation time (child envelopes)
actions/revoke-contract.ts      human-only, immediate, collective
actions/issue-refund.ts         the headline boundary: approve → side effect → settle
app/routes/run._index.tsx       run control room: contracts at a glance
app/routes/run.$contractId.tsx  live contract board: beats, budget, receipts
scripts/leash-demo.ts           the 8-beat demonstration (offline)
tests/                          21 engine cases + 22 enforcer cases
```

## Limitations (honesty table)

- Demo refunds are recorded side effects; no payment rail is wired.
- Child-agent identity is *declared* (`childLabel` in the call), not
  cryptographic; the enforcer records the claim in the ledger.
- The events ledger is append-only by code convention (enforcement code never
  updates it); a raw SQL writer could still mutate rows.
- Double-spend protection lives in the conditional single-statement UPDATEs,
  not in transaction isolation — correct under PGlite and Postgres/Neon,
  but a driver that fragments statements would need transactions.
- `mcp:<label>` caller attribution relies on the framework's MCP dispatch
  context.

## License

MIT — see [LICENSE](LICENSE).
