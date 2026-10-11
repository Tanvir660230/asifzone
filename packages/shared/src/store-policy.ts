import { DHAKA_DELIVERY_DAYS, OUTSIDE_DHAKA_DELIVERY_DAYS } from "./country/bd";
import type { StoreSettings } from "./types";

/**
 * The store's customer-facing policy (Phase 5) — the ONE place that turns the store's own settings (StoreSetting:
 * return window, return conditions, handling time, Cash on Delivery) and the delivery zones of the country module into
 * the statements the storefront makes: the product page's policy lines, the Shipping & Returns accordion and page, the FAQ
 * and the Product structured data. Nothing here invents a policy: a fact the store hasn't set is simply not claimed.
 */

export type PolicySettings = Pick<StoreSettings, "returnWindowDays" | "returnConditions" | "handlingDaysMin" | "handlingDaysMax" | "codEnabled">;

export interface StorePolicy {
  /** null: the store states no return window. */
  returns: { days: number; conditions: string | null } | null;
  /** Business days between order and dispatch; null when the store hasn't stated it. */
  handlingDays: [number, number] | null;
  cashOnDelivery: boolean;
  /** Courier transit days per delivery zone (country module). */
  deliveryDays: { insideDhaka: [number, number]; outsideDhaka: [number, number] };
}

export function storePolicy(settings: PolicySettings): StorePolicy {
  const days = settings.returnWindowDays;
  const conditions = settings.returnConditions?.trim() || null;
  const min = settings.handlingDaysMin;
  const max = settings.handlingDaysMax ?? min;
  return {
    returns: days && days > 0 ? { days, conditions } : null,
    handlingDays: min != null && max != null ? [Math.min(min, max), Math.max(min, max)] : null,
    cashOnDelivery: settings.codEnabled,
    deliveryDays: { insideDhaka: DHAKA_DELIVERY_DAYS, outsideDhaka: OUTSIDE_DHAKA_DELIVERY_DAYS },
  };
}

/** "1–2", or "2" when both ends match. */
export const dayRange = ([a, b]: [number, number]) => (a === b ? `${a}` : `${a}–${b}`);
const range = dayRange;

/** The nationwide delivery span across all zones, e.g. [1, 5]. */
export function deliverySpan(policy: StorePolicy): [number, number] {
  const { insideDhaka, outsideDhaka } = policy.deliveryDays;
  return [Math.min(insideDhaka[0], outsideDhaka[0]), Math.max(insideDhaka[1], outsideDhaka[1])];
}

export type PolicyHighlightKind = "delivery" | "returns" | "cashOnDelivery";

/** The short policy lines under the product page's buy buttons, in display order. */
export function policyHighlights(policy: StorePolicy): { kind: PolicyHighlightKind; label: string }[] {
  const lines: { kind: PolicyHighlightKind; label: string }[] = [{ kind: "delivery", label: `Nationwide delivery, ${range(deliverySpan(policy))} business days` }];
  if (policy.returns) lines.push({ kind: "returns", label: `${policy.returns.days}-day easy returns` });
  if (policy.cashOnDelivery) lines.push({ kind: "cashOnDelivery", label: "Cash on Delivery available" });
  return lines;
}

/** "Unworn items … can be returned or exchanged within 7 days of delivery." — null when no return window is stated. */
export function returnPolicySentence(policy: StorePolicy): string | null {
  if (!policy.returns) return null;
  const subject = policy.returns.conditions ?? "Items";
  return `${subject} can be returned or exchanged within ${policy.returns.days} days of delivery.`;
}

/** The product page's "Shipping & Returns" text when the store hasn't written its own. */
export function shippingAndReturnsText(policy: StorePolicy): string {
  const { insideDhaka, outsideDhaka } = policy.deliveryDays;
  return [
    policy.handlingDays && `Dispatched within ${range(policy.handlingDays)} business days.`,
    `Inside Dhaka: ${range(insideDhaka)} days, outside Dhaka: ${range(outsideDhaka)} days.`,
    returnPolicySentence(policy),
  ]
    .filter(Boolean)
    .join(" ");
}
