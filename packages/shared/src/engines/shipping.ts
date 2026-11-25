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
  /** The shopper skipped district and thana (they are optional on the storefront): use the default zone instead of
   * asking for an address. Staff complete the address on the confirmation call. */
  unknownUsesDefault?: boolean;
  /** With no district/division/postcode: the zone the shopper chose ("Inside Dhaka" / "Outside Dhaka"). Ignored once
   * the address names a place — the place decides. */
  zoneKey?: string | null;
}

/** One zone the shopper can choose when the address doesn't say where it is, priced for this cart. */
export interface ZoneChoice {
  key: string;
  name: string;
  isDefault: boolean;
  /** The districts the zone matches by name (empty for the fallback zone) — for labels like "Inside Dhaka". */
  districts: string[];
  fee: Money;
  charged: Money;
  waived: boolean;
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
 *   FREE_DELIVERY  every line in the cart ships free (variantShipsFree: the variant's own setting, else the product's) — one normal
 *                  product in the cart means the zone fee is charged (no partial or pro-rata waiver)
 *   FREE_OVER      merchandise after discounts reached the zone's free-over threshold (counts every line, free-delivery
 *                  lines included)
 */
export type ShippingWaiverReason = "COUPON" | "FREE_DELIVERY" | "FREE_OVER";

/** Whether one variant ships free: its own setting when it has one (the 12ml free, the 6ml not), else the product's. */
export function variantShipsFree(productFreeDelivery: boolean | null | undefined, variantFreeDelivery: boolean | null | undefined): boolean {
  return (variantFreeDelivery ?? productFreeDelivery) === true;
}

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
  const placeGiven = Boolean(values.POSTCODE || values.DISTRICT || values.DIVISION);
  const chosen = !placeGiven && address.zoneKey ? active.find((z) => z.key === address.zoneKey) : undefined;
  if (chosen) return chosen;
  return active.filter((z) => z.isDefault).sort((a, b) => (a.key < b.key ? -1 : 1))[0] ?? null;
}

/** Every active zone priced for this cart — offered when the address doesn't say where it is. */
export function zoneChoices(
  zones: ShippingZoneRule[],
  merchandiseAfterDiscounts: Money,
  opts: { couponFreeShipping: boolean; allLinesFreeDelivery?: boolean },
): ZoneChoice[] {
  return zones
    .filter((z) => z.isActive)
    .sort((a, b) => Number(a.isDefault) - Number(b.isDefault) || b.priority - a.priority || (a.key < b.key ? -1 : 1))
    .flatMap((z) => {
      const r = resolveShipping(zones, { unknownUsesDefault: true, zoneKey: z.key }, merchandiseAfterDiscounts, opts);
      if (!r.ok || r.zoneKey !== z.key) return [];
      return [{ key: z.key, name: z.name, isDefault: z.isDefault, districts: z.matches.filter((m) => m.field === "DISTRICT").map((m) => m.value), fee: r.fee, charged: r.charged, waived: r.waived }];
    });
}

export function resolveShipping(
  zones: ShippingZoneRule[],
  address: ShippingAddress | null,
  merchandiseAfterDiscounts: Money,
  opts: { couponFreeShipping: boolean; allLinesFreeDelivery?: boolean },
): ShippingResult {
  if (!address || (!norm(address.district) && !norm(address.division) && !norm(address.postcode) && !address.unknownUsesDefault)) return { ok: false, reason: "ADDRESS_REQUIRED" };
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
