/**
 * Storefront Read Model (Phase 3, docs/STOREFRONT_READ_MODEL.md) — the ONE place storefront product data is assembled:
 *
 *   database truth (Product, ProductVariant, FlashSale*, ProductVariant.stock written only by inventory.service)
 *     → canonical engines (priceProductsForDisplay → resolveUnitPrice; productAvailability)
 *     → this module: `presentStorefrontProducts` (every storefront DTO) and the ProductReadModel projection
 *     → API → Next.js storefront (formats; never recomputes)
 *
 * The projection (ProductReadModel) exists only so SQL can sort/filter/neighbour by the canonical selling price. It is
 * never authoritative and never shown: displayed prices are always computed live by the same engine. Writer: this module
 * only. It reads inventory, never writes it.
 *
 * Freshness (§3): `ensureFreshReadModels` runs before every query that reads the projection. It finds every visible
 * product whose row is missing or whose inputs changed since it was computed — the content fingerprint of its price
 * inputs differs (`SOURCE_HASH`), a clock boundary passed (`validUntil`), a quantity-limited live flash offer prices it
 * (`volatile`), or the currency / pricing version changed — and recomputes exactly those rows. The minute cron runs the
 * same guard, and a full rebuild + drift report exist for reconciliation.
 */
import { Prisma } from "@prisma/client";
import { PRICING_VERSION, productAvailability, type ProductAvailability } from "@clothing-brand/shared";
import { prisma, type Db as AppDb } from "../../config/prisma";
import { getSettings } from "../../modules/settings/settings.service";
import { priceProductsForDisplay, type PriceableProduct, type ProductPricingDto } from "../pricing/pricing.service";
import { deriveProductReadModel, type ReadModelRow } from "./read-model.derive";

type Db = AppDb;

const PROJECTION_SOURCE_SELECT = {
  id: true,
  basePrice: true,
  compareAtPrice: true,
  variants: { select: { id: true, price: true, compareAtPrice: true, isActive: true } },
  flashSaleItems: { select: { stockLimit: true, flashSale: { select: { enabled: true, startsAt: true, endsAt: true } } } },
} as const;

/**
 * The content fingerprint of everything that decides a product's selling price, as SQL over the product alias `p`:
 * base and compare-at price; each variant's id, price, compare-at and active flag; each flash-sale item's id, terms and
 * stock limit with its sale's switch and window. Stock, names, images etc. are deliberately NOT inputs (they don't
 * change the price). Used both to stamp a row and by the guard, so the two can never disagree. Content-based rather
 * than updatedAt-based: timestamps in this database are written in two different timezones (Prisma: UTC; raw SQL
 * NOW(): the session's Asia/Dhaka), and a hard delete leaves no timestamp at all.
 */
const SOURCE_HASH = Prisma.sql`md5(concat_ws('|',
  p."basePrice"::text,
  coalesce(p."compareAtPrice"::text, '-'),
  coalesce((SELECT string_agg(concat_ws(',', v.id, coalesce(v.price::text, '-'), coalesce(v."compareAtPrice"::text, '-'), v."isActive"::text), ';' ORDER BY v.id)
            FROM "ProductVariant" v WHERE v."productId" = p.id), '-'),
  coalesce((SELECT string_agg(concat_ws(',', fi.id, fi."discountType"::text, fi."discountValue"::text, coalesce(fi."stockLimit"::text, '-'),
                                        fs.enabled::text, fs."startsAt"::text, fs."endsAt"::text), ';' ORDER BY fi.id)
            FROM "FlashSaleItem" fi JOIN "FlashSale" fs ON fs.id = fi."flashSaleId" WHERE fi."productId" = p.id), '-')
))`;

async function sourceHashes(productIds: string[], db: Db): Promise<Map<string, string>> {
  const rows = await db.$queryRaw<Array<{ id: string; hash: string }>>`SELECT p.id, ${SOURCE_HASH} AS hash FROM "Product" p WHERE p.id IN (${Prisma.join(productIds)})`;
  return new Map(rows.map((r) => [r.id, r.hash]));
}

/** Rows for these products, derived from the canonical display pricing at `now`. Pure read. */
export async function computeReadModels(productIds: string[], now: Date = new Date(), db: Db = prisma): Promise<ReadModelRow[]> {
  if (!productIds.length) return [];
  // Fingerprint first: if an input changes while we price, the stored hash is the older one and the row reads as stale.
  const hashes = await sourceHashes(productIds, db);
  const products = await db.product.findMany({ where: { id: { in: productIds } }, select: PROJECTION_SOURCE_SELECT });
  const pricing = await priceProductsForDisplay(products, now, db);
  return products.map((p) =>
    deriveProductReadModel({
      productId: p.id,
      pricing: pricing.get(p.id)!,
      offers: p.flashSaleItems.map((i) => ({ enabled: i.flashSale.enabled, startsAt: i.flashSale.startsAt, endsAt: i.flashSale.endsAt, stockLimit: i.stockLimit })),
      sourceHash: hashes.get(p.id)!,
      now,
    }),
  );
}

/** Recomputes and upserts the rows for these products. Idempotent and deterministic for a given `now`. */
export async function refreshReadModels(productIds: string[], now: Date = new Date(), db: Db = prisma): Promise<number> {
  const unique = [...new Set(productIds)].sort();
  const BATCH = 200;
  let written = 0;
  for (let i = 0; i < unique.length; i += BATCH) {
    const rows = await computeReadModels(unique.slice(i, i + BATCH), now, db);
    for (const row of rows) {
      const { productId, ...data } = row;
      await db.productReadModel.upsert({ where: { productId }, create: row, update: data });
      written++;
    }
  }
  return written;
}

/** Visible (published, not trashed) products whose projection row is missing or stale at `now`. */
export async function findStaleProductIds(now: Date = new Date(), db: Db = prisma): Promise<string[]> {
  const currency = (await getSettings()).currency || "BDT";
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM "Product" p
    LEFT JOIN "ProductReadModel" r ON r."productId" = p.id
    WHERE p."isActive" = true AND p."deletedAt" IS NULL AND (
      r."productId" IS NULL
      OR r."volatile" = true
      OR (r."validUntil" IS NOT NULL AND r."validUntil" <= ${now})
      OR r."pricingVersion" <> ${PRICING_VERSION}
      OR r."currency" <> ${currency}
      OR r."sourceHash" <> ${SOURCE_HASH}
    )
    ORDER BY p.id`;
  return rows.map((r) => r.id);
}

/** The freshness guard: run before any query that sorts, filters or neighbours by the projection. A failure here is
 * logged and the query proceeds on the last projection (explicit stale-read semantics); the next call retries. */
export async function ensureFreshReadModels(now: Date = new Date(), db: Db = prisma): Promise<number> {
  try {
    const stale = await findStaleProductIds(now, db);
    return stale.length ? await refreshReadModels(stale, now, db) : 0;
  } catch (err) {
    console.error("[read-model] freshness guard failed; serving the last projection:", err);
    return 0;
  }
}

/** Full rebuild (deploy backfill, reconciliation repair): every non-trashed product, deterministic for `now`. */
export async function rebuildAllReadModels(now: Date = new Date(), db: Db = prisma): Promise<number> {
  const ids = (await db.product.findMany({ where: { deletedAt: null }, select: { id: true }, orderBy: { id: "asc" } })).map((p) => p.id);
  return refreshReadModels(ids, now, db);
}

export interface ReadModelDriftItem {
  productId: string;
  issue: "missing" | "minSellingPrice" | "maxSellingPrice" | "listPriceOfMin" | "hasLiveFlashSale";
  stored: string | null;
  expected: string;
}

/** Reconciliation report: recompute every visible product in memory and compare with what is stored. Read-only. */
export async function readModelDrift(now: Date = new Date(), db: Db = prisma): Promise<ReadModelDriftItem[]> {
  const ids = (await db.product.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true }, orderBy: { id: "asc" } })).map((p) => p.id);
  const drift: ReadModelDriftItem[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const [expected, stored] = await Promise.all([computeReadModels(batch, now, db), db.productReadModel.findMany({ where: { productId: { in: batch } } })]);
    const byId = new Map(stored.map((r) => [r.productId, r]));
    for (const e of expected) {
      const s = byId.get(e.productId);
      if (!s) {
        drift.push({ productId: e.productId, issue: "missing", stored: null, expected: String(e.minSellingPrice) });
        continue;
      }
      for (const field of ["minSellingPrice", "maxSellingPrice", "listPriceOfMin"] as const) {
        if (Number(s[field]) !== e[field]) drift.push({ productId: e.productId, issue: field, stored: String(s[field]), expected: String(e[field]) });
      }
      if (s.hasLiveFlashSale !== e.hasLiveFlashSale) drift.push({ productId: e.productId, issue: "hasLiveFlashSale", stored: String(s.hasLiveFlashSale), expected: String(e.hasLiveFlashSale) });
    }
  }
  return drift;
}

// --- Prisma query helpers: the only way storefront queries sort/filter by price ----------------------------------------

/** ORDER BY the canonical selling price (projection), ties by id — deterministic. */
export function sellingPriceOrderBy(direction: "asc" | "desc") {
  return [{ readModel: { minSellingPrice: direction } }, { id: "asc" as const }];
}

/** WHERE the canonical selling price ("from" price) is within [min, max]; {} when no bound is given. */
export function sellingPriceWhere(range: { gte?: number; lte?: number; lt?: number; gt?: number }): Prisma.ProductWhereInput {
  const bounds = Object.fromEntries(Object.entries(range).filter(([, v]) => v !== undefined));
  return Object.keys(bounds).length ? { readModel: { is: { minSellingPrice: bounds } } } : {};
}

/** A product's canonical selling price from the projection (after the guard), or null when it has none. */
export async function projectedSellingPrice(productId: string, db: Db = prisma): Promise<number | null> {
  const row = await db.productReadModel.findUnique({ where: { productId }, select: { minSellingPrice: true } });
  return row ? Number(row.minSellingPrice) : null;
}

// --- The storefront product DTO: every storefront endpoint presents products through here ----------------------------

export interface StorefrontPresentable extends PriceableProduct {
  trackInventory: boolean;
  lowStockThreshold: number;
  variants: Array<{ id: string; price: unknown; compareAtPrice?: unknown; isActive?: boolean; stock: number }>;
}

export type StorefrontProduct<T> = T & {
  pricing: ProductPricingDto;
  availability: ProductAvailability;
  activeFlashSale: {
    flashSaleId: string;
    flashSaleName: string;
    endsAt: string;
    discountType: "PERCENTAGE" | "FIXED";
    discountValue: number;
    flashPrice: string;
  } | null;
};

/** Adds the canonical `pricing` (live, from the pricing engine), `availability` (from canonical inventory state and D5)
 * and the deprecated `activeFlashSale` compat view. PDP, listings, search, suggestions, quick view, compare, cart
 * checks, recommendations and the flash-sale feed all return products through this one function. */
export async function presentStorefrontProducts<T extends StorefrontPresentable>(products: T[], now: Date = new Date()): Promise<StorefrontProduct<T>[]> {
  const pricing = await priceProductsForDisplay(products, now);
  return products.map((product) => {
    const p = pricing.get(product.id)!;
    return {
      ...product,
      pricing: p,
      availability: productAvailability({ trackInventory: product.trackInventory, lowStockThreshold: product.lowStockThreshold, variants: product.variants }),
      activeFlashSale: p.flash
        ? {
            flashSaleId: p.flash.flashSaleId,
            flashSaleName: p.flash.name,
            endsAt: p.flash.endsAt,
            discountType: p.flash.discountType,
            discountValue: p.flash.discountValue,
            flashPrice: String(p.from),
          }
        : null,
    };
  });
}
