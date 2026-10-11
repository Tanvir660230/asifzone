import { money, type Money } from "./money";

/**
 * Shipping from the configured zones (ShippingZone / ShippingZoneMatch / ShippingRate) — no country- or city-specific
 * rule lives in code. The store's "Dhaka district vs. everywhere else" behaviour is data seeded into these tables.
 */
export type ZoneMatchField = "POSTCODE" | "DISTRICT" | "DIVISION";

export interface ShippingZoneRule {
  id: string;
  key: string;
  name: string;
  /** Higher wins among matching zones. */
  priority: number;
  /** The fallback zone when no match rule applies. */
  isDefault: boolean;
  isActive: boolean;
  matches: Array<{ field: ZoneMatchField; value: string }>;
  fee: Money;
  /** Free shipping when the merchandise total (after discounts) reaches this; null = never. */
  freeOverAmount: Money | null;
}

export interface ShippingAddress {
  district?: string | null;
  division?: string | null;
  postcode?: string | null;
}

export type ShippingResult =
  | {
      ok: true;
      zoneId: string;
      zoneKey: string;
      zoneName: string;
      /** The zone's fee before any waiver. */
      fee: Money;
      /** What is actually charged (0 when waived). */
      charged: Money;
      waived: boolean;
      waivedReason: ShippingWaiverReason | null;
    }
  | { ok: false; reason: "ADDRESS_REQUIRED" | "NO_ZONE" };

/**
 * Why shipping was not charged, in precedence order (docs/ORDER_ADJUSTMENTS.md §2):
 *   COUPON         a FREE_SHIPPING coupon applied to the order
 *   FREE_DELIVERY  every line in the cart is a product marked "Free delivery" (Product.freeDelivery) — one normal
 *                  product in the cart means the zone fee is charged (no partial or pro-rata waiver)
 *   FREE_OVER      merchandise after discounts reached the zone's free-over threshold (counts every line, free-delivery
 *                  lines included)
 */
export type ShippingWaiverReason = "COUPON" | "FREE_DELIVERY" | "FREE_OVER";

const SPECIFICITY: Record<ZoneMatchField, number> = { POSTCODE: 3, DISTRICT: 2, DIVISION: 1 };

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

/** The zone for an address: the matching zone with the highest priority, then the most specific rule, then key. */
export function resolveZone(zones: ShippingZoneRule[], address: ShippingAddress): ShippingZoneRule | null {
  const active = zones.filter((z) => z.isActive);
  const values: Record<ZoneMatchField, string> = { POSTCODE: norm(address.postcode), DISTRICT: norm(address.district), DIVISION: norm(address.division) };
  const matched = active
    .map((zone) => ({
      zone,
      specificity: Math.max(0, ...zone.matches.filter((m) => values[m.field] && norm(m.value) === values[m.field]).map((m) => SPECIFICITY[m.field])),
    }))
    .filter((m) => m.specificity > 0)
    .sort((a, b) => b.zone.priority - a.zone.priority || b.specificity - a.specificity || (a.zone.key < b.zone.key ? -1 : 1));
  if (matched[0]) return matched[0].zone;
  return active.filter((z) => z.isDefault).sort((a, b) => (a.key < b.key ? -1 : 1))[0] ?? null;
}

export function resolveShipping(
  zones: ShippingZoneRule[],
  address: ShippingAddress | null,
  merchandiseAfterDiscounts: Money,
  opts: { couponFreeShipping: boolean; allLinesFreeDelivery?: boolean },
): ShippingResult {
  if (!address || (!norm(address.district) && !norm(address.division) && !norm(address.postcode))) return { ok: false, reason: "ADDRESS_REQUIRED" };
  const zone = resolveZone(zones, address);
  if (!zone) return { ok: false, reason: "NO_ZONE" };
  const freeOver = zone.freeOverAmount !== null && merchandiseAfterDiscounts.amount >= zone.freeOverAmount.amount;
  const waivedReason: ShippingWaiverReason | null = opts.couponFreeShipping
    ? "COUPON"
    : opts.allLinesFreeDelivery
      ? "FREE_DELIVERY"
      : freeOver
        ? "FREE_OVER"
        : null;
  return {
    ok: true,
    zoneId: zone.id,
    zoneKey: zone.key,
    zoneName: zone.name,
    fee: zone.fee,
    charged: waivedReason ? money(0, zone.fee.currency) : zone.fee,
    waived: waivedReason !== null,
    waivedReason,
  };
}
