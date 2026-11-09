/**
 * LEASH tables — release migrations. Runs at boot (dev) and at release
 * (migrate:production). Every entry is additive and named.
 */
import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "leash-run-contract-tables",
      sql: `
        CREATE TABLE IF NOT EXISTS support_cases (
          id TEXT PRIMARY KEY,
          customer TEXT NOT NULL,
          order_ref TEXT NOT NULL,
          order_total_cents INTEGER NOT NULL,
          complaint TEXT NOT NULL,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS contracts (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          budget_cents INTEGER NOT NULL,
          spent_cents INTEGER NOT NULL DEFAULT 0,
          max_refunds INTEGER NOT NULL,
          refunds_used INTEGER NOT NULL DEFAULT 0,
          permitted_actions TEXT NOT NULL,
          forbidden_actions TEXT NOT NULL,
          issued_by TEXT NOT NULL,
          expires_at BIGINT NOT NULL,
          revoked_at BIGINT,
          created_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS contracts_case_id_idx ON contracts (case_id);

        CREATE TABLE IF NOT EXISTS contract_delegates (
          id TEXT PRIMARY KEY,
          contract_id TEXT NOT NULL,
          parent_delegate_id TEXT,
          label TEXT NOT NULL,
          permitted_actions TEXT NOT NULL,
          max_refunds INTEGER NOT NULL,
          budget_cap_cents INTEGER NOT NULL,
          created_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS contract_delegates_contract_idx ON contract_delegates (contract_id, label);

        CREATE TABLE IF NOT EXISTS contract_reservations (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL,
          contract_id TEXT NOT NULL,
          delegate_label TEXT,
          action TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          outcome TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at BIGINT NOT NULL
        );
        -- idempotency: one reservation per requestId, enforced by the database
        CREATE UNIQUE INDEX IF NOT EXISTS contract_reservations_request_id_uq
          ON contract_reservations (request_id);
        CREATE INDEX IF NOT EXISTS contract_reservations_contract_idx
          ON contract_reservations (contract_id);

        CREATE TABLE IF NOT EXISTS contract_events (
          id TEXT PRIMARY KEY,
          contract_id TEXT NOT NULL,
          type TEXT NOT NULL,
          action TEXT,
          caller TEXT NOT NULL,
          amount_cents INTEGER,
          code TEXT,
          detail TEXT,
          created_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS contract_events_contract_idx
          ON contract_events (contract_id, created_at);
      `,
    },
  ],
  { table: "leash_migrations" },
);
