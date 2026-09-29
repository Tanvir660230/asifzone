/**
 * Pure derivation of a ProductReadModel row (docs/STOREFRONT_READ_MODEL.md §3). Given the product's CANONICAL display
 * pricing (priceProductsForDisplay → resolveUnitPrice — the same function every quote uses) and the facts that decide
 * when that price can next change, it returns the row to persist. It computes no price of its own: every money figure
 * is copied from `pricing`, so the read model can never disagree with the pricing engine at the time it was computed.
 */
import { PRICING_VERSION } from "@clothing-brand/shared";
import type { ProductPricingDto } from "../pricing/pricing.service";

export interface ReadModelOfferFacts {
  enabled: boolean;
  startsAt: Date;
  endsAt: Date;
  stockLimit: number | null;
}

export interface ReadModelInput {
  productId: string;
  pricing: ProductPricingDto;
  /** Every flash-sale item row for the product, with its sale's switch and window (live or not). */
  offers: ReadModelOfferFacts[];
  /** Fingerprint of the price inputs, read BEFORE the pricing (so a concurrent change can only make the row look stale,
   * never fresh). */
  sourceHash: string;
  now: Date;
}

export interface ReadModelRow {
  productId: string;
  minSellingPrice: number;
  maxSellingPrice: number;
  listPriceOfMin: number;
  hasLiveFlashSale: boolean;
  currency: string;
  pricingVersion: number;
  sourceHash: string;
  validUntil: Date | null;
  volatile: boolean;
  computedAt: Date;
}

const isLive = (o: ReadModelOfferFacts, now: Date) => o.enabled && o.startsAt.getTime() <= now.getTime() && now.getTime() <= o.endsAt.getTime();

/** The next instant the price can change on the clock alone: an enabled sale starting, or a live one ending (a sale is
 * live through `endsAt` inclusive — isOfferLive — so it stops pricing 1 ms later). Disabled sales can only change by an
 * admin write, which the freshness guard sees through `updatedAt`. */
export function nextPriceBoundary(offers: ReadModelOfferFacts[], now: Date): Date | null {
  let next: number | null = null;
  for (const o of offers) {
    if (!o.enabled) continue;
    const t = o.startsAt.getTime() > now.getTime() ? o.startsAt.getTime() : o.endsAt.getTime() >= now.getTime() ? o.endsAt.getTime() + 1 : null;
    if (t !== null && (next === null || t < next)) next = t;
  }
  return next === null ? null : new Date(next);
}

export function deriveProductReadModel(input: ReadModelInput): ReadModelRow {
  const { pricing, offers, now } = input;
  const variantFlash = Object.values(pricing.variants).some((v) => v.flash !== null);
  return {
    productId: input.productId,
    minSellingPrice: pricing.from,
    maxSellingPrice: pricing.to,
    listPriceOfMin: pricing.listFrom,
    hasLiveFlashSale: pricing.flash !== null || variantFlash,
    currency: pricing.currency,
    pricingVersion: PRICING_VERSION,
    sourceHash: input.sourceHash,
    validUntil: nextPriceBoundary(offers, now),
    // D4: a live, quantity-limited offer can flip to the regular price with any order (or back with any cancellation),
    // with no write to the product or the sale — so its row is recomputed on every guarded read.
    volatile: offers.some((o) => o.stockLimit !== null && isLive(o, now)),
    computedAt: now,
  };
}
