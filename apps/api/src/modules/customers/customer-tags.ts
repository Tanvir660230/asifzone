import { looksLikeFakePhone, type CustomerTag } from "@clothing-brand/shared";

/**
 * How a customer's tags and risk signals are derived — one definition, used by the customer detail, the BI reads
 * (loadCustomersWithComputedFields) and the customer list's read model (customer-facts.service.ts).
 */

/** Lifetime-spend cutoffs (BDT) shared by the VIP/High Spender tags and (later) the loyalty-tier
 * display — Bronze is implicitly "below Silver". Suggested defaults; not yet exposed as an editable
 * setting (Phase 3 of the CRM build), so change here if the store wants different thresholds. */
export const LOYALTY_THRESHOLDS = { silver: 10_000, gold: 30_000, platinum: 75_000 };
const NEW_CUSTOMER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const INACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// A customer this cancel-prone is either a serial fake-orderer or has a real recurring problem
// either way, worth a human look. Only counted once there's enough history to mean something —
// one cancelled order out of one is normal buyer's remorse, not a pattern.
const CANCEL_RATE_REVIEW_THRESHOLD = 0.5;
const CANCEL_RATE_MIN_ORDERS = 3;
const HOLD_COUNT_REVIEW_THRESHOLD = 2;

/** Signals a human should look at, not proof of anything — a real customer can have a fake-looking
 * number (rare vanity/sequential numbers exist) or a bad delivery run for reasons that aren't their
 * fault. Returned as explainable strings (shown in the drawer) rather than a bare score, so an admin
 * can judge "why" instead of trusting an opaque flag. */
export function computeRiskSignals(input: {
  phone: string | null;
  totalOrders: number;
  cancelledOrders: number;
  holdOrders: number;
}): string[] {
  const signals: string[] = [];
  if (input.phone && looksLikeFakePhone(input.phone)) {
    signals.push("Phone number matches a common fake/dummy pattern");
  }
  if (input.totalOrders >= CANCEL_RATE_MIN_ORDERS && input.cancelledOrders / input.totalOrders >= CANCEL_RATE_REVIEW_THRESHOLD) {
    signals.push(`${input.cancelledOrders} of ${input.totalOrders} orders were cancelled`);
  }
  if (input.holdOrders >= HOLD_COUNT_REVIEW_THRESHOLD) {
    signals.push(`Courier marked ${input.holdOrders} order(s) as hold/undeliverable`);
  }
  return signals;
}

export function computeCustomerTags(input: {
  createdAt: Date;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: Date | null;
  isBlocked: boolean;
  codRisk: boolean;
  riskSignals: string[];
}): CustomerTag[] {
  const tags: CustomerTag[] = [];
  const now = Date.now();

  if (input.isBlocked) tags.push("BLOCKED");
  if (input.riskSignals.length > 0) tags.push("SUSPICIOUS");
  if (input.codRisk) tags.push("COD_RISK");
  if (input.totalSpent >= LOYALTY_THRESHOLDS.platinum) tags.push("VIP");
  else if (input.totalSpent >= LOYALTY_THRESHOLDS.gold) tags.push("HIGH_SPENDER");
  if (input.totalOrders >= 2) tags.push("REPEAT");
  if (now - input.createdAt.getTime() < NEW_CUSTOMER_WINDOW_MS) tags.push("NEW");

  const staleSince = input.lastOrderAt ? now - input.lastOrderAt.getTime() : now - input.createdAt.getTime();
  if (staleSince >= INACTIVE_WINDOW_MS) tags.push("INACTIVE");

  return tags;
}

/** When a date-based tag next changes for this customer: "New" ends 30 days after sign-up, "Inactive" starts 90 days
 * after the last order (or sign-up). The read model recomputes the customer's tags at that moment. Null = no change due. */
export function tagsExpireAt(input: { createdAt: Date; lastOrderAt: Date | null }, now: Date = new Date()): Date | null {
  const candidates = [input.createdAt.getTime() + NEW_CUSTOMER_WINDOW_MS, (input.lastOrderAt ?? input.createdAt).getTime() + INACTIVE_WINDOW_MS];
  const future = candidates.filter((t) => t > now.getTime());
  return future.length ? new Date(Math.min(...future)) : null;
}
