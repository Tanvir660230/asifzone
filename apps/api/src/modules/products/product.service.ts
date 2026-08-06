import { Prisma, type BrandTier } from "@prisma/client";
import type {
  CreateProductInput,
  UpdateProductInput,
  CreateVariantInput,
  ProductListQuery,
  StorefrontProductQuery,
  StorefrontFacetsQuery,
} from "@clothing-brand/shared";
import { slugify, expandSearchTerms } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix, cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { ensureUniqueSlug } from "../../lib/unique-slug";
import { deleteProductImageFiles } from "../uploads/upload.service";
import { getCategoryBySlug, getCategoryDescendantIds, getSiblingCategoryIds } from "../categories/category.service";
import { computeFlashPrice, getActiveFlashInfoByProduct } from "../flash-sales/flash-sale-pricing";
import { notifyBackInStock } from "../stock-alerts/stock-alert.service";
import { notifyPriceDrop } from "../wishlist/wishlist.service";

const CACHE_PREFIX = "products:";
const CACHE_TTL_SECONDS = 120;
const include = {
  variants: {
    include: { attributeValues: { include: { attributeValue: { include: { attribute: true } } } } },
    orderBy: { sortOrder: "asc" as const },
  },
  images: { orderBy: { sortOrder: "asc" as const } },
  category: true,
};

/** Nested-create shape for a variant's attribute links — `attributeValueIds` isn't a real column, it drives this join table instead.
 * `sortOrder` comes from the variant's position in the submitted array: the storefront shows `variants[0]`'s color/size as the
 * default selection, so reordering variants in the admin form is how "which color is the main one" gets set. */
function toVariantCreateData(variant: CreateVariantInput, sortOrder: number) {
  const { attributeValueIds = [], ...rest } = variant;
  return {
    ...rest,
    sortOrder,
    attributeValues: { create: attributeValueIds.map((attributeValueId) => ({ attributeValueId })) },
  };
}

/** Attaches `activeFlashSale` (flash-discounted price, if any is currently running) to each product — storefront-facing reads only. */
async function withFlashSaleInfo<T extends { id: string; basePrice: unknown }>(products: T[]) {
  const flashByProduct = await getActiveFlashInfoByProduct(products.map((p) => p.id));
  return products.map((product) => {
    const flash = flashByProduct.get(product.id);
    if (!flash) return { ...product, activeFlashSale: null };
    return {
      ...product,
      activeFlashSale: {
        flashSaleId: flash.flashSaleId,
        flashSaleName: flash.flashSaleName,
        endsAt: flash.endsAt,
        discountType: flash.discountType,
        discountValue: flash.discountValue,
        flashPrice: computeFlashPrice(Number(product.basePrice), flash),
      },
    };
  });
}

async function invalidateCache() {
  await cacheDelByPrefix(CACHE_PREFIX);
}

const SORT_ORDER_BY: Record<string, object> = {
  newest: { createdAt: "desc" },
  price_asc: { basePrice: "asc" },
  price_desc: { basePrice: "desc" },
};

const TYPO_FALLBACK_THRESHOLD = 3;
const TYPO_SIMILARITY_THRESHOLD = 0.3;

/** Multi-field OR filter across every expanded search term (original query + any known
 * synonyms) — name, description, brand, and category name, unlike the old name-only match. */
function buildFieldSearchOr(terms: string[]) {
  return {
    OR: terms.flatMap((term) => [
      { name: { contains: term, mode: "insensitive" as const } },
      { description: { contains: term, mode: "insensitive" as const } },
      { brand: { contains: term, mode: "insensitive" as const } },
      { category: { name: { contains: term, mode: "insensitive" as const } } },
    ]),
  };
}

/** "Did you mean" typo tolerance via pg_trgm's word_similarity, for when exact/synonym
 * matching comes up short — catches e.g. "panjabee" -> "panjabi". Scoped to active products
 * (and category, if given); intentionally doesn't also honor price/size/color facet
 * filters, since this is a fallback safety net, not a full facet-aware query path. */
async function findTypoTolerantProductIds(query: string, categoryIds: string[] | undefined, limit: number) {
  const rows =
    categoryIds && categoryIds.length > 0
      ? await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Product"
          WHERE "isActive" = true AND "deletedAt" IS NULL
            AND "categoryId" IN (${Prisma.join(categoryIds)})
            AND word_similarity(${query}, name) > ${TYPO_SIMILARITY_THRESHOLD}
          ORDER BY word_similarity(${query}, name) DESC
          LIMIT ${limit}
        `
      : await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Product"
          WHERE "isActive" = true AND "deletedAt" IS NULL
            AND word_similarity(${query}, name) > ${TYPO_SIMILARITY_THRESHOLD}
          ORDER BY word_similarity(${query}, name) DESC
          LIMIT ${limit}
        `;
  return rows.map((r) => r.id);
}

/** Fire-and-forget — a real search-page visit, not typeahead. Never allowed to break search. */
async function logSearch(query: string, resultCount: number) {
  try {
    await prisma.searchLog.create({ data: { query: query.trim().toLowerCase(), resultCount } });
  } catch {
    // logging is best-effort only
  }
}

export async function listProducts(query: ProductListQuery) {
  const where = {
    deletedAt: query.trashed ? { not: null } : null,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.search
      ? { name: { contains: query.search, mode: "insensitive" as const } }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getProductById(id: string) {
  const product = await prisma.product.findUnique({ where: { id }, include });
  if (!product) throw AppError.notFound("Product not found");
  return product;
}

/** Public lookup: only returns active products, matching what the storefront should link to. */
export async function getProductBySlug(slug: string) {
  const cacheKey = `${CACHE_PREFIX}slug:${slug}`;
  let product = await cacheGet<Awaited<ReturnType<typeof getProductById>>>(cacheKey);

  if (!product) {
    product = await prisma.product.findUnique({ where: { slug }, include });
    if (!product || !product.isActive || product.deletedAt) throw AppError.notFound("Product not found");
    await cacheSet(cacheKey, product, CACHE_TTL_SECONDS);
  }

  const [withFlash] = await withFlashSaleInfo([product]);
  return withFlash;
}

/** Storefront browsing: active products only, optionally scoped to a category (and its subcategories), searched, sorted. */
export async function listStorefrontProducts(query: StorefrontProductQuery) {
  let categoryIds: string[] | undefined;
  if (query.category) {
    const category = await getCategoryBySlug(query.category);
    categoryIds = await getCategoryDescendantIds(category.id);
  }

  const searchTerms = query.search ? expandSearchTerms(query.search) : [];

  const where = {
    isActive: true,
    deletedAt: null,
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(query.featured ? { isFeatured: true } : {}),
    ...(searchTerms.length ? buildFieldSearchOr(searchTerms) : {}),
    ...(query.sizes?.length ? { variants: { some: { size: { in: query.sizes } } } } : {}),
    ...(query.colors?.length ? { variants: { some: { color: { in: query.colors } } } } : {}),
    ...(query.minPrice !== undefined || query.maxPrice !== undefined
      ? {
          basePrice: {
            ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
            ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
          },
        }
      : {}),
  };

  const [rawItems, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include,
      orderBy: SORT_ORDER_BY[query.sort],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  let items = await withFlashSaleInfo(rawItems);
  let resultTotal = total;

  // Typo-tolerant fallback — only worth trying on page 1 of an actual search that came up short.
  if (query.search && query.page === 1 && total < TYPO_FALLBACK_THRESHOLD) {
    const fallbackIds = await findTypoTolerantProductIds(query.search, categoryIds, query.pageSize);
    const newIds = fallbackIds.filter((id) => !items.some((item) => item.id === id));

    if (newIds.length > 0) {
      const fallbackRaw = await prisma.product.findMany({
        where: { id: { in: newIds }, isActive: true, deletedAt: null },
        include,
      });
      const fallbackItems = await withFlashSaleInfo(fallbackRaw);
      const byId = new Map(fallbackItems.map((p) => [p.id, p]));
      const orderedFallback = newIds.map((id) => byId.get(id)).filter((p): p is (typeof fallbackItems)[number] => Boolean(p));

      items = [...items, ...orderedFallback].slice(0, query.pageSize);
      resultTotal = total + orderedFallback.length;
    }
  }

  if (query.search) {
    void logSearch(query.search, resultTotal);
  }

  return { items, total: resultTotal, page: query.page, pageSize: query.pageSize };
}

/** Available filter options (sizes/colors/price range) for the storefront's currently-scoped product set — recomputed per category/search so the panel never offers a facet with zero results. */
export async function getStorefrontFacets(query: StorefrontFacetsQuery) {
  let categoryIds: string[] | undefined;
  if (query.category) {
    const category = await getCategoryBySlug(query.category);
    categoryIds = await getCategoryDescendantIds(category.id);
  }

  const facetSearchTerms = query.search ? expandSearchTerms(query.search) : [];

  const where = {
    isActive: true,
    deletedAt: null,
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(facetSearchTerms.length ? buildFieldSearchOr(facetSearchTerms) : {}),
  };

  const [sizes, colors, priceRange] = await Promise.all([
    prisma.productVariant.findMany({
      where: { product: where },
      distinct: ["size"],
      select: { size: true },
    }),
    prisma.productVariant.findMany({
      where: { product: where },
      distinct: ["color"],
      select: { color: true, colorHex: true },
    }),
    prisma.product.aggregate({ where, _min: { basePrice: true }, _max: { basePrice: true } }),
  ]);

  return {
    sizes: sizes.map((s) => s.size).sort(),
    colors: colors.map((c) => ({ color: c.color, colorHex: c.colorHex })).sort((a, b) => a.color.localeCompare(b.color)),
    minPrice: priceRange._min.basePrice ? Number(priceRange._min.basePrice) : 0,
    maxPrice: priceRange._max.basePrice ? Number(priceRange._max.basePrice) : 0,
  };
}

const SUGGEST_SELECT = {
  id: true,
  name: true,
  slug: true,
  basePrice: true,
  images: { orderBy: { sortOrder: "asc" as const }, take: 1, select: { url: true } },
};

function toSuggestionProduct(p: {
  id: string;
  name: string;
  slug: string;
  basePrice: unknown;
  images: { url: string }[];
}) {
  return { id: p.id, name: p.name, slug: p.slug, price: Number(p.basePrice), imageUrl: p.images[0]?.url ?? null };
}

/** Typeahead dropdown data: a handful of matching products plus "prediction" query-completion
 * strings drawn from product names, category names, and past popular searches. Never logged —
 * only a real search-page navigation (via listStorefrontProducts) counts as a real search. */
export async function suggestSearch(query: string, limit = 6) {
  const searchTerms = expandSearchTerms(query);
  if (searchTerms.length === 0) return { products: [], predictions: [] };

  let productRows = await prisma.product.findMany({
    where: { isActive: true, deletedAt: null, ...buildFieldSearchOr(searchTerms) },
    select: SUGGEST_SELECT,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (productRows.length < TYPO_FALLBACK_THRESHOLD) {
    const fallbackIds = await findTypoTolerantProductIds(query, undefined, limit);
    const newIds = fallbackIds.filter((id) => !productRows.some((p) => p.id === id));

    if (newIds.length > 0) {
      const fallbackRows = await prisma.product.findMany({
        where: { id: { in: newIds }, isActive: true, deletedAt: null },
        select: SUGGEST_SELECT,
      });
      productRows = [...productRows, ...fallbackRows].slice(0, limit);
    }
  }

  const lowerQuery = query.trim().toLowerCase();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [productNameMatches, categoryNameMatches, popularQueryMatches] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true, deletedAt: null, name: { contains: lowerQuery, mode: "insensitive" } },
      distinct: ["name"],
      select: { name: true },
      take: limit,
    }),
    prisma.category.findMany({
      where: { isActive: true, name: { contains: lowerQuery, mode: "insensitive" } },
      distinct: ["name"],
      select: { name: true },
      take: limit,
    }),
    prisma.searchLog.findMany({
      where: { query: { contains: lowerQuery, mode: "insensitive" }, createdAt: { gte: since } },
      distinct: ["query"],
      select: { query: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  const predictions = [
    ...new Set([
      ...productNameMatches.map((p) => p.name),
      ...categoryNameMatches.map((c) => c.name),
      ...popularQueryMatches.map((s) => s.query),
    ]),
  ].slice(0, limit);

  return { products: productRows.map(toSuggestionProduct), predictions };
}

const POPULAR_SEARCHES_CACHE_KEY = `${CACHE_PREFIX}popular-searches`;
const POPULAR_SEARCHES_TTL_SECONDS = 600;
const POPULAR_SEARCHES_LOOKBACK_DAYS = 30;

/** Top real search queries in the last 30 days, Redis-cached — one cache entry serves every
 * `limit` request since filtering to `limit` happens after the cached list is loaded. */
export async function getPopularSearches(limit = 8) {
  const cached = await cacheGet<string[]>(POPULAR_SEARCHES_CACHE_KEY);
  if (cached) return cached.slice(0, limit);

  const since = new Date(Date.now() - POPULAR_SEARCHES_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<Array<{ query: string; count: bigint }>>`
    SELECT lower(query) AS query, COUNT(*)::bigint AS count
    FROM "SearchLog"
    WHERE "createdAt" >= ${since}
    GROUP BY lower(query)
    ORDER BY count DESC
    LIMIT 50
  `;

  const popular = rows.map((r) => r.query);
  await cacheSet(POPULAR_SEARCHES_CACHE_KEY, popular, POPULAR_SEARCHES_TTL_SECONDS);
  return popular.slice(0, limit);
}

/** Fetches active products by id, preserving the requested order — used to hydrate a client-side
 * id list (e.g. the visitor's locally-stored "recently viewed") into full product records. */
export async function getProductsByIds(ids: string[]) {
  if (!ids.length) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, isActive: true, deletedAt: null },
    include,
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const ordered = ids.map((id) => byId.get(id)).filter((p): p is (typeof products)[number] => Boolean(p));
  return withFlashSaleInfo(ordered);
}

/** Same category, ranked by price-proximity to the target product — a lightweight stand-in for a
 * real similarity model that still gives a sensibly ordered result from data we actually have. */
export async function getSimilarProducts(productId: string, limit = 8) {
  const target = await prisma.product.findUnique({ where: { id: productId }, select: { categoryId: true, basePrice: true } });
  if (!target) return [];

  const candidates = await prisma.product.findMany({
    where: { categoryId: target.categoryId, isActive: true, deletedAt: null, id: { not: productId } },
    include,
  });

  const targetPrice = Number(target.basePrice);
  candidates.sort(
    (a, b) => Math.abs(Number(a.basePrice) - targetPrice) - Math.abs(Number(b.basePrice) - targetPrice),
  );

  return withFlashSaleInfo(candidates.slice(0, limit));
}

/** Products actually co-purchased with this one, ranked by how often they appear in the same order.
 * Redis-cached (raw product rows, like getProductBySlug) since the aggregation touches every order
 * containing the product. */
export async function getFrequentlyBoughtTogether(productId: string, limit = 4) {
  const cacheKey = `${CACHE_PREFIX}fbt:${productId}`;
  let ranked = await cacheGet<Awaited<ReturnType<typeof prisma.product.findMany>>>(cacheKey);

  if (!ranked) {
    const variantIds = (await prisma.productVariant.findMany({ where: { productId }, select: { id: true } })).map(
      (v) => v.id,
    );

    const orderIds = variantIds.length
      ? [
          ...new Set(
            (
              await prisma.orderItem.findMany({
                where: { variantId: { in: variantIds }, order: { status: { notIn: ["CANCELLED", "REFUNDED"] } } },
                select: { orderId: true },
              })
            ).map((i) => i.orderId),
          ),
        ]
      : [];

    const otherItems = orderIds.length
      ? await prisma.orderItem.findMany({
          where: { orderId: { in: orderIds }, variantId: { notIn: variantIds } },
          select: { variantId: true },
        })
      : [];

    if (otherItems.length === 0) {
      ranked = [];
    } else {
      const otherVariantIds = [...new Set(otherItems.map((i) => i.variantId))];
      const variantToProduct = new Map(
        (await prisma.productVariant.findMany({ where: { id: { in: otherVariantIds } }, select: { id: true, productId: true } })).map(
          (v) => [v.id, v.productId],
        ),
      );

      const counts = new Map<string, number>();
      for (const item of otherItems) {
        const pid = variantToProduct.get(item.variantId);
        if (!pid) continue;
        counts.set(pid, (counts.get(pid) ?? 0) + 1);
      }

      const rankedIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
      const products = await prisma.product.findMany({
        where: { id: { in: rankedIds }, isActive: true, deletedAt: null },
        include,
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      ranked = rankedIds.map((id) => byId.get(id)).filter((p): p is (typeof products)[number] => Boolean(p));
    }

    await cacheSet(cacheKey, ranked, 3600);
  }

  return withFlashSaleInfo(ranked.slice(0, limit));
}

const TRENDING_CACHE_KEY = `${CACHE_PREFIX}trending`;
const TRENDING_LOOKBACK_DAYS = 30;
const TRENDING_POOL_SIZE = 50;

/** Recent sales velocity (last 30 days), optionally scoped to a price range — one cached pool serves
 * every budget query since the price filter is applied after loading, not baked into the cache key. */
export async function getTrendingProducts({
  minPrice,
  maxPrice,
  limit = 8,
}: {
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
}) {
  let pool = await cacheGet<Awaited<ReturnType<typeof prisma.product.findMany>>>(TRENDING_CACHE_KEY);

  if (!pool) {
    const since = new Date(Date.now() - TRENDING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const items = await prisma.orderItem.findMany({
      where: { order: { status: { notIn: ["CANCELLED", "REFUNDED"] }, createdAt: { gte: since } } },
      select: { variantId: true, quantity: true },
    });

    if (items.length === 0) {
      pool = [];
    } else {
      const variantIds = [...new Set(items.map((i) => i.variantId))];
      const variantToProduct = new Map(
        (await prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, productId: true } })).map(
          (v) => [v.id, v.productId],
        ),
      );

      const totals = new Map<string, number>();
      for (const item of items) {
        const pid = variantToProduct.get(item.variantId);
        if (!pid) continue;
        totals.set(pid, (totals.get(pid) ?? 0) + item.quantity);
      }

      const rankedIds = [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id)
        .slice(0, TRENDING_POOL_SIZE);
      const products = await prisma.product.findMany({
        where: { id: { in: rankedIds }, isActive: true, deletedAt: null },
        include,
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      pool = rankedIds.map((id) => byId.get(id)).filter((p): p is (typeof products)[number] => Boolean(p));
    }

    await cacheSet(TRENDING_CACHE_KEY, pool, 900);
  }

  const filtered = pool.filter((p) => {
    const price = Number(p.basePrice);
    if (minPrice !== undefined && price < minPrice) return false;
    if (maxPrice !== undefined && price > maxPrice) return false;
    return true;
  });

  return withFlashSaleInfo(filtered.slice(0, limit));
}

/** Plain category-scoped pick (newest/featured first) — used both for "Recommended For You" (fed the
 * visitor's recently-viewed categories) and "Complete Your Look" (fed sibling categories). */
export async function getRecommendedByCategories(
  categoryIds: string[],
  { exclude, limit = 8 }: { exclude?: string; limit?: number },
) {
  const items = await prisma.product.findMany({
    where: {
      categoryId: { in: categoryIds },
      isActive: true,
      deletedAt: null,
      ...(exclude ? { id: { not: exclude } } : {}),
    },
    include,
    orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return withFlashSaleInfo(items);
}

/** Products from sibling categories (same parent) — e.g. a Shirt pairs with Trousers/Blazers under
 * "Menswear", not with other Shirts. Empty for a top-level-only category with no siblings. */
export async function getCompleteYourLook(productId: string, limit = 8) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { categoryId: true } });
  if (!product) return [];

  const siblingIds = await getSiblingCategoryIds(product.categoryId);
  if (!siblingIds.length) return [];

  return getRecommendedByCategories(siblingIds, { exclude: productId, limit });
}

const BRAND_TIER_RANK: Record<BrandTier, number> = { PREMIUM: 0, PLATINUM: 1, LUXURY: 2 };

async function getTargetProductContext(productId: string) {
  return prisma.product.findUnique({
    where: { id: productId },
    select: { categoryId: true, basePrice: true, brandTier: true },
  });
}

/** Same category, priced lower than the current product — nearest-cheaper first. */
export async function getBudgetAlternatives(productId: string, limit = 8) {
  const target = await getTargetProductContext(productId);
  if (!target) return [];

  const items = await prisma.product.findMany({
    where: {
      categoryId: target.categoryId,
      isActive: true,
      deletedAt: null,
      id: { not: productId },
      basePrice: { lt: target.basePrice },
    },
    include,
    orderBy: { basePrice: "desc" },
    take: limit,
  });

  return withFlashSaleInfo(items);
}

/** Same category, priced higher than the current product — nearest-pricier first ("step up"). */
export async function getUpgradeOptions(productId: string, limit = 8) {
  const target = await getTargetProductContext(productId);
  if (!target) return [];

  const items = await prisma.product.findMany({
    where: {
      categoryId: target.categoryId,
      isActive: true,
      deletedAt: null,
      id: { not: productId },
      basePrice: { gt: target.basePrice },
    },
    include,
    orderBy: { basePrice: "asc" },
    take: limit,
  });

  return withFlashSaleInfo(items);
}

/** Same category, strictly higher brand tier than the current product (e.g. PREMIUM -> PLATINUM/LUXURY).
 * Tier-based rather than price-based, so it's a distinct signal from getUpgradeOptions. Empty for
 * a product that's already top-tier. */
export async function getPremiumAlternatives(productId: string, limit = 8) {
  const target = await getTargetProductContext(productId);
  if (!target) return [];

  const higherTiers = (Object.keys(BRAND_TIER_RANK) as BrandTier[]).filter(
    (tier) => BRAND_TIER_RANK[tier] > BRAND_TIER_RANK[target.brandTier],
  );
  if (higherTiers.length === 0) return [];

  const items = await prisma.product.findMany({
    where: {
      categoryId: target.categoryId,
      isActive: true,
      deletedAt: null,
      id: { not: productId },
      brandTier: { in: higherTiers },
    },
    include,
    orderBy: { basePrice: "desc" },
    take: limit,
  });

  return withFlashSaleInfo(items);
}

/** Fire-and-forget — records an anonymous, aggregate-only storefront page view. Never tied
 * to a session or customer; a logging failure must never break the page. */
export async function logProductView(productId: string) {
  try {
    await prisma.productViewLog.create({ data: { productId } });
  } catch {
    // best-effort only
  }
}

const URGENCY_CACHE_TTL_SECONDS = 60;

/** Every field here is a real, currently-true count (or null/0/false) — never fabricated.
 * Redis-cached briefly since it's read on every PDP load but only needs to feel "recent". */
export async function getUrgencySignals(productId: string) {
  const cacheKey = `${CACHE_PREFIX}urgency:${productId}`;
  const cached = await cacheGet<{
    viewsToday: number;
    recentPurchaseCount: number;
    lastPurchasedAt: string | null;
    unitsSoldLast7Days: number;
    isFastSelling: boolean;
  }>(cacheKey);
  if (cached) return cached;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const variantIds = (await prisma.productVariant.findMany({ where: { productId }, select: { id: true } })).map(
    (v) => v.id,
  );

  const [viewsToday, weekOrderItems, stockAgg] = await Promise.all([
    prisma.productViewLog.count({ where: { productId, createdAt: { gte: since24h } } }),
    variantIds.length
      ? prisma.orderItem.findMany({
          where: {
            variantId: { in: variantIds },
            order: { status: { notIn: ["CANCELLED", "REFUNDED"] }, createdAt: { gte: since7d } },
          },
          select: { quantity: true, order: { select: { createdAt: true } } },
        })
      : [],
    prisma.productVariant.aggregate({ where: { productId }, _sum: { stock: true } }),
  ]);

  const unitsSoldLast7Days = weekOrderItems.reduce((sum, i) => sum + i.quantity, 0);
  const recentPurchaseCount = weekOrderItems
    .filter((i) => i.order.createdAt >= since24h)
    .reduce((sum, i) => sum + i.quantity, 0);
  const lastPurchasedAt = weekOrderItems.length
    ? weekOrderItems.reduce(
        (latest, i) => (i.order.createdAt > latest ? i.order.createdAt : latest),
        weekOrderItems[0]!.order.createdAt,
      )
    : null;
  const stock = stockAgg._sum.stock ?? 0;
  const isFastSelling = stock > 0 && unitsSoldLast7Days >= stock;

  const signals = {
    viewsToday,
    recentPurchaseCount,
    lastPurchasedAt: lastPurchasedAt?.toISOString() ?? null,
    unitsSoldLast7Days,
    isFastSelling,
  };

  await cacheSet(cacheKey, signals, URGENCY_CACHE_TTL_SECONDS);
  return signals;
}

export async function createProduct(input: CreateProductInput) {
  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!category) throw AppError.badRequest("Category does not exist");

  const skus = input.variants.map((v) => v.sku);
  if (new Set(skus).size !== skus.length) throw AppError.badRequest("Duplicate SKU in variants");

  const baseSlug = slugify(input.slug || input.name);
  const slug = await ensureUniqueSlug(baseSlug, async (candidate) => {
    return Boolean(await prisma.product.findUnique({ where: { slug: candidate } }));
  });

  const { variants, ...productData } = input;

  const product = await prisma.product.create({
    data: {
      ...productData,
      slug,
      variants: { create: variants.map((v, i) => toVariantCreateData(v, i)) },
    },
    include,
  });

  await invalidateCache();
  return product;
}

export async function updateProduct(id: string, input: UpdateProductInput) {
  const existing = await getProductById(id);

  const data: Record<string, unknown> = { ...input };
  delete data.variants;

  if (input.name && !input.slug) {
    data.slug = await ensureUniqueSlug(slugify(input.name), async (candidate) => {
      return Boolean(await prisma.product.findFirst({ where: { slug: candidate, NOT: { id } } }));
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data });

    if (input.variants) {
      const incomingIds = new Set(input.variants.filter((v) => v.id).map((v) => v.id!));
      const toDelete = existing.variants.filter((v) => !incomingIds.has(v.id));

      if (toDelete.length) {
        const deletableIds = toDelete.map((v) => v.id);
        const referenced = await tx.orderItem.findMany({
          where: { variantId: { in: deletableIds } },
          select: { variantId: true },
          distinct: ["variantId"],
        });
        const referencedIds = new Set(referenced.map((r) => r.variantId));
        const safeToDelete = deletableIds.filter((vid) => !referencedIds.has(vid));
        const mustKeep = deletableIds.filter((vid) => referencedIds.has(vid));

        if (safeToDelete.length) {
          await tx.productVariant.deleteMany({ where: { id: { in: safeToDelete } } });
        }
        // A variant with real order history can't be hard-deleted — StockMovement cascades on
        // variant delete, and OrderItem.variantId has no FK to fall back on, so deleting it would
        // silently erase that order's stock audit trail. Zero its stock instead: it drops out of
        // checkout the same as a delete would, without destroying history.
        if (mustKeep.length) {
          await tx.productVariant.updateMany({ where: { id: { in: mustKeep } }, data: { stock: 0 } });
        }
      }

      for (const [index, variant] of input.variants.entries()) {
        if (variant.id) {
          const { id: variantId, attributeValueIds = [], ...updateData } = variant;
          await tx.productVariant.update({ where: { id: variantId }, data: { ...updateData, sortOrder: index } });
          await tx.variantAttributeValue.deleteMany({ where: { variantId } });
          if (attributeValueIds.length) {
            await tx.variantAttributeValue.createMany({
              data: attributeValueIds.map((attributeValueId) => ({ variantId, attributeValueId })),
            });
          }
        } else {
          await tx.productVariant.create({ data: { ...toVariantCreateData(variant, index), productId: id } });
        }
      }
    }
  });

  await invalidateCache();

  // Fire-and-forget: real stock/price changes trigger real customer notifications — never
  // allowed to block or fail the admin's product save.
  if (input.variants) {
    for (const variant of input.variants) {
      if (!variant.id) continue;
      const before = existing.variants.find((v) => v.id === variant.id);
      if (before && before.stock === 0 && variant.stock > 0) {
        notifyBackInStock(variant.id).catch((err) => console.error("[stock-alert] notify failed:", err));
      }
    }
  }
  if (input.basePrice !== undefined && input.basePrice < Number(existing.basePrice)) {
    notifyPriceDrop(id, input.basePrice).catch((err) => console.error("[price-drop] notify failed:", err));
  }

  return getProductById(id);
}

/** Soft delete — moves the product to Trash instead of destroying it, so wishlist/flash-sale
 * associations and image files survive an accidental click. Use `permanentlyDeleteProduct` to purge. */
export async function deleteProduct(id: string) {
  await getProductById(id);
  await prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
  await invalidateCache();
}

export async function restoreProduct(id: string) {
  await getProductById(id);
  await prisma.product.update({ where: { id }, data: { deletedAt: null } });
  await invalidateCache();
  return getProductById(id);
}

/** Irreversible — only meaningful for a product already in Trash. */
export async function permanentlyDeleteProduct(id: string) {
  const product = await getProductById(id);
  if (!product.deletedAt) throw AppError.badRequest("Move the product to Trash before deleting it permanently");
  await prisma.product.delete({ where: { id } });
  await Promise.all(product.images.map((img) => deleteProductImageFiles(img.url)));
  await invalidateCache();
}

export async function bulkDeleteProducts(ids: string[]) {
  await prisma.product.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
  await invalidateCache();
}

export async function bulkUpdateProductStatus(ids: string[], isActive: boolean) {
  await prisma.product.updateMany({ where: { id: { in: ids } }, data: { isActive } });
  await invalidateCache();
}

export async function bulkUpdateProductCategory(ids: string[], categoryId: string) {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) throw AppError.badRequest("Category does not exist");
  await prisma.product.updateMany({ where: { id: { in: ids } }, data: { categoryId } });
  await invalidateCache();
}

function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Product-level summary export (one row per product, not per variant) — stock is the sum across variants. */
export async function exportProductsCsv(): Promise<string> {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    include: { category: true, variants: true },
    orderBy: { createdAt: "desc" },
  });

  const header = [
    "id",
    "name",
    "slug",
    "category",
    "brand",
    "basePrice",
    "compareAtPrice",
    "costPrice",
    "totalStock",
    "variantCount",
    "isActive",
    "isFeatured",
    "createdAt",
  ];

  const rows = products.map((p) =>
    [
      p.id,
      p.name,
      p.slug,
      p.category.name,
      p.brand ?? "",
      p.basePrice,
      p.compareAtPrice ?? "",
      p.costPrice ?? "",
      p.variants.reduce((sum, v) => sum + v.stock, 0),
      p.variants.length,
      p.isActive,
      p.isFeatured,
      p.createdAt.toISOString(),
    ]
      .map(csvCell)
      .join(","),
  );

  return [header.join(","), ...rows].join("\n");
}

export async function addProductImages(productId: string, images: Array<{ url: string; altText?: string }>) {
  await getProductById(productId);
  const existingCount = await prisma.productImage.count({ where: { productId } });

  await prisma.productImage.createMany({
    data: images.map((img, i) => ({ ...img, productId, sortOrder: existingCount + i })),
  });
  await invalidateCache();
  return getProductById(productId);
}

export async function deleteProductImage(productId: string, imageId: string) {
  const image = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (!image || image.productId !== productId) throw AppError.notFound("Image not found");
  await prisma.productImage.delete({ where: { id: imageId } });
  await deleteProductImageFiles(image.url);
  await invalidateCache();
}

export async function updateProductImageAltText(productId: string, imageId: string, altText: string) {
  const image = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (!image || image.productId !== productId) throw AppError.notFound("Image not found");
  await prisma.productImage.update({ where: { id: imageId }, data: { altText } });
  await invalidateCache();
}

/** Reorders a product's images to match `imageIds` — index 0 becomes the main/featured image
 * (everywhere else in the app just reads `images[0]` for that). Also doubles as "set as main":
 * the caller moves one id to the front of the array and passes the whole thing. */
export async function reorderProductImages(productId: string, imageIds: string[]) {
  const images = await prisma.productImage.findMany({ where: { productId }, select: { id: true } });
  const existingIds = new Set(images.map((img) => img.id));
  if (imageIds.length !== existingIds.size || imageIds.some((id) => !existingIds.has(id))) {
    throw AppError.badRequest("imageIds must match this product's existing images exactly");
  }

  await prisma.$transaction(
    imageIds.map((id, sortOrder) => prisma.productImage.update({ where: { id }, data: { sortOrder } })),
  );
  await invalidateCache();
  return getProductById(productId);
}
