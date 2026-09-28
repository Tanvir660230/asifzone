import { clampNonNegative, fromMajor, money, multiply, subtract, type Money } from "./money";
import { divRoundHalfUp, roundToUnit, toBasisPoints, type RoundingPolicy } from "./rounding";

/**
 * Canonical unit-price resolution (docs/PRICING_PIPELINE.md): list price (variant override, else product base) → the
 * best live flash sale → effective selling price. Pure: time and every input are parameters.
 */

/** A flash-sale offer on one product, as loaded by the pricing service. */
export interface FlashOffer {
  flashSaleId: string;
  flashSaleItemId: string;
  name: string;
  enabled: boolean;
  startsAt: Date | string;
  endsAt: Date | string;
  discountType: "PERCENTAGE" | "FIXED";
  /** Percent for PERCENTAGE; a major-unit amount for FIXED. */
  discountValue: number;
  /** Units this offer may sell at the flash price in total (D4); null = unlimited. */
  stockLimit: number | null;
  /** Units already sold under this offer (net of units put back — see PRICING_INVARIANTS §4). */
  unitsSold: number;
}

/** The flash sale that priced (part of) a line — the attribution that is snapshotted onto the order line. */
export interface AppliedFlash {
  flashSaleId: string;
  flashSaleItemId: string;
  name: string;
  endsAt: string;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: number;
  /** Flash-priced units still available under stockLimit before this purchase; null = unlimited. */
  remaining: number | null;
}

export interface UnitPriceInput {
  currency: string;
  basePrice: Money;
  variantPrice: Money | null;
  productCompareAt: Money | null;
  variantCompareAt: Money | null;
  offers: FlashOffer[];
  now: Date;
  rounding: RoundingPolicy;
}

export interface ResolvedUnitPrice {
  /** Regular price of one unit: the variant's own price, else the product base price. */
  listPrice: Money;
  /** What one unit sells for right now (the flash price when a flash sale applies). */
  sellingPrice: Money;
  /** "Was" price to show struck through: the list price during a flash sale, else an explicit compare-at above it. */
  compareAtPrice: Money | null;
  flashSale: AppliedFlash | null;
  /** listPrice − sellingPrice for one unit (zero without a flash sale). */
  flashDiscount: Money;
}

function time(value: Date | string): number {
  return new Date(value).getTime();
}

/** Live = the admin switch is on and `now` is inside the window (TARGET_ARCHITECTURE §16a). */
export function isOfferLive(offer: Pick<FlashOffer, "enabled" | "startsAt" | "endsAt">, now: Date): boolean {
  const t = now.getTime();
  return offer.enabled && time(offer.startsAt) <= t && t <= time(offer.endsAt);
}

/** Flash-sale units still available under the offer's limit; null = unlimited. */
export function remainingUnits(offer: Pick<FlashOffer, "stockLimit" | "unitsSold">): number | null {
  return offer.stockLimit === null ? null : Math.max(0, offer.stockLimit - offer.unitsSold);
}

/** One unit's flash price: percentage or fixed off the list price, rounded by policy, never negative. */
export function flashUnitPrice(list: Money, offer: Pick<FlashOffer, "discountType" | "discountValue">, rounding: RoundingPolicy): Money {
  // The price itself is rounded (not the discount), exactly as the pre-Phase-2 computeFlashPrice did, so existing flash
  // prices are unchanged to the paisa.
  const raw =
    offer.discountType === "PERCENTAGE"
      ? money(divRoundHalfUp(list.amount * (10_000 - toBasisPoints(offer.discountValue)), 10_000), list.currency)
      : subtract(list, fromMajor(offer.discountValue, list.currency));
  const price = clampNonNegative(raw);
  return money(roundToUnit(price.amount, rounding.flashPrice, price.currency), price.currency);
}

/**
 * Deterministic choice among overlapping offers (never database row order): live, with units left under its limit;
 * then the best customer price, then the earliest `endsAt`, then the smallest flashSaleItemId.
 */
export function selectFlashOffer(list: Money, offers: FlashOffer[], now: Date, rounding: RoundingPolicy): { offer: FlashOffer; price: Money } | null {
  const candidates = offers
    .filter((o) => isOfferLive(o, now))
    .filter((o) => remainingUnits(o) !== 0)
    .map((offer) => ({ offer, price: flashUnitPrice(list, offer, rounding) }))
    .filter((c) => c.price.amount < list.amount);
  candidates.sort(
    (a, b) =>
      a.price.amount - b.price.amount ||
      time(a.offer.endsAt) - time(b.offer.endsAt) ||
      (a.offer.flashSaleItemId < b.offer.flashSaleItemId ? -1 : a.offer.flashSaleItemId > b.offer.flashSaleItemId ? 1 : 0),
  );
  return candidates[0] ?? null;
}

export function resolveUnitPrice(input: UnitPriceInput): ResolvedUnitPrice {
  const listPrice = input.variantPrice ?? input.basePrice;
  const chosen = selectFlashOffer(listPrice, input.offers, input.now, input.rounding);
  // Compare-at follows the existing storefront rule: the variant's own, else the product's only when the variant
  // doesn't override the price. Shown only when it is above what the shopper actually pays.
  const explicitCompareAt = input.variantCompareAt ?? (input.variantPrice ? null : input.productCompareAt);
  if (chosen) {
    return {
      listPrice,
      sellingPrice: chosen.price,
      compareAtPrice: listPrice,
      flashSale: toApplied(chosen.offer),
      flashDiscount: subtract(listPrice, chosen.price),
    };
  }
  return {
    listPrice,
    sellingPrice: listPrice,
    compareAtPrice: explicitCompareAt && explicitCompareAt.amount > listPrice.amount ? explicitCompareAt : null,
    flashSale: null,
    flashDiscount: money(0, input.currency),
  };
}

function toApplied(offer: FlashOffer): AppliedFlash {
  return {
    flashSaleId: offer.flashSaleId,
    flashSaleItemId: offer.flashSaleItemId,
    name: offer.name,
    endsAt: new Date(offer.endsAt).toISOString(),
    discountType: offer.discountType,
    discountValue: offer.discountValue,
    remaining: remainingUnits(offer),
  };
}

/** A run of units in one line sold at one unit price — the order-line granularity (a line may split in two, D4). */
export interface PriceSegment {
  quantity: number;
  unitPrice: Money;
  listUnitPrice: Money;
  flash: AppliedFlash | null;
  total: Money;
}

/**
 * Prices `quantity` units given the resolved unit price and how many flash-priced units are still available to this
 * cart (`flashRemaining`, shared across lines of the same offer by the caller). D4: once the limit is used up, the
 * remaining units sell at the regular list price — the line splits into a flash segment and a regular segment.
 */
export function priceLineSegments(resolved: ResolvedUnitPrice, quantity: number, flashRemaining: number | null): PriceSegment[] {
  const regular = (q: number): PriceSegment => ({
    quantity: q,
    unitPrice: resolved.listPrice,
    listUnitPrice: resolved.listPrice,
    flash: null,
    total: multiply(resolved.listPrice, q),
  });
  if (!resolved.flashSale || quantity <= 0) return quantity > 0 ? [regular(quantity)] : [];
  const flashQty = flashRemaining === null ? quantity : Math.min(quantity, Math.max(0, flashRemaining));
  const segments: PriceSegment[] = [];
  if (flashQty > 0) {
    segments.push({
      quantity: flashQty,
      unitPrice: resolved.sellingPrice,
      listUnitPrice: resolved.listPrice,
      flash: resolved.flashSale,
      total: multiply(resolved.sellingPrice, flashQty),
    });
  }
  if (quantity - flashQty > 0) segments.push(regular(quantity - flashQty));
  return segments;
}
