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
      waivedReason: "COUPON" | "FREE_OVER" | null;
    }
  | { ok: false; reason: "ADDRESS_REQUIRED" | "NO_ZONE" };

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
  opts: { couponFreeShipping: boolean },
): ShippingResult {
  if (!address || (!norm(address.district) && !norm(address.division) && !norm(address.postcode))) return { ok: false, reason: "ADDRESS_REQUIRED" };
  const zone = resolveZone(zones, address);
  if (!zone) return { ok: false, reason: "NO_ZONE" };
  const freeOver = zone.freeOverAmount !== null && merchandiseAfterDiscounts.amount >= zone.freeOverAmount.amount;
  const waivedReason = opts.couponFreeShipping ? "COUPON" : freeOver ? "FREE_OVER" : null;
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
