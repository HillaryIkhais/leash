/** Shared LEASH enum constants — imported by actions en bloc. */
export const CONTRACT_STATUS = {
  ACTIVE: "ACTIVE",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
} as const;

export const RESERVATION_STATUS = {
  HELD: "HELD",
  SETTLED: "SETTLED",
  REFUNDED: "REFUNDED",
} as const;

export const EVENT_TYPE = {
  ISSUED: "ISSUED",
  DELEGATED: "DELEGATED",
  EXECUTED: "EXECUTED",
  REJECTED: "REJECTED",
  REPLAYED: "REPLAYED",
  RELEASED: "RELEASED",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
} as const;

/** canonical action names — used by contract issuance UI + enforcement */
export const KNOW_ACTIONS = [
  "inspect-order",
  "issue-refund",
  "draft-response",
  "change-account-owner",
] as const;
