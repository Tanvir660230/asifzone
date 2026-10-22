/**
 * COD risk of an order (docs/METRICS_REGISTRY.md §4.8): the phone's own history at this store plus the courier's
 * cross-shop score, as a level and plain reasons — never an opaque number, and never a block (same stance as
 * customers/customer-tags.ts computeRiskSignals: a signal for a human to look at). Pure. Money is minor units (BDT).
 */

import { currencySymbol } from "@clothing-brand/shared";

export interface PhoneHistory {
  delivered: number;
  partial: number;
  /** Refused at the door / returned (§4.7 refusal). */
  refused: number;
  cancelledBeforeBooking: number;
  /** Earlier orders not finished yet. */
  open: number;
  refusedCodValue: number;
}

export type RiskLevel = "low" | "medium" | "high";

export interface OrderRisk {
  level: RiskLevel;
  reasons: string[];
  /** Two or more deliveries here and no refusal — a known good customer. */
  trusted: boolean;
}

/** A first order this big (2,000 in major units) is refused far more often (§4.7: refused 20% vs 8% overall in the store's data). */
export const BIG_FIRST_ORDER = 200_000;
/** Steadfast's cross-shop success rate below this is worth a call before sending. */
export const WEAK_COURIER_SCORE = 60;

const amount = (minor: number, currency: string) => `${currencySymbol(currency)}${Math.round(minor / 100).toLocaleString("en-US")}`;

export function orderRisk(input: { history: PhoneHistory; orderValue: number; currency: string; courierSuccessRate?: number | null }): OrderRisk {
  const { history: h, orderValue, currency, courierSuccessRate } = input;
  const reasons: string[] = [];
  let level: RiskLevel = "low";
  const raise = (to: RiskLevel) => {
    if (to === "high" || (to === "medium" && level === "low")) level = to;
  };

  if (h.refused > 0) {
    reasons.push(`Refused ${h.refused} parcel${h.refused > 1 ? "s" : ""} here before (${amount(h.refusedCodValue, currency)} COD)`);
    raise(h.refused >= 2 || h.delivered === 0 ? "high" : "medium");
  }
  if (h.cancelledBeforeBooking >= 2 && h.delivered === 0) {
    reasons.push(`${h.cancelledBeforeBooking} earlier orders cancelled before sending`);
    raise("medium");
  }
  const firstOrder = h.delivered + h.partial + h.refused + h.cancelledBeforeBooking + h.open === 0;
  if (firstOrder && orderValue >= BIG_FIRST_ORDER) {
    reasons.push(`First order, ${amount(BIG_FIRST_ORDER, currency)} or more`);
    raise("medium");
  }
  if (courierSuccessRate !== null && courierSuccessRate !== undefined && courierSuccessRate < WEAK_COURIER_SCORE) {
    reasons.push(`Courier success rate ${Math.round(courierSuccessRate)}% across all shops`);
    raise("medium");
  }
  return { level, reasons, trusted: h.delivered >= 2 && h.refused === 0 };
}
