# LEASH — run-scoped authority contracts for autonomous agents

> **An agent can delegate work, but it cannot delegate more authority than it was given.**

A human issues one live authority contract for a specific assignment. That contract has explicit boundaries: permitted actions, forbidden actions, spending limits, action counts, expiry, and revocation. Every action is checked against the contract at execution time. Delegated agents inherit restrictions from their parent — a child agent never receives broader authority than its parent possesses.

---

## The Problem

Agent frameworks today answer "who may call this tool?" with static RBAC. They don't answer what matters during a specific assignment:

- How much money may *this run* move in total? (cumulative, not per-call)
- How many times may it act? (count, not just scope)
- Until when is any of this valid? (expiry)
- If a child agent is spawned, how much authority does it inherit? (attenuation)
- If the human changes their mind mid-run, what stops the next call? (revocation)
- If a request is retried, what prevents a double charge? (idempotency)

Without run-scoped enforcement, a delegated sub-agent silently inherits everything its parent can do, retries double-spend, and a "stop" has no guaranteed enforcement point.

---

## How LEASH Works

A **run contract** is a database row in `contracts`:

| Field | Purpose |
|-------|---------|
| `budgetCents` | Total money this run may move (integer cents) |
| `maxRefunds` | Maximum refund actions this run may perform |
| `permittedActions` | JSON array of allowed action names |
| `forbiddenActions` | JSON array of explicitly denied action names |
| `expiresAt` | Epoch milliseconds — enforced by server clock |
| `status` | `ACTIVE` \| `REVOKED` \| `EXPIRED` |

Every gated action calls the same enforcement gate before any side effect:

```
approveForCase(caseId, { action, amountCents, requestId }, { caller })
  │
  ├─ replay check: same requestId? → return earlier receipt (idempotency)
  ├─ evaluate() — pure engine, strict check order:
  │     1. revoked      → contract_revoked
  │     2. expired      → contract_expired   (server clock, never caller's)
  │     3. forbidden    → forbidden_action   (denial list beats permit list)
  │     4. not permitted→ action_not_permitted
  │     5. count limit  → count_limit_exceeded
  │     6. budget       → budget_exceeded    (spent + amount ≤ budget)
  ├─ atomic holds — single conditional UPDATEs:
  │     UPDATE contracts SET spent_cents = spent_cents + amt
  │     WHERE id = ? AND status = 'ACTIVE' AND spent_cents + amt <= budget_cents
  │     Two concurrent calls cannot both spend the last allowance —
  │     one UPDATE wins, the loser sees zero rows, unwinds, rejected.
  └─ after real side effect: settle() (hold → permanent spend)
         or on failure: release() (allowance and count return, receipt stays)
```

---

## Delegation: Authority Never Expands (Verifiable Credentials)

The core invariant: **a delegated sub-agent must never possess more authority than its parent.**

1. `delegate-contract` registers a child in `contractDelegates` with an attenuated envelope **and a high-entropy credential**.
3. At execution time, the child agent MUST present the credential in the caller string: `subagent:<label>:<credential>`.
4. The enforcer hashes the credential and compares it against the stored hash in `contractDelegates`. **No credential = no access.**
5. Child spend counts against the **parent's budget**, never a fresh one.

**Verifiable credential model**: The credential is a 256-bit high-entropy token generated at registration. It is shown **only once** in the `DELEGATED` event. The enforcer verifies it by hashing and comparing against the stored SHA-256 hash. The credential is never stored in plaintext.

---

## Revocation & Expiry: Immediate, No Cached Tokens

- The contract is re-read from the database at **every** evaluation — no cached token outlives its authority.
- `revoke-contract` (human-only) flips status; the next call from any caller is rejected with `contract_revoked`.
- Expiry uses the enforcer's server clock at evaluation time; the request payload carries no time.

---

## Receipts: Immutable Audit Trail

Every decision appends to `contract_events`:

| Event | Meaning |
|-------|---------|
| `ISSUED` | Contract created |
| `DELEGATED` | Child agent registered |
| `EXECUTED` | Action approved and settled |
| `REJECTED:<code>` | Action denied with reason |
| `REPLAYED` | Duplicate requestId — no re-execution |
| `RELEASED` | Side effect failed — allowance returned |
| `REVOKED` | Contract revoked mid-run |

The ledger is the audit trail — the control room (`/run/:id`) renders it live, and `get-run` returns the same truth to humans, agents, and MCP clients.

---

## Agent-Native Integration

LEASH is built **on** Agent-Native, not beside it:

- **Shared actions** — `issue-refund`, `inspect-order`, `draft-response`, `delegate-contract`, `revoke-contract` are callable from UI, agent chat, HTTP, MCP, A2A, and CLI.
- **Shared state** — The same `contracts`, `contractDelegates`, `contractEvents` tables are read by the control room, the agent's `get-run` introspection, and MCP clients.
- **Authority at the action boundary** — Every `run()` begins with `approveForCase()`. The agent cannot bypass enforcement; the UI cannot bypass enforcement; MCP cannot bypass enforcement.
- **Delegation as a first-class action** — `delegate-contract` is an action the parent agent can call (if authorized), creating a child whose envelope is validated at registration and enforced at execution.

This is why Agent-Native is fundamental: it provides the shared action layer, the dispatcher that carries `ctx.caller` and `ctx.delegationDepth`, and the multi-surface transport (chat, HTTP, MCP, A2A, CLI) that all hit the same gate.

---

## Demo (Verifiable Credentials)

Run the complete enforcement demonstration offline (engine + enforcer + conditional-update bridge; no database needed):

```bash
pnpm demo
```

What you will see — a root agent and two registered delegates (`helper` with full envelope, `reader` with reads-only) under a $25.00 / 2-refund / 10-minute contract. **Delegates use verifiable credentials:**

1. Allowed refund of $18.00 → `approved` (credential verified), $7.00 remaining
2. `change-account-owner` → rejected `forbidden_action` (on the denial list)
3. `open-case` → rejected `action_not_permitted` (not in the permitted set)
4. Another refund of $7.01 → rejected `budget_exceeded` (`total $25.01 exceeds the $25.00 ceiling`)
5. Replaying the first requestId → `replayed`, no double execution
6. A $7.00 refund whose side effect fails → `released`, allowance returned
7. The `reader` delegate attempts a refund → rejected `delegate_envelope_violation` (its registered envelope, enforced live)
8. The parent revokes; the next call → rejected `contract_revoked`
9. **Invalid credential** → rejected `delegate_not_found`
10. The receipt ledger prints the whole story

---

## Live Application

```bash
pnpm dev      # chat at /chat, run launcher at /run, control room at /run/:id
```

Workflow:
1. **`/run`** — Human creates support case + issues run contract (refund ceiling, permitted/forbidden actions, expiry).
2. **`/chat`** — Human opens chat with pre-filled prompt asking agent to resolve the case. The **AI agent** uses LEASH-governed actions (`inspect-order`, `issue-refund`, `draft-response`) — all enforced by LEASH in real-time.
3. **`/run/:contractId`** — Live control room: budget bar, enforcement beats, delegate list, real-time receipt ledger, revocation button. Watch the agent's actions being enforced live.

---

## Tests

Two suites, zero runtime dependencies beyond Node built-ins:

```bash
pnpm test
```

- `tests/leash-engine.node.ts` — 21 adversarial cases against the pure engine: check-order truthfulness, boundary milliseconds, exact-cent ceilings, attenuation matrix.
- `tests/leash-enforce.node.ts` — 24 lifecycle cases: replay/idempotency, concurrent double-spend races, hold unwind, release-after-failure, revocation before execution, receipt distinctions, credential verification.
- `tests/integration-workflow.node.ts` — 8 end-to-end integration tests: full resolution workflow, child envelope enforcement, revocation during execution, concurrent overspend, replay protection, delegation authorization, count-before-budget ordering, credential verification.

---

## Architecture

```
server/lib/leash-engine.ts           pure decision engine (no DB, no IO, injected clock)
server/lib/leash-enforce.ts          replay / holds / delegate-envelope / settle / release lifecycle
server/lib/leash-db-bridge.ts        drizzle bridge: conditional updates, double-spend-proof
server/lib/leash-constants.ts        shared enums, canonical action names
server/lib/leash-caller.ts           caller resolution: framework context → LEASH caller string
server/db/schema.ts                  contracts, delegates, reservations, events, support cases
scripts/leash-demo.ts                10-beat demonstration (offline, verifiable credentials)
tests/                               21 engine + 24 enforcer + 8 integration cases
server/lib/leash.ts                  composition root: leash singleton + approveForCase
actions/issue-contract.ts            authority grant (human-only: agentTool:false, mcpTool:false)
actions/delegate-contract.ts         attenuation + verifiable credentials (child envelopes, authorized registration)
actions/revoke-contract.ts           human-only, immediate, collective
actions/issue-refund.ts              headline boundary: approve → side effect → settle
actions/inspect-order.ts             read path through same gate
actions/draft-response.ts            permitted write: draft customer response
actions/resolve-case.ts              autonomous resolution workflow (demo engine)
actions/open-case.ts                 support case seeding (frontend only)
app/routes/run._index.tsx            run launcher: issue contract → chat for agent resolution
app/routes/run.$contractId.tsx       live control room: budget, beats, delegates, receipts
app/routes/resolve.$caseId.tsx       case resolution overview: chat + control room links
```

---

## Limitations (Honesty Table)

| Area | Status |
|------|--------|
| **Payments** | Demo refunds are recorded side effects; no payment rail is wired. Customer responses explicitly state "no actual payment was processed." |
| **Child identity** | **Verifiable credential model implemented.** Delegates registered in `contractDelegates` with a high-entropy credential. The enforcer validates `subagent:<label>:<credential>` by hashing and comparing against stored SHA-256 hash. Credential shown only once at registration. Caller-supplied `childLabel` in action inputs is ignored. |
| **Ledger immutability** | Append-only by code convention; a raw SQL writer could still mutate rows. |
| **Double-spend protection** | Conditional single-statement UPDATEs, not transaction isolation — correct under PGlite and Postgres/Neon. |
| **MCP caller attribution** | Relies on framework's MCP dispatch context. |
| **Autonomous resolution** | AI agent operates through Agent-Native chat, using shared LEASH-governed actions (`inspect-order`, `issue-refund`, `draft-response`). |

---

## Running Locally

```bash
# Requirements: Node ≥ 22.22, pnpm 10 (via corepack)
git clone https://github.com/HillaryIkhais/leash.git
cd leash
corepack enable && pnpm install --frozen-lockfile
pnpm migrate:production   # applies schema to local DB
pnpm dev                  # starts app at localhost:3000
pnpm test                 # runs all test suites
pnpm demo                 # offline enforcement demonstration
```

Configuration (`.env`): auth is on by default; `BETTER_AUTH_SECRET` for production; `AUTH_DISABLED=true` only for local preview.

---

## License

MIT — see [LICENSE](LICENSE).