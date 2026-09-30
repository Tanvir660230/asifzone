import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import {
  DEFAULT_ROUNDING_POLICY,
  buildQuote,
  couponValue,
  evaluateCoupon,
  fromMajor,
  quoteFingerprint,
  quoteMoneyToMajor,
  resolveUnitPrice,
  toMajor,
  type BundleRule,
  type CatalogVariant,
  type CouponRule,
  type FlashOffer,
  type Quote,
  type QuoteDto,
  type ShippingAddress,
} from "@clothing-brand/shared";
import { prisma, type Db as AppDb } from "../../config/prisma";
import { getSettings } from "../../modules/settings/settings.service";
import { loadShippingZones, loadTaxConfig } from "./pricing-config";

/**
 * PricingService — the orchestration half of the canonical pricing pipeline (docs/PRICING_INVARIANTS.md). It loads every
 * input (catalog, live flash offers and their used units, bundles, coupon + customer context, shipping zones, tax
 * configuration, currency, `now`), normalises it to engine Money, and calls the pure engines in
 * packages/shared/src/engines. It never computes a price itself and never writes anything (inventory stays with
 * inventory.service; orders with order.service).
 *
 * Every consumer — product pages and listings, cart, checkout, order creation (COD, online, admin), exchanges, coupon and
 * bundle previews — goes through here.
 */
type Db = AppDb;

/** How long a quote token is presented as valid to the client. The server re-prices at order time regardless. */
export const QUOTE_TTL_MS = 15 * 60 * 1000;

export interface QuoteRequest {
  items: Array<{ variantId: string; quantity: number }>;
  couponCode?: string | null;
  address?: ShippingAddress | null;
  customerId?: string | null;
  /** Exchanges price the replacement at the current effective price only (flash applies; bundles/coupons don't). */
  promotions?: "ALL" | "FLASH_ONLY";
  now?: Date;
}

export interface CatalogRow {
  id: string;
  productId: string;
  sku: string;
  size: string;
  color: string;
  stock: number;
  isActive: boolean;
  product: { name: string; categoryId: string; trackInventory: boolean; lowStockThreshold: number; isActive: boolean; deletedAt: Date | null };
}

export interface PricedQuote {
  quote: Quote;
  token: string;
  /** Raw catalog rows by variant id (order creation needs thresholds and names for alerts). */
  rows: Map<string, CatalogRow>;
}

async function currencyOf(): Promise<string> {
  return (await getSettings()).currency || "BDT";
}

/** Units sold under each flash-sale item, net of units put back (cancelled/returned): Σ (quantity − restockedQuantity)
 * over the order lines attributed to it. Historical attribution is the only source — never re-derived from prices. */
export async function flashUnitsSold(itemIds: string[], db: Db = prisma): Promise<Map<string, number>> {
  if (!itemIds.length) return new Map();
  const rows = await db.orderItem.groupBy({
    by: ["flashSaleItemId"],
    where: { flashSaleItemId: { in: itemIds } },
    _sum: { quantity: true, restockedQuantity: true },
  });
  return new Map(rows.map((r) => [r.flashSaleItemId!, (r._sum.quantity ?? 0) - (r._sum.restockedQuantity ?? 0)]));
}

/** Live flash offers for these products at `now`, with their used units — batched (two queries for any cart). */
export async function loadFlashOffers(productIds: string[], now: Date, db: Db = prisma): Promise<Map<string, FlashOffer[]>> {
  const byProduct = new Map<string, FlashOffer[]>();
  if (!productIds.length) return byProduct;
  const items = await db.flashSaleItem.findMany({
    where: { productId: { in: productIds }, flashSale: { enabled: true, startsAt: { lte: now }, endsAt: { gte: now } } },
    include: { flashSale: true },
  });
  const sold = await flashUnitsSold(items.map((i) => i.id), db);
  for (const item of items) {
    const offer: FlashOffer = {
      flashSaleId: item.flashSaleId,
      flashSaleItemId: item.id,
      name: item.flashSale.name,
      enabled: item.flashSale.enabled,
      startsAt: item.flashSale.startsAt,
      endsAt: item.flashSale.endsAt,
      discountType: item.discountType === "FIXED" ? "FIXED" : "PERCENTAGE",
      discountValue: Number(item.discountValue),
      stockLimit: item.stockLimit,
      unitsSold: sold.get(item.id) ?? 0,
    };
    byProduct.set(item.productId, [...(byProduct.get(item.productId) ?? []), offer]);
  }
  return byProduct;
}

async function loadBundles(db: Db): Promise<BundleRule[]> {
  const bundles = await db.bundle.findMany({ where: { isActive: true }, include: { suggestions: { orderBy: { sortOrder: "asc" } } } });
  return bundles.map((b) => ({
    id: b.id,
    name: b.name,
    anchorCategoryId: b.anchorCategoryId,
    suggestionCategoryIds: b.suggestions.map((s) => s.categoryId),
    minSuggestedCategories: b.minSuggestedCategories,
    discountType: b.discountType,
    discountValue: Number(b.discountValue),
    sortOrder: b.sortOrder,
  }));
}

function toCouponRule(c: Prisma.CouponGetPayload<{ include: { products: true; categories: true } }>, currency: string): CouponRule {
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    value: c.value === null ? null : Number(c.value),
    scope: c.scope,
    productIds: c.products.map((p) => p.productId),
    categoryIds: c.categories.map((x) => x.categoryId),
    minOrderAmount: c.minOrderAmount ? fromMajor(c.minOrderAmount.toString(), currency) : null,
    maxDiscountAmount: c.maxDiscountAmount ? fromMajor(c.maxDiscountAmount.toString(), currency) : null,
    minQuantity: c.minQuantity,
    usageLimit: c.usageLimit,
    usedCount: c.usedCount,
    perCustomerLimit: c.perCustomerLimit,
    firstOrderOnly: c.firstOrderOnly,
    startsAt: c.startsAt,
    expiresAt: c.expiresAt,
    isActive: c.isActive,
    deleted: c.deletedAt !== null,
  };
}

/** D7 redemption predicate: a customer's orders using this coupon that still count (not trashed, usage not released). */
async function couponContext(db: Db, couponId: string | null, customerId: string | null) {
  if (!customerId) return { customerRedemptions: null, customerPriorOrders: null };
  const [customerRedemptions, customerPriorOrders] = await Promise.all([
    couponId ? db.order.count({ where: { couponId, customerId, deletedAt: null, couponReleasedAt: null } }) : Promise.resolve(0),
    db.order.count({ where: { customerId, deletedAt: null } }),
  ]);
  return { customerRedemptions, customerPriorOrders };
}

async function loadCatalog(variantIds: string[], now: Date, currency: string, db: Db) {
  const rows = await db.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      productId: true,
      sku: true,
      size: true,
      color: true,
      price: true,
      compareAtPrice: true,
      stock: true,
      isActive: true,
      product: {
        select: { name: true, categoryId: true, basePrice: true, compareAtPrice: true, isActive: true, deletedAt: true, trackInventory: true, lowStockThreshold: true },
      },
    },
  });
  const offers = await loadFlashOffers([...new Set(rows.map((r) => r.productId))], now, db);
  const catalog = new Map<string, CatalogVariant>();
  for (const r of rows) {
    catalog.set(r.id, {
      variantId: r.id,
      productId: r.productId,
      categoryId: r.product.categoryId,
      productName: r.product.name,
      sku: r.sku,
      size: r.size,
      color: r.color,
      basePrice: fromMajor(r.product.basePrice.toString(), currency),
      variantPrice: r.price === null ? null : fromMajor(r.price.toString(), currency),
      productCompareAt: r.product.compareAtPrice ? fromMajor(r.product.compareAtPrice.toString(), currency) : null,
      variantCompareAt: r.compareAtPrice ? fromMajor(r.compareAtPrice.toString(), currency) : null,
      purchasable: r.product.isActive && r.product.deletedAt === null && r.isActive,
      trackInventory: r.product.trackInventory,
      stock: r.stock,
      offers: offers.get(r.productId) ?? [],
    });
  }
  return { catalog, rows: new Map(rows.map((r) => [r.id, r as unknown as CatalogRow])) };
}

export function quoteToken(quote: Quote): string {
  return crypto.createHash("sha256").update(quoteFingerprint(quote)).digest("hex").slice(0, 40);
}

/** THE server-side quote. `db` lets order creation price inside its own transaction. */
export async function quoteCart(req: QuoteRequest, db: Db = prisma): Promise<PricedQuote> {
  const now = req.now ?? new Date();
  const currency = await currencyOf();
  const flashOnly = req.promotions === "FLASH_ONLY";
  const { catalog, rows } = await loadCatalog([...new Set(req.items.map((i) => i.variantId))], now, currency, db);
  const couponRow =
    !flashOnly && req.couponCode
      ? await db.coupon.findUnique({ where: { code: req.couponCode.toUpperCase() }, include: { products: true, categories: true } })
      : null;
  const [bundles, zones, tax, ctx] = await Promise.all([
    flashOnly ? Promise.resolve([]) : loadBundles(db),
    loadShippingZones(currency, db),
    loadTaxConfig(db),
    couponContext(db, couponRow?.id ?? null, req.customerId ?? null),
  ]);
  const quote = buildQuote({
    currency,
    now,
    rounding: DEFAULT_ROUNDING_POLICY,
    items: req.items,
    catalog,
    bundles,
    coupon: !flashOnly && req.couponCode ? { code: req.couponCode, rule: couponRow ? toCouponRule(couponRow, currency) : null } : null,
    couponContext: ctx,
    shippingZones: zones,
    address: req.address ?? null,
    tax,
  });
  return { quote, token: quoteToken(quote), rows };
}

export function toQuoteDto(priced: PricedQuote, now: Date = new Date()): QuoteDto {
  return {
    ...(quoteMoneyToMajor(priced.quote) as Omit<QuoteDto, "token" | "expiresAt">),
    token: priced.token,
    expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
  };
}

/**
 * The best coupon this cart already qualifies for (checkout suggestion) — every candidate evaluated by the same
 * promotion engine, after the bundle (D9), with the same customer context. No second set of coupon rules.
 */
export async function bestCouponFor(req: QuoteRequest, db: Db = prisma) {
  const base = await quoteCart({ ...req, couponCode: null }, db);
  const currency = base.quote.currency;
  const now = req.now ?? new Date();
  const candidates = await db.coupon.findMany({
    where: { isActive: true, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { products: true, categories: true },
  });
  const promoLines = base.quote.lines
    .filter((l) => l.purchasable)
    .map((l) => ({ key: l.key, productId: l.productId, categoryId: l.categoryId, quantity: l.quantity, amount: l.amount }));
  const bundleAllocation = base.quote.bundle?.allocation ?? {};
  const shippingFee = base.quote.shipping.resolved ? base.quote.shipping.fee : null;
  let best: { code: string; value: number } | null = null;
  for (const c of candidates) {
    const ctx = await couponContext(db, c.id, req.customerId ?? null);
    const result = evaluateCoupon(toCouponRule(c, currency), promoLines, bundleAllocation, { ...ctx, now }, currency, DEFAULT_ROUNDING_POLICY);
    const value = couponValue(result, shippingFee);
    if (value > 0 && (!best || value > best.value)) best = { code: c.code, value };
  }
  if (!best) return null;
  return quoteCart({ ...req, couponCode: best.code }, db);
}

// --- read models for product pages, listings, search, homepage and flash-sale feeds ----------------------------

export interface VariantPricingDto {
  list: number;
  selling: number;
  compareAt: number | null;
  flash: { flashSaleId: string; name: string; endsAt: string; discountType: "PERCENTAGE" | "FIXED"; discountValue: number; remaining: number | null } | null;
}

export interface ProductPricingDto {
  currency: string;
  /** Lowest current selling price across the product's active variants (the "from" price). */
  from: number;
  /** Highest current selling price. */
  to: number;
  /** List price of the variant that sets `from` (struck through when a flash sale is on). */
  listFrom: number;
  /** Compare-at for the `from` variant, if any (list price during a flash sale). */
  compareAt: number | null;
  /** The flash sale pricing the `from` variant, if any. */
  flash: VariantPricingDto["flash"];
  variants: Record<string, VariantPricingDto>;
}

export interface PriceableProduct {
  id: string;
  basePrice: unknown;
  compareAtPrice?: unknown;
  variants?: Array<{ id: string; price: unknown; compareAtPrice?: unknown; isActive?: boolean }>;
}

/** Server-resolved display prices for products — the same resolveUnitPrice every quote uses. One batched offer load. */
export async function priceProductsForDisplay(products: PriceableProduct[], now: Date = new Date(), db: Db = prisma): Promise<Map<string, ProductPricingDto>> {
  const currency = await currencyOf();
  const offers = await loadFlashOffers(products.map((p) => p.id), now, db);
  const out = new Map<string, ProductPricingDto>();
  const money = (v: unknown) => (v === null || v === undefined ? null : fromMajor(String(v), currency));
  for (const p of products) {
    const variants = (p.variants ?? []).filter((v) => v.isActive !== false);
    const entries = (variants.length ? variants : [{ id: "", price: null, compareAtPrice: null }]).map((v) => {
      const r = resolveUnitPrice({
        currency,
        basePrice: money(p.basePrice)!,
        variantPrice: money(v.price),
        productCompareAt: money(p.compareAtPrice),
        variantCompareAt: money(v.compareAtPrice),
        offers: offers.get(p.id) ?? [],
        now,
        rounding: DEFAULT_ROUNDING_POLICY,
      });
      const dto: VariantPricingDto = {
        list: toMajor(r.listPrice),
        selling: toMajor(r.sellingPrice),
        compareAt: r.compareAtPrice ? toMajor(r.compareAtPrice) : null,
        flash: r.flashSale
          ? { flashSaleId: r.flashSale.flashSaleId, name: r.flashSale.name, endsAt: r.flashSale.endsAt, discountType: r.flashSale.discountType, discountValue: r.flashSale.discountValue, remaining: r.flashSale.remaining }
          : null,
      };
      return { id: v.id, dto };
    });
    const cheapest = [...entries].sort((a, b) => a.dto.selling - b.dto.selling || (a.id < b.id ? -1 : 1))[0]!;
    out.set(p.id, {
      currency,
      from: cheapest.dto.selling,
      to: Math.max(...entries.map((e) => e.dto.selling)),
      listFrom: cheapest.dto.list,
      compareAt: cheapest.dto.compareAt,
      flash: cheapest.dto.flash,
      variants: Object.fromEntries(entries.filter((e) => e.id).map((e) => [e.id, e.dto])),
    });
  }
  return out;
}
