/**
 * LEASH — authority contract schema.
 * Money is integer cents, never floats. Times are epoch milliseconds.
 * The events table is append-only by convention (enforcement wrapper code
 * never updates it) — immutability property.
 */
import { table, text, integer } from "@agent-native/core/db/schema";

export const contracts = table("contracts", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),       // support case this run is bound to
  title: text("title").notNull(),
  status: text("status").notNull(),        // ACTIVE | REVOKED | EXPIRED
  budgetCents: integer("budget_cents").notNull(),
  spentCents: integer("spent_cents").notNull(),   // cumulative, holds include
  maxRefunds: integer("max_refunds").notNull(),
  refundsUsed: integer("refunds_used").notNull(),
  permittedActions: text("permitted_actions").notNull(), // JSON string[]; e.g. ["inspect-order","issue-refund","draft-response"]
  forbiddenActions: text("forbidden_actions").notNull(), // JSON string[]; e.g. ["change-account-owner"]
  issuedBy: text("issued_by").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
});

export const contractDelegates = table("contract_delegates", {
  id: text("id").primaryKey(),
  contractId: text("contract_id").notNull(),
  parentDelegateId: text("parent_delegate_id"), // null = the root agent
  label: text("label").notNull(),               // child identity label
  permittedActions: text("permitted_actions").notNull(), // JSON string[], subset of parent
  maxRefunds: integer("max_refunds").notNull(), // <= parent effective
  budgetCapCents: integer("budget_cap_cents").notNull(), // optional tighter sub-ceiling
  createdAt: integer("created_at").notNull(),
});

export const contractReservations = table("contract_reservations", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),      // caller-supplied dedupe key (idempotency)
  contractId: text("contract_id").notNull(),
  delegateLabel: text("delegate_label"),
  action: text("action").notNull(),
  amountCents: integer("amount_cents").notNull(),
  outcome: text("outcome").notNull(),           // APPROVED | REJECTED:<code>
  status: text("status").notNull(),             // HELD | SETTLED | REFUNDED
  createdAt: integer("created_at").notNull(),
});

export const contractEvents = table("contract_events", {
  id: text("id").primaryKey(),
  contractId: text("contract_id").notNull(),
  type: text("type").notNull(),                 // ISSUED|DELEGATED|EXECUTED|REJECTED|REPLAYED|RELEASED|REVOKED|EXPIRED
  action: text("action"),
  caller: text("caller").notNull(),             // frontend | root-agent | subagent:<label> | mcp:<label> | http | cli
  amountCents: integer("amount_cents"),
  code: text("code"),                           // rejection code
  detail: text("detail"),                       // JSON string
  createdAt: integer("created_at").notNull(),
});

export const supportCases = table("support_cases", {
  id: text("id").primaryKey(),
  customer: text("customer").notNull(),
  orderRef: text("order_ref").notNull(),
  orderTotalCents: integer("order_total_cents").notNull(),
  complaint: text("complaint").notNull(),
  status: text("status").default("open"),          // open | resolved_with_refund | resolved_no_refund
  resolvedAt: integer("resolved_at"),
  resolutionRefundCents: integer("resolution_refund_cents"),
  resolutionReason: text("resolution_reason"),
  createdAt: integer("created_at").notNull(),
});
