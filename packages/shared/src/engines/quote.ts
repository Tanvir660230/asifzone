import { multiply, subtract, sum, toMajor, zero, type Money } from "./money";
import { priceLineSegments, remainingUnits, resolveUnitPrice, type AppliedFlash, type FlashOffer, type PriceSegment } from "./pricing";
import { evaluateBundles, evaluateCoupon, type BundleCandidate, type BundleRule, type CouponContext, type CouponRejection, type CouponRule, type PromoLine } from "./promotion";
import { computeTax, type TaxConfig, type TaxResult } from "./tax";
import { resolveShipping, type ShippingAddress, type ShippingZoneRule } from "./shipping";
import { computeOrderTotals } from "./order-totals";
import { isAvailable } from "./availability";
import type { RoundingPolicy } from "./rounding";

/**
 * THE canonical pricing pipeline (docs/PRICING_PIPELINE.md, D9):
 *
 *   List Price → Variant Price → Flash Sale → Bundle Discount → Coupon Discount → Tax → Shipping → Final Total
 *
 * Pure: the pricing service loads every input (catalog, offers with units sold, bundles, coupon, zones, tax config,
 * `now`) and calls this; the storefront, cart, checkout, order creation, the admin manual order and exchanges all get
 * their numbers from it. Bump PRICING_VERSION whenever a rule here changes what a cart costs.
 */
export const PRICING_VERSION = 2;

export interface CatalogVariant {
  variantId: string;
  productId: string;
  categoryId: string;
  productName: string;
  sku: string;
  size: string;
  color: string;
  basePrice: Money;
  variantPrice: Money | null;
  productCompareAt: Money | null;
  variantCompareAt: Money | null;
  /** Published, not trashed, variant active. */
  purchasable: boolean;
  trackInventory: boolean;
  stock: number;
  offers: FlashOffer[];
}

export interface QuoteInputs {
  currency: string;
  now: Date;
  rounding: RoundingPolicy;
  items: Array<{ variantId: string; quantity: number }>;
  catalog: Map<string, CatalogVariant>;
  bundles: BundleRule[];
  coupon: { code: string; rule: CouponRule | null } | null;
  couponContext: Omit<CouponContext, "now">;
  shippingZones: ShippingZoneRule[];
  address: ShippingAddress | null;
  tax: TaxConfig;
}

export interface QuoteSegment {
  quantity: number;
  unitPrice: Money;
  listUnitPrice: Money;
  total: Money;
  flash: AppliedFlash | null;
}

export interface QuoteLine {
  key: string;
  variantId: string;
  productId: string;
  categoryId: string;
  productName: string;
  sku: string;
  size: string;
  color: string;
  quantity: number;
  listUnitPrice: Money;
  compareAtPrice: Money | null;
  segments: QuoteSegment[];
  /** Σ segment totals (post-flash). */
  amount: Money;
  /** quantity × list price. */
  listAmount: Money;
  flashDiscount: Money;
  bundleDiscount: Money;
  couponDiscount: Money;
  purchasable: boolean;
  trackInventory: boolean;
  stock: number;
  /** Enough stock for this quantity (always true when inventory isn't tracked — D5). */
  available: boolean;
}

export type QuoteWarning =
  | { code: "UNKNOWN_ITEM"; variantId: string; message: string }
  | { code: "UNAVAILABLE"; variantId: string; message: string }
  | { code: "INSUFFICIENT_STOCK"; variantId: string; available: number; message: string }
  | { code: "FLASH_LIMIT_PARTIAL"; variantId: string; flashQuantity: number; message: string }
  | { code: "ADDRESS_REQUIRED"; message: string }
  | { code: "NO_SHIPPING_ZONE"; message: string };

export interface AppliedPromotion {
  kind: "FLASH_SALE" | "BUNDLE" | "COUPON";
  id: string;
  name: string;
  amount: Money;
  freeShipping?: boolean;
}

export interface RejectedPromotion {
  kind: "COUPON";
  code: string;
  reason: CouponRejection;
  message: string;
}

export interface Quote {
  pricingVersion: number;
  currency: string;
  lines: QuoteLine[];
  listSubtotal: Money;
  flashDiscount: Money;
  subtotal: Money;
  bundle: (BundleCandidate & { allocation: Record<string, Money> }) | null;
  bundleNearMiss: BundleCandidate | null;
  bundleDiscount: Money;
  coupon: { id: string; code: string; type: CouponRule["type"]; discount: Money; freeShipping: boolean; eligibleProductIds: string[] } | null;
  couponDiscount: Money;
  discount: Money;
  merchandiseTotal: Money;
  shipping:
    | { resolved: true; zoneId: string; zoneKey: string; zoneName: string; fee: Money; charged: Money; waived: boolean; waivedReason: "COUPON" | "FREE_OVER" | null }
    | { resolved: false; reason: "ADDRESS_REQUIRED" | "NO_ZONE" };
  tax: TaxResult;
  total: Money;
  appliedPromotions: AppliedPromotion[];
  rejectedPromotions: RejectedPromotion[];
  warnings: QuoteWarning[];
  /** Every line purchasable with enough stock, and shipping resolved — safe to place an order from. */
  orderable: boolean;
}

export function buildQuote(input: QuoteInputs): Quote {
  const cur = input.currency;
  const warnings: QuoteWarning[] = [];
  const appliedPromotions: AppliedPromotion[] = [];
  const rejectedPromotions: RejectedPromotion[] = [];

  // 1–3. List price → variant price → flash sale, per line. Flash units left under each offer's limit are shared
  // across the cart's lines (an offer is per product; several variants of it draw from one limit), consumed in item order.
  const flashLeft = new Map<string, number | null>();
  const lines: QuoteLine[] = [];
  for (const [index, item] of input.items.entries()) {
    const v = input.catalog.get(item.variantId);
    if (!v) {
      warnings.push({ code: "UNKNOWN_ITEM", variantId: item.variantId, message: "One or more items in your cart are no longer available" });
      continue;
    }
    for (const o of v.offers) if (!flashLeft.has(o.flashSaleItemId)) flashLeft.set(o.flashSaleItemId, remainingUnits(o));
    const offersNow = v.offers.map((o) => {
      const left = flashLeft.get(o.flashSaleItemId);
      return left === null || left === undefined ? o : { ...o, unitsSold: (o.stockLimit ?? 0) - left };
    });
    const resolved = resolveUnitPrice({
      currency: cur,
      basePrice: v.basePrice,
      variantPrice: v.variantPrice,
      productCompareAt: v.productCompareAt,
      variantCompareAt: v.variantCompareAt,
      offers: offersNow,
      now: input.now,
      rounding: input.rounding,
    });
    const offerLeft = resolved.flashSale ? (flashLeft.get(resolved.flashSale.flashSaleItemId) ?? null) : null;
    const segments: PriceSegment[] = priceLineSegments(resolved, item.quantity, offerLeft);
    const flashQty = segments.filter((s) => s.flash).reduce((q, s) => q + s.quantity, 0);
    if (resolved.flashSale && offerLeft !== null) flashLeft.set(resolved.flashSale.flashSaleItemId, offerLeft - flashQty);
    if (resolved.flashSale && flashQty < item.quantity) {
      warnings.push({
        code: "FLASH_LIMIT_PARTIAL",
        variantId: v.variantId,
        flashQuantity: flashQty,
        message: `Only ${flashQty} of ${v.productName} at the flash-sale price — the rest at the regular price`,
      });
    }

    const amount = sum(segments.map((s) => s.total), cur);
    const listAmount = multiply(resolved.listPrice, item.quantity);
    const available = isAvailable(v.trackInventory, v.stock, item.quantity);
    if (!v.purchasable) warnings.push({ code: "UNAVAILABLE", variantId: v.variantId, message: `${v.productName} is no longer available` });
    else if (!available) {
      warnings.push({ code: "INSUFFICIENT_STOCK", variantId: v.variantId, available: Math.max(0, v.stock), message: `Not enough stock for ${v.productName}` });
    }
    lines.push({
      key: `${index}:${v.variantId}`,
      variantId: v.variantId,
      productId: v.productId,
      categoryId: v.categoryId,
      productName: v.productName,
      sku: v.sku,
      size: v.size,
      color: v.color,
      quantity: item.quantity,
      listUnitPrice: resolved.listPrice,
      compareAtPrice: resolved.compareAtPrice,
      segments: segments.map((s) => ({ quantity: s.quantity, unitPrice: s.unitPrice, listUnitPrice: s.listUnitPrice, total: s.total, flash: s.flash })),
      amount,
      listAmount,
      flashDiscount: subtract(listAmount, amount),
      bundleDiscount: zero(cur),
      couponDiscount: zero(cur),
      purchasable: v.purchasable,
      trackInventory: v.trackInventory,
      stock: v.stock,
      available,
    });
  }

  // Promotions only see lines that can actually be bought.
  const promoLines: PromoLine[] = lines
    .filter((l) => l.purchasable)
    .map((l) => ({ key: l.key, productId: l.productId, categoryId: l.categoryId, quantity: l.quantity, amount: l.amount }));
  const subtotal = sum(lines.map((l) => l.amount), cur);
  const listSubtotal = sum(lines.map((l) => l.listAmount), cur);
  const flashDiscount = subtract(listSubtotal, subtotal);
  for (const l of lines) {
    const flash = l.segments.find((s) => s.flash)?.flash;
    if (flash && !appliedPromotions.some((p) => p.kind === "FLASH_SALE" && p.id === flash.flashSaleId)) {
      appliedPromotions.push({ kind: "FLASH_SALE", id: flash.flashSaleId, name: flash.name, amount: zero(cur) });
    }
  }
  for (const p of appliedPromotions) {
    if (p.kind === "FLASH_SALE") p.amount = sum(lines.filter((l) => l.segments.some((s) => s.flash?.flashSaleId === p.id)).map((l) => l.flashDiscount), cur);
  }

  // 4. Bundle (on post-flash amounts — D2).
  const bundleResult = evaluateBundles(input.bundles, promoLines, cur, input.rounding);
  const bundleAllocation = bundleResult.applied?.allocation ?? {};
  const bundleDiscount = bundleResult.applied?.discount ?? zero(cur);
  if (bundleResult.applied) appliedPromotions.push({ kind: "BUNDLE", id: bundleResult.applied.bundleId, name: bundleResult.applied.name, amount: bundleDiscount });

  // 5. Coupon (after the bundle — D9).
  let coupon: Quote["coupon"] = null;
  let couponAllocation: Record<string, Money> = {};
  if (input.coupon) {
    const result = evaluateCoupon(input.coupon.rule, promoLines, bundleAllocation, { ...input.couponContext, now: input.now }, cur, input.rounding);
    if (result.ok && input.coupon.rule) {
      coupon = {
        id: input.coupon.rule.id,
        code: input.coupon.rule.code,
        type: input.coupon.rule.type,
        discount: result.discount,
        freeShipping: result.freeShipping,
        eligibleProductIds: result.eligibleProductIds,
      };
      couponAllocation = result.allocation;
      appliedPromotions.push({ kind: "COUPON", id: coupon.id, name: coupon.code, amount: coupon.discount, freeShipping: coupon.freeShipping || undefined });
    } else if (!result.ok) {
      rejectedPromotions.push({ kind: "COUPON", code: input.coupon.code, reason: result.reason, message: result.message });
    }
  }
  const couponDiscount = coupon?.discount ?? zero(cur);
  for (const l of lines) {
    l.bundleDiscount = bundleAllocation[l.key] ?? zero(cur);
    l.couponDiscount = couponAllocation[l.key] ?? zero(cur);
  }

  // Merchandise after discounts (the totals engine clamps the combined discount to the subtotal).
  const preShipping = computeOrderTotals({
    subtotal,
    bundleDiscount,
    couponDiscount,
    shippingCharged: zero(cur),
    taxAdded: zero(cur),
    priceAdjustment: zero(cur),
  });

  // 6–7. Shipping from the zones, then tax on merchandise and the shipping actually charged (D10).
  const ship = resolveShipping(input.shippingZones, input.address, preShipping.merchandiseTotal, { couponFreeShipping: coupon?.freeShipping ?? false });
  if (!ship.ok) {
    warnings.push(
      ship.reason === "ADDRESS_REQUIRED"
        ? { code: "ADDRESS_REQUIRED", message: "Shipping is calculated once a delivery address is chosen" }
        : { code: "NO_SHIPPING_ZONE", message: "We can't deliver to this address yet" },
    );
  }
  const shippingCharged = ship.ok ? ship.charged : zero(cur);
  const tax = computeTax(input.tax, preShipping.merchandiseTotal, shippingCharged, input.rounding);

  // 8. Final total — the one formula.
  const totals = computeOrderTotals({
    subtotal,
    bundleDiscount,
    couponDiscount,
    shippingCharged,
    taxAdded: tax.addedToTotal,
    priceAdjustment: zero(cur),
  });

  const orderable =
    lines.length > 0 &&
    lines.length === input.items.length &&
    lines.every((l) => l.purchasable && l.available) &&
    ship.ok;

  return {
    pricingVersion: PRICING_VERSION,
    currency: cur,
    lines,
    listSubtotal,
    flashDiscount,
    subtotal,
    bundle: bundleResult.applied,
    bundleNearMiss: bundleResult.nearMiss,
    bundleDiscount,
    coupon,
    couponDiscount,
    discount: totals.discount,
    merchandiseTotal: totals.merchandiseTotal,
    shipping: ship.ok
      ? { resolved: true, zoneId: ship.zoneId, zoneKey: ship.zoneKey, zoneName: ship.zoneName, fee: ship.fee, charged: ship.charged, waived: ship.waived, waivedReason: ship.waivedReason }
      : { resolved: false, reason: ship.reason },
    tax,
    total: totals.total,
    appliedPromotions,
    rejectedPromotions,
    warnings,
    orderable,
  };
}

/**
 * A stable fingerprint of everything that determines what the customer pays (line prices and attribution, discounts,
 * shipping, tax, total). The API hashes it into a quote token; an order placed against a token whose fingerprint no
 * longer matches is refused with a requote — a stale price is never charged (PRICING_INVARIANTS §7).
 */
export function quoteFingerprint(q: Quote): string {
  const m = (x: Money) => x.amount;
  return JSON.stringify([
    q.pricingVersion,
    q.currency,
    q.lines.map((l) => [l.variantId, l.quantity, l.segments.map((s) => [s.quantity, m(s.unitPrice), s.flash?.flashSaleItemId ?? null])]),
    m(q.bundleDiscount),
    q.bundle?.bundleId ?? null,
    m(q.couponDiscount),
    q.coupon?.id ?? null,
    q.coupon?.freeShipping ?? false,
    q.shipping.resolved ? [q.shipping.zoneId, m(q.shipping.charged)] : q.shipping.reason,
    [q.tax.mode, q.tax.ratePct, m(q.tax.taxAmount)],
    m(q.total),
  ]);
}

/** A value with every Money replaced by its major-unit number — the JSON shape the API returns. */
export type ToMajor<T> = T extends Money
  ? number
  : T extends Date
    ? string
    : T extends Array<infer U>
      ? Array<ToMajor<U>>
      : T extends object
        ? { [K in keyof T]: ToMajor<T[K]> }
        : T;

/** The canonical quote as returned by POST /api/v1/checkout/quote (money in major units) plus its token. */
export type QuoteDto = ToMajor<Quote> & { token: string; expiresAt: string };

/** Converts every Money in a quote to major-unit numbers for the JSON DTO (the API boundary). */
export function quoteMoneyToMajor<T>(value: T): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(quoteMoneyToMajor);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.amount === "number" && typeof o.currency === "string" && Object.keys(o).length === 2) return toMajor(o as unknown as Money);
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, quoteMoneyToMajor(v)]));
  }
  return value;
}

