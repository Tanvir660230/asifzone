import { describe, it, expect } from "vitest";
import {
  DEFAULT_ROUNDING_POLICY as R,
  allocateProportionally,
  buildQuote,
  computeOrderTotals,
  computeTax,
  evaluateBundles,
  evaluateCoupon,
  flashUnitPrice,
  fromMajor,
  inclusiveTaxOf,
  money,
  percentOf,
  priceLineSegments,
  quoteFingerprint,
  resolveShipping,
  resolveUnitPrice,
  rewardableMerchandiseValue,
  selectFlashOffer,
  toMajor,
  type BundleRule,
  type CatalogVariant,
  type CouponRule,
  type FlashOffer,
  type QuoteInputs,
  type ShippingZoneRule,
  type TaxConfig,
} from "@clothing-brand/shared";

// Pure pricing engines (docs/PRICING_INVARIANTS.md). Every number here is exact minor units.

const T = (major: number) => fromMajor(major, "BDT");
const NOW = new Date("2026-09-29T12:00:00Z");
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);

function offer(over: Partial<FlashOffer> = {}): FlashOffer {
  return {
    flashSaleId: "fs1",
    flashSaleItemId: "fi1",
    name: "Sale",
    enabled: true,
    startsAt: at(-60),
    endsAt: at(60),
    discountType: "PERCENTAGE",
    discountValue: 10,
    stockLimit: null,
    unitsSold: 0,
    ...over,
  };
}

function variant(over: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    variantId: "v1",
    productId: "p1",
    categoryId: "c1",
    productName: "Panjabi",
    sku: "SKU1",
    size: "M",
    color: "Black",
    basePrice: T(1000),
    variantPrice: null,
    productCompareAt: null,
    variantCompareAt: null,
    purchasable: true,
    trackInventory: true,
    stock: 100,
    offers: [],
    ...over,
  };
}

const ZONES: ShippingZoneRule[] = [
  { id: "z1", key: "dhaka-district", name: "Dhaka", priority: 10, isDefault: false, isActive: true, matches: [{ field: "DISTRICT", value: "Dhaka" }], fee: T(60), freeOverAmount: null },
  { id: "z2", key: "default", name: "Rest of country", priority: 0, isDefault: true, isActive: true, matches: [], fee: T(120), freeOverAmount: null },
];
const NO_TAX: TaxConfig = { enabled: false, mode: "INCLUSIVE", ratePct: 0, shippingTaxable: true, shippingRatePct: null };

function coupon(over: Partial<CouponRule> = {}): CouponRule {
  return {
    id: "cp1",
    code: "SAVE",
    type: "PERCENTAGE",
    value: 10,
    scope: "ALL_PRODUCTS",
    productIds: [],
    categoryIds: [],
    minOrderAmount: null,
    maxDiscountAmount: null,
    minQuantity: null,
    usageLimit: null,
    usedCount: 0,
    perCustomerLimit: null,
    firstOrderOnly: false,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    deleted: false,
    ...over,
  };
}

function inputs(over: Partial<QuoteInputs> & { variants?: CatalogVariant[] } = {}): QuoteInputs {
  const variants = over.variants ?? [variant()];
  return {
    currency: "BDT",
    now: NOW,
    rounding: R,
    items: variants.map((v) => ({ variantId: v.variantId, quantity: 1 })),
    catalog: new Map(variants.map((v) => [v.variantId, v])),
    bundles: [],
    coupon: null,
    couponContext: { customerRedemptions: null, customerPriorOrders: null },
    shippingZones: ZONES,
    address: { district: "Dhaka", division: "Dhaka" },
    tax: NO_TAX,
    ...over,
  };
}

describe("money", () => {
  it("parses decimals exactly and rounds half-up at the currency's digits", () => {
    expect(fromMajor("0.1", "BDT").amount).toBe(10);
    expect(fromMajor("123.45", "BDT").amount).toBe(12345);
    expect(fromMajor(123.455, "BDT").amount).toBe(12346);
    expect(fromMajor("-5.5", "BDT").amount).toBe(-550);
    expect(toMajor(money(12345, "BDT"))).toBe(123.45);
  });
  it("refuses implicit currency mixing", () => {
    expect(() => computeOrderTotals({ subtotal: T(1), bundleDiscount: money(0, "USD"), couponDiscount: T(0), shippingCharged: T(0), taxAdded: T(0), priceAdjustment: T(0) })).toThrow(/Currency mismatch/);
  });
  it("allocates exactly, with deterministic remainders", () => {
    const parts = allocateProportionally(money(100, "BDT"), [1, 1, 1]);
    expect(parts.map((p) => p.amount)).toEqual([34, 33, 33]);
    expect(allocateProportionally(money(1_000_000_007, "BDT"), [3, 7]).reduce((a, p) => a + p.amount, 0)).toBe(1_000_000_007);
  });
  it("percentage rounding follows the policy (whole taka for discounts, paisa for tax)", () => {
    expect(percentOf(T(333.33), 10, "MAJOR").amount).toBe(3300); // 33.333 → 33
    expect(percentOf(T(335), 10, "MAJOR").amount).toBe(3400); // 33.5 → 34 (half-up)
    expect(percentOf(T(333.33), 10, "MINOR").amount).toBe(3333);
  });
});

describe("unit price resolution", () => {
  it("variant price overrides the product base price", () => {
    expect(resolveUnitPrice({ currency: "BDT", basePrice: T(1000), variantPrice: T(1200), productCompareAt: null, variantCompareAt: null, offers: [], now: NOW, rounding: R }).sellingPrice.amount).toBe(120000);
    expect(resolveUnitPrice({ currency: "BDT", basePrice: T(1000), variantPrice: null, productCompareAt: null, variantCompareAt: null, offers: [], now: NOW, rounding: R }).sellingPrice.amount).toBe(100000);
  });
  it("compare-at: variant's own, product's only when the variant doesn't override price, and only above the price", () => {
    const base = { currency: "BDT", basePrice: T(1000), offers: [], now: NOW, rounding: R };
    expect(resolveUnitPrice({ ...base, variantPrice: null, productCompareAt: T(1500), variantCompareAt: null }).compareAtPrice?.amount).toBe(150000);
    expect(resolveUnitPrice({ ...base, variantPrice: T(1200), productCompareAt: T(1500), variantCompareAt: null }).compareAtPrice).toBeNull();
    expect(resolveUnitPrice({ ...base, variantPrice: T(1200), productCompareAt: null, variantCompareAt: T(1400) }).compareAtPrice?.amount).toBe(140000);
    expect(resolveUnitPrice({ ...base, variantPrice: null, productCompareAt: T(900), variantCompareAt: null }).compareAtPrice).toBeNull();
  });
  it("percentage and fixed flash sales apply to the variant's own price (not the product base price)", () => {
    const r = resolveUnitPrice({ currency: "BDT", basePrice: T(2000), variantPrice: T(2400), productCompareAt: null, variantCompareAt: null, offers: [offer()], now: NOW, rounding: R });
    expect([r.listPrice.amount, r.sellingPrice.amount, r.flashDiscount.amount, r.compareAtPrice?.amount]).toEqual([240000, 216000, 24000, 240000]);
    expect(flashUnitPrice(T(1000), { discountType: "FIXED", discountValue: 150 }, R).amount).toBe(85000);
    expect(flashUnitPrice(T(100), { discountType: "FIXED", discountValue: 150 }, R).amount).toBe(0); // never negative
  });
  it("disabled, scheduled and expired sales never apply", () => {
    for (const o of [offer({ enabled: false }), offer({ startsAt: at(5) }), offer({ endsAt: at(-5) })]) {
      expect(selectFlashOffer(T(1000), [o], NOW, R)).toBeNull();
    }
  });
  it("overlapping sales: best price, then earliest end, then id — never input order", () => {
    const a = offer({ flashSaleItemId: "b", discountValue: 10, endsAt: at(30) });
    const b = offer({ flashSaleItemId: "a", discountValue: 20, endsAt: at(90) });
    expect(selectFlashOffer(T(1000), [a, b], NOW, R)?.offer.flashSaleItemId).toBe("a");
    expect(selectFlashOffer(T(1000), [b, a], NOW, R)?.offer.flashSaleItemId).toBe("a");
    const tieLater = offer({ flashSaleItemId: "x", endsAt: at(90) });
    const tieSooner = offer({ flashSaleItemId: "y", endsAt: at(30) });
    expect(selectFlashOffer(T(1000), [tieLater, tieSooner], NOW, R)?.offer.flashSaleItemId).toBe("y");
    const sameEndA = offer({ flashSaleItemId: "m" });
    const sameEndB = offer({ flashSaleItemId: "k" });
    expect(selectFlashOffer(T(1000), [sameEndA, sameEndB], NOW, R)?.offer.flashSaleItemId).toBe("k");
  });
  it("an exhausted offer is skipped in favour of the next one", () => {
    const exhausted = offer({ flashSaleItemId: "a", discountValue: 30, stockLimit: 5, unitsSold: 5 });
    const other = offer({ flashSaleItemId: "b", discountValue: 10 });
    expect(selectFlashOffer(T(1000), [exhausted, other], NOW, R)?.offer.flashSaleItemId).toBe("b");
  });
});

describe("flash-sale stock limit (D4)", () => {
  const resolved = resolveUnitPrice({ currency: "BDT", basePrice: T(1000), variantPrice: null, productCompareAt: null, variantCompareAt: null, offers: [offer({ stockLimit: 3 })], now: NOW, rounding: R });
  it("limit not reached / exact / exceeded", () => {
    expect(priceLineSegments(resolved, 2, 3).map((s) => [s.quantity, s.unitPrice.amount])).toEqual([[2, 90000]]);
    expect(priceLineSegments(resolved, 3, 3).map((s) => [s.quantity, s.unitPrice.amount])).toEqual([[3, 90000]]);
    expect(priceLineSegments(resolved, 5, 3).map((s) => [s.quantity, s.unitPrice.amount, s.flash?.flashSaleItemId ?? null])).toEqual([
      [3, 90000, "fi1"],
      [2, 100000, null],
    ]);
  });
  it("the limit is shared across cart lines of the same offer, consumed in item order", () => {
    const o = offer({ stockLimit: 3 });
    const q = buildQuote(
      inputs({
        variants: [variant({ variantId: "v1", offers: [o] }), variant({ variantId: "v2", sku: "SKU2", offers: [o] })],
        items: [
          { variantId: "v1", quantity: 2 },
          { variantId: "v2", quantity: 2 },
        ],
      }),
    );
    expect(q.lines.map((l) => l.segments.map((s) => [s.quantity, s.flash ? "flash" : "regular"]))).toEqual([[[2, "flash"]], [[1, "flash"], [1, "regular"]]]);
    expect(q.warnings.some((w) => w.code === "FLASH_LIMIT_PARTIAL")).toBe(true);
    expect(toMajor(q.subtotal)).toBe(900 * 3 + 1000);
  });
});

describe("bundle and coupon stacking (D2, D9)", () => {
  const anchor = variant({ variantId: "a", categoryId: "panjabi", basePrice: T(1000), offers: [offer({ discountValue: 50 })] });
  const cap = variant({ variantId: "b", sku: "B", productId: "p2", categoryId: "cap", basePrice: T(500) });
  const bundle: BundleRule = { id: "bd1", name: "Eid", anchorCategoryId: "panjabi", suggestionCategoryIds: ["cap"], minSuggestedCategories: 1, discountType: "PERCENTAGE", discountValue: 10, sortOrder: 0 };

  it("bundle only, on the flash-adjusted price", () => {
    const q = buildQuote(inputs({ variants: [anchor, cap], bundles: [bundle] }));
    expect(toMajor(q.subtotal)).toBe(1000); // 500 (flash) + 500
    expect(toMajor(q.bundleDiscount)).toBe(100);
  });
  it("bundle eligibility: anchor alone is a near-miss, not a discount", () => {
    const q = buildQuote(inputs({ variants: [anchor], bundles: [bundle] }));
    expect(q.bundleDiscount.amount).toBe(0);
    expect(q.bundleNearMiss?.missingCategoryIds).toEqual(["cap"]);
  });
  it("multiple bundles: the best discount wins deterministically", () => {
    const fixed: BundleRule = { ...bundle, id: "bd2", name: "Flat", discountType: "FIXED", discountValue: 150, sortOrder: 1 };
    const q = buildQuote(inputs({ variants: [anchor, cap], bundles: [bundle, fixed] }));
    expect(q.bundle?.bundleId).toBe("bd2");
    expect(toMajor(q.bundleDiscount)).toBe(150);
  });
  it("bundle discount is capped at the matched items' amount", () => {
    const huge: BundleRule = { ...bundle, discountType: "FIXED", discountValue: 5000 };
    expect(toMajor(buildQuote(inputs({ variants: [anchor, cap], bundles: [huge] })).bundleDiscount)).toBe(1000);
  });
  it("the coupon is computed AFTER the bundle: 10% of (1000 − 100), not of 1000", () => {
    const q = buildQuote(inputs({ variants: [anchor, cap], bundles: [bundle], coupon: { code: "SAVE", rule: coupon() } }));
    expect([toMajor(q.bundleDiscount), toMajor(q.couponDiscount), toMajor(q.discount)]).toEqual([100, 90, 190]);
    expect(q.appliedPromotions.map((p) => p.kind)).toEqual(["FLASH_SALE", "BUNDLE", "COUPON"]);
  });
  it("flash + bundle + coupon + shipping end to end", () => {
    const q = buildQuote(inputs({ variants: [anchor, cap], bundles: [bundle], coupon: { code: "SAVE", rule: coupon() } }));
    expect(toMajor(q.listSubtotal)).toBe(1500);
    expect(toMajor(q.flashDiscount)).toBe(500);
    expect(toMajor(q.total)).toBe(1000 - 190 + 60);
  });
});

describe("coupon rules", () => {
  const lines = [{ key: "l1", productId: "p1", categoryId: "c1", quantity: 2, amount: T(1000) }];
  const ctx = { now: NOW, customerRedemptions: 0, customerPriorOrders: 0 };
  const run = (rule: CouponRule, l = lines, alloc = {}) => evaluateCoupon(rule, l, alloc, ctx, "BDT", R);

  it("percentage (whole-taka rounding), fixed, and the maximum-discount cap", () => {
    expect(run(coupon({ value: 12.5 }))).toMatchObject({ ok: true, discount: { amount: 12500 } });
    expect(run(coupon({ type: "FIXED", value: 150 }))).toMatchObject({ ok: true, discount: { amount: 15000 } });
    expect(run(coupon({ value: 50, maxDiscountAmount: T(200) }))).toMatchObject({ ok: true, discount: { amount: 20000 } });
    expect(run(coupon({ type: "FIXED", value: 5000 }))).toMatchObject({ ok: true, discount: { amount: 100000 } }); // never above the eligible amount
  });
  it("minimum order is checked after the bundle discount", () => {
    const rule = coupon({ minOrderAmount: T(950) });
    expect(run(rule).ok).toBe(true);
    expect(run(rule, lines, { l1: T(100) })).toMatchObject({ ok: false, reason: "MIN_ORDER" });
  });
  it("usage limit, per-customer limit, first-order-only, window, scope and minimum quantity", () => {
    expect(run(coupon({ usageLimit: 5, usedCount: 5 }))).toMatchObject({ ok: false, reason: "USAGE_LIMIT" });
    expect(evaluateCoupon(coupon({ perCustomerLimit: 1 }), lines, {}, { ...ctx, customerRedemptions: 1 }, "BDT", R)).toMatchObject({ ok: false, reason: "PER_CUSTOMER_LIMIT" });
    expect(evaluateCoupon(coupon({ firstOrderOnly: true }), lines, {}, { ...ctx, customerPriorOrders: 2 }, "BDT", R)).toMatchObject({ ok: false, reason: "FIRST_ORDER_ONLY" });
    expect(run(coupon({ startsAt: at(10) }))).toMatchObject({ ok: false, reason: "NOT_STARTED" });
    expect(run(coupon({ expiresAt: at(-10) }))).toMatchObject({ ok: false, reason: "EXPIRED" });
    expect(run(coupon({ scope: "SPECIFIC_CATEGORIES", categoryIds: ["other"] }))).toMatchObject({ ok: false, reason: "NOT_APPLICABLE" });
    expect(run(coupon({ minQuantity: 3 }))).toMatchObject({ ok: false, reason: "MIN_QUANTITY" });
    expect(run(coupon({ isActive: false }))).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });
  it("free shipping waives the fee (and records why)", () => {
    const q = buildQuote(inputs({ coupon: { code: "SHIP", rule: coupon({ type: "FREE_SHIPPING", value: null }) } }));
    expect(q.shipping).toMatchObject({ resolved: true, waived: true, waivedReason: "COUPON", charged: { amount: 0 } });
    expect(toMajor(q.total)).toBe(1000);
  });
  it("a rejected code is reported with its reason, and prices are unaffected", () => {
    const q = buildQuote(inputs({ coupon: { code: "OLD", rule: coupon({ expiresAt: at(-1) }) } }));
    expect(q.rejectedPromotions).toMatchObject([{ code: "OLD", reason: "EXPIRED" }]);
    expect(toMajor(q.total)).toBe(1060);
  });
});

describe("tax (D3, D10)", () => {
  const cfg = (over: Partial<TaxConfig> = {}): TaxConfig => ({ enabled: true, mode: "INCLUSIVE", ratePct: 15, shippingTaxable: true, shippingRatePct: null, ...over });
  it("inclusive: VAT = gross × r / (100 + r); the total is unchanged", () => {
    const t = computeTax(cfg(), T(1150), T(0), R);
    expect([toMajor(t.merchandise.taxAmount), toMajor(t.merchandise.taxableAmount), toMajor(t.addedToTotal)]).toEqual([150, 1000, 0]);
    expect(toMajor(inclusiveTaxOf(T(1000), 15, "MINOR"))).toBe(130.43); // the old (wrong) formula gave 150
  });
  it("exclusive: VAT is added on top", () => {
    const t = computeTax(cfg({ mode: "EXCLUSIVE" }), T(1000), T(0), R);
    expect([toMajor(t.taxAmount), toMajor(t.addedToTotal)]).toEqual([150, 150]);
  });
  it("zero rate, disabled tax and different rates", () => {
    expect(computeTax(cfg({ ratePct: 0 }), T(1000), T(60), R).taxAmount.amount).toBe(0);
    expect(computeTax(cfg({ enabled: false }), T(1000), T(60), R).taxAmount.amount).toBe(0);
    expect(toMajor(computeTax(cfg({ ratePct: 5 }), T(1050), T(0), R).taxAmount)).toBe(50);
  });
  it("shipping VAT follows the central configuration: taxable by default, off when disabled, own rate when set", () => {
    expect(toMajor(computeTax(cfg(), T(0), T(115), R).shipping.taxAmount)).toBe(15);
    expect(computeTax(cfg({ shippingTaxable: false }), T(0), T(115), R).shipping.taxAmount.amount).toBe(0);
    expect(toMajor(computeTax(cfg({ shippingRatePct: 5 }), T(0), T(105), R).shipping.taxAmount)).toBe(5);
  });
  it("a quote carries a complete tax snapshot", () => {
    const q = buildQuote(inputs({ tax: cfg() }));
    expect(q.tax).toMatchObject({ mode: "INCLUSIVE", inclusive: true, ratePct: 15 });
    expect(toMajor(q.tax.taxAmount)).toBeCloseTo(130.43 + 7.83, 2); // 1000 merchandise + 60 shipping, both inclusive
    expect(toMajor(q.total)).toBe(1060);
  });
});

describe("shipping zones", () => {
  it("matches a district zone, falls back to the default zone, prefers specific rules", () => {
    expect(resolveShipping(ZONES, { district: "Dhaka" }, T(100), { couponFreeShipping: false })).toMatchObject({ ok: true, zoneKey: "dhaka-district", fee: { amount: 6000 } });
    expect(resolveShipping(ZONES, { district: "Gazipur", division: "Dhaka" }, T(100), { couponFreeShipping: false })).toMatchObject({ ok: true, zoneKey: "default", fee: { amount: 12000 } });
    const division: ShippingZoneRule = { ...ZONES[1]!, id: "z3", key: "chattogram-div", isDefault: false, priority: 10, matches: [{ field: "DIVISION", value: "Chattogram" }], fee: T(100) };
    const postcode: ShippingZoneRule = { ...ZONES[1]!, id: "z4", key: "port-area", isDefault: false, priority: 10, matches: [{ field: "POSTCODE", value: "4100" }], fee: T(80) };
    expect(resolveShipping([...ZONES, division, postcode], { division: "Chattogram", district: "Chattogram", postcode: "4100" }, T(1), { couponFreeShipping: false })).toMatchObject({ zoneKey: "port-area" });
  });
  it("free-over threshold, missing address, and no matching zone", () => {
    const freeOver = ZONES.map((z) => ({ ...z, freeOverAmount: T(2000) }));
    expect(resolveShipping(freeOver, { district: "Dhaka" }, T(2500), { couponFreeShipping: false })).toMatchObject({ waived: true, waivedReason: "FREE_OVER" });
    expect(resolveShipping(ZONES, null, T(1), { couponFreeShipping: false })).toEqual({ ok: false, reason: "ADDRESS_REQUIRED" });
    expect(resolveShipping([ZONES[0]!], { district: "Sylhet" }, T(1), { couponFreeShipping: false })).toEqual({ ok: false, reason: "NO_ZONE" });
    const q = buildQuote(inputs({ shippingZones: [ZONES[0]!], address: { district: "Sylhet" } }));
    expect(q.orderable).toBe(false);
    expect(q.warnings.map((w) => w.code)).toContain("NO_SHIPPING_ZONE");
  });
});

describe("availability and order totals", () => {
  it("insufficient stock blocks ordering; trackInventory=false never does (D5)", () => {
    expect(buildQuote(inputs({ variants: [variant({ stock: 0 })] })).orderable).toBe(false);
    const untracked = buildQuote(inputs({ variants: [variant({ stock: 0, trackInventory: false })] }));
    expect([untracked.orderable, untracked.lines[0]!.available]).toEqual([true, true]);
  });
  it("deleted/inactive items are not orderable and don't earn promotions", () => {
    const q = buildQuote(inputs({ variants: [variant({ purchasable: false })], coupon: { code: "SAVE", rule: coupon() } }));
    expect(q.orderable).toBe(false);
    expect(q.couponDiscount.amount).toBe(0);
  });
  it("one totals formula; negative totals are flagged, never charged", () => {
    const t = computeOrderTotals({ subtotal: T(1000), bundleDiscount: T(100), couponDiscount: T(50), shippingCharged: T(60), taxAdded: T(0), priceAdjustment: T(-20) });
    expect([toMajor(t.discount), toMajor(t.merchandiseTotal), toMajor(t.total), t.negative]).toEqual([150, 850, 890, false]);
    const neg = computeOrderTotals({ subtotal: T(100), bundleDiscount: T(0), couponDiscount: T(0), shippingCharged: T(0), taxAdded: T(0), priceAdjustment: T(-500) });
    expect([toMajor(neg.total), neg.negative]).toEqual([0, true]);
    expect(toMajor(computeOrderTotals({ subtotal: T(100), bundleDiscount: T(80), couponDiscount: T(80), shippingCharged: T(0), taxAdded: T(0), priceAdjustment: T(0) }).discount)).toBe(100);
  });
  it("the fingerprint changes exactly when what the customer pays changes", () => {
    const a = quoteFingerprint(buildQuote(inputs()));
    expect(quoteFingerprint(buildQuote(inputs()))).toBe(a);
    expect(quoteFingerprint(buildQuote(inputs({ variants: [variant({ basePrice: T(999) })] })))).not.toBe(a);
    expect(quoteFingerprint(buildQuote(inputs({ address: { district: "Sylhet" } })))).not.toBe(a);
  });
});

describe("determinism", () => {
  it("the same inputs always produce the same quote (no clock, no row order)", () => {
    const o1 = offer({ flashSaleItemId: "a", discountValue: 15 });
    const o2 = offer({ flashSaleItemId: "b", discountValue: 15 });
    const q1 = buildQuote(inputs({ variants: [variant({ offers: [o1, o2] })] }));
    const q2 = buildQuote(inputs({ variants: [variant({ offers: [o2, o1] })] }));
    expect(JSON.stringify(q1)).toBe(JSON.stringify(q2));
    expect(evaluateBundles([], [], "BDT", R)).toEqual({ applied: null, nearMiss: null, candidates: [] });
  });
});

// PRICING_PIPELINE §1a — the tax/shipping dependency graph: merchandise tax depends only on merchandise after
// discounts; shipping tax depends only on the resolved shipping charge; both are aggregated once, after shipping is
// resolved; the total is computed once by computeOrderTotals.
describe("tax ⇄ shipping dependency (D3, D10)", () => {
  const vat = (over: Partial<TaxConfig> = {}): TaxConfig => ({ enabled: true, mode: "INCLUSIVE", ratePct: 15, shippingTaxable: true, shippingRatePct: null, ...over });
  const zones = (fee: number): ShippingZoneRule[] => ZONES.map((z) => ({ ...z, fee: T(fee) }));
  const q = (fee: number, tax = vat(), extra: Partial<QuoteInputs> = {}) =>
    buildQuote(inputs({ variants: [variant({ basePrice: T(1150) })], shippingZones: zones(fee), tax, ...extra }));

  it("merchandise tax is correct and does not depend on shipping", () => {
    for (const fee of [0, 60, 115, 300]) {
      const t = q(fee).tax;
      expect([toMajor(t.merchandise.taxAmount), toMajor(t.merchandise.taxableAmount)]).toEqual([150, 1000]);
    }
    // After a coupon: merchandise tax follows merchandise after discounts only.
    const withCoupon = q(60, vat(), { coupon: { code: "SAVE", rule: coupon({ type: "FIXED", value: 115 }) } });
    expect(toMajor(withCoupon.tax.merchandise.taxAmount)).toBe(135); // VAT inside 1035
  });

  it("shipping VAT is computed on the resolved shipping charge", () => {
    expect(toMajor(q(115).tax.shipping.taxAmount)).toBe(15); // 115 × 15 / 115
    expect(toMajor(q(60).tax.shipping.taxAmount)).toBe(7.83);
    // A waived fee carries no VAT (the charge is 0).
    const free = q(115, vat(), { coupon: { code: "SHIP", rule: coupon({ type: "FREE_SHIPPING", value: null }) } });
    expect([free.shipping.resolved && toMajor(free.shipping.charged), toMajor(free.tax.shipping.taxAmount)]).toEqual([0, 0]);
    // No address → no shipping charge → no shipping VAT; merchandise VAT still correct.
    const none = q(115, vat(), { address: null });
    expect([toMajor(none.tax.shipping.taxAmount), toMajor(none.tax.merchandise.taxAmount)]).toEqual([0, 150]);
  });

  it("changing the shipping fee changes only the shipping-tax component", () => {
    for (const mode of ["INCLUSIVE", "EXCLUSIVE"] as const) {
      const a = q(60, vat({ mode }));
      const b = q(115, vat({ mode }));
      expect(b.tax.merchandise).toEqual(a.tax.merchandise);
      expect(b.tax.shipping.taxAmount).not.toEqual(a.tax.shipping.taxAmount);
      expect(b.tax.taxAmount.amount - a.tax.taxAmount.amount).toBe(b.tax.shipping.taxAmount.amount - a.tax.shipping.taxAmount.amount);
      expect([b.subtotal, b.discount, b.merchandiseTotal]).toEqual([a.subtotal, a.discount, a.merchandiseTotal]);
    }
  });

  it("the final total is deterministic and equals the one totals formula", () => {
    for (const mode of ["INCLUSIVE", "EXCLUSIVE"] as const) {
      const a = q(60, vat({ mode }));
      expect(JSON.stringify(q(60, vat({ mode })))).toBe(JSON.stringify(a));
      const charged = a.shipping.resolved ? a.shipping.charged : T(0);
      const once = computeOrderTotals({ subtotal: a.subtotal, bundleDiscount: a.bundleDiscount, couponDiscount: a.couponDiscount, shippingCharged: charged, taxAdded: a.tax.addedToTotal, priceAdjustment: T(0) });
      expect(a.total).toEqual(once.total);
    }
    // Inclusive: tax never changes the total. Exclusive: merchandise VAT (150 on 1150) + shipping VAT (9 on 60) added once.
    expect(toMajor(q(60).total)).toBe(1210);
    expect(toMajor(q(60, vat({ mode: "EXCLUSIVE" })).total)).toBe(1150 + 60 + 172.5 + 9);
  });
});

describe("rewardable merchandise value (D8)", () => {
  it("subtotal − bundle − coupon, never below zero", () => {
    expect(toMajor(rewardableMerchandiseValue({ subtotal: T(1500), bundleDiscount: T(100), couponDiscount: T(140) }))).toBe(1260);
    expect(toMajor(rewardableMerchandiseValue({ subtotal: T(100), bundleDiscount: T(80), couponDiscount: T(80) }))).toBe(0);
  });
  it("an exchange replacement is rewarded only on value beyond the credited returned item", () => {
    expect(toMajor(rewardableMerchandiseValue({ subtotal: T(1200), bundleDiscount: T(0), couponDiscount: T(0), exchangeCredit: T(1000) }))).toBe(200);
  });
  it("a quote's shipping, tax and totals are not inputs: the value is the same whatever they are", () => {
    const vatCfg: TaxConfig = { enabled: true, mode: "EXCLUSIVE", ratePct: 15, shippingTaxable: true, shippingRatePct: null };
    const values = [inputs(), inputs({ tax: vatCfg }), inputs({ address: { district: "Sylhet" }, tax: vatCfg })].map((i) => {
      const quote = buildQuote({ ...i, coupon: { code: "SAVE", rule: coupon({ type: "FIXED", value: 200 }) } });
      expect(quote.total.amount).toBeGreaterThan(0);
      return toMajor(rewardableMerchandiseValue({ subtotal: quote.subtotal, bundleDiscount: quote.bundleDiscount, couponDiscount: quote.couponDiscount }));
    });
    expect(values).toEqual([800, 800, 800]);
  });
});
