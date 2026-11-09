# Changelog

All notable user-facing changes to this app are documented here.

## 2026-11-09

### LEASH — run-scoped authority contracts

- Enforcement core: pure decision engine, enforcer lifecycle (idempotency,
  atomic budget/count holds, settle/release, delegate-envelope binding),
  drizzle bridge with conditional single-statement updates.
- Control room: issue a run contract over a support case, work the
  enforcement beats live, watch the receipt ledger.
- Security suites: 43 tests (engine + enforcer), offline on Node built-ins.
- Offline demonstration: `pnpm demo` — the 9-beat delegation story.
- Dependencies pruned and pinned (45 unused packages removed); lockfile
  committed; installer rewritten portable.

### Fixed

- Gated actions resolved the contract by case id against the contract table;
  every gated call now resolves the case's live contract first
  (`approveForCase`).
- Expiry used the caller-supplied clock; the enforcer's server clock now
  decides expiry (callers cannot negotiate the wall).
- Concurrent duplicate requestIds could leak holds; the reservation insert
  conflict now unwinds and replays the winner's receipt.

## 2026-10-10

### Fixed

- Large prompts with full context remain available to retry when sending fails.

## 2026-09-30

### Improved

- Chat uses a compact + menu with context submenus, keeps task, automation, and skill actions at the root, and omits Generate Image.

## 2026-09-27

### Fixed

- Chat retries the original request with its attachments after model setup.

## 2026-08-27

### Fixed

- Chat includes the runtime packages needed for provider keys after deployment.

For the full list of updates, see the [changelog folder](./changelog/).
