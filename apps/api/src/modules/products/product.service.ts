import { Prisma, type BrandTier } from "@prisma/client";
import type {
  CreateProductInput,
  UpdateProductInput,
  CreateVariantInput,
  ProductListQuery,
  StorefrontProductQuery,
  StorefrontFacetsQuery,
} from "@clothing-brand/shared";
import {
  slugify,
  expandSearchTerms,
  findClosestVocabularyTerm,
  computeCompleteness,
  describeBlockers,
  isBlankAttributeValue,
  resolveSections,
  validateProductAgainstConfig,
  type ProductRelationsInput,
  type ResolvedSection,
  NO_SIZE_VALUE,
  type AttributeDataType,
  type CompletenessResult,
  type ProductResolvedView,
  type ProductStatus,
  type ResolvedAttributeField,
  type ResolvedTypeConfig,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { ensureUniqueSlug } from "../../lib/unique-slug";
import { deleteProductImageFiles } from "../uploads/upload.service";
import { getCategoryBySlug, getCategoryDescendantIds, getSiblingCategoryIds } from "../categories/category.service";
import { computeFlashPrice, getActiveFlashInfoByProduct } from "../flash-sales/flash-sale-pricing";
import { notifyBackInStock } from "../stock-alerts/stock-alert.service";
import { notifyPriceDrop } from "../wishlist/wishlist.service";
import { getTypeByKey, getTypeWithTemplate } from "../catalog/catalog.service";
import {
  TYPE_INCLUDE,
  buildCareView,
  buildResolvedView,
  fromStoredRow,
  presentAttributes,
  toResolvedTypeConfig,
  toStoredColumns,
  type TypeWithTemplate,
} from "../catalog/catalog.presenter";
import { recordAudit } from "../../lib/audit";
import { layerFromRows, loadGlobalRows, overridesFromRows, saveProductSections, type SectionRow } from "../catalog/sections.service";
import { PRODUCT_CACHE_PREFIX, invalidateProductCache } from "./product.cache";
import { diffProduct, type AuditSnapshot } from "./product-audit";

const CACHE_PREFIX = PRODUCT_CACHE_PREFIX;
const CACHE_TTL_SECONDS = 120;
const include = {
  variants: {
    include: {
      attributeValues: { include: { attributeValue: { include: { attribute: true } } } },
      images: { orderBy: { sortOrder: "asc" as const } },
    },
    orderBy: { sortOrder: "asc" as const },
  },
  images: { orderBy: { sortOrder: "asc" as const } },
  category: true,
};

/** Used in place of `include` on every storefront-facing (unauthenticated) product read — every
 * Product scalar except `costPrice`/`taxRate`, which are internal-only figures (margin, tax
 * remittance) with no storefront UI consumer. Unlike `lowStockThreshold`/`restockDate`, which the
 * storefront genuinely renders ("only 2 left", "back in stock on ..."), those two stay excluded.
 * Admin reads (listProducts/getProductById/create/update) keep using plain `include` — the
 * dashboard needs the real figures. (Prisma's `omit` API would be a lighter-weight way to express
 * this exclusion, but it requires an unstable/preview client feature this project doesn't enable;
 * an explicit `select` has the same effect with zero extra risk.) */
const PUBLIC_PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  shortDescription: true,
  sortOrder: true,
  categoryId: true,
  productType: true,
  attributes: true,
  brand: true,
  brandTier: true,
  basePrice: true,
  compareAtPrice: true,
  trackInventory: true,
  lowStockThreshold: true,
  restockDate: true,
  isActive: true,
  isFeatured: true,
  seoTitle: true,
  seoDescription: true,
  deletedAt: true,
  avgRating: true,
  reviewCount: true,
  createdAt: true,
  updatedAt: true,
  ...include,
  // The storefront never sees an inactive variant (the admin reads use `include` and see them all).
  variants: { ...include.variants, where: { isActive: true } },
} as const;

/** The shape returned by every query above that uses PUBLIC_PRODUCT_SELECT — distinct from (and
 * narrower than) the admin `include`-based Product type, so cache typing for storefront reads
 * needs this instead of `Awaited<ReturnType<typeof getProductById>>`. */
type PublicProduct = Prisma.ProductGetPayload<{ select: typeof PUBLIC_PRODUCT_SELECT }>;

/** Detail reads (admin editor, storefront product page) also need the typed attribute values and the
 * product's type with its template. List reads deliberately don't load them — a page of 20 cards has no
 * use for spec groups, and the extra joins would multiply. */
const publicDetailRelations = {
  attributeValues: { include: { definition: { select: { key: true, dataType: true } } } },
  type: { include: TYPE_INCLUDE },
  carePreset: { select: { name: true, steps: true } },
  materials: { include: { material: { select: { name: true } } }, orderBy: { sortOrder: "asc" as const } },
  sections: true,
  faqs: { orderBy: { sortOrder: "asc" as const } },
} as const;
// The hand-picked lists are only needed to edit them; the storefront fetches each list through /rail/:key.
// Not `as const`: Prisma wants a mutable array here.
const relationOrder: Prisma.ProductRelationOrderByWithRelationInput[] = [{ kind: "asc" }, { sortOrder: "asc" }];
const detailRelations = {
  ...publicDetailRelations,
  relations: { orderBy: relationOrder, include: { related: { select: { id: true, name: true } } } },
} as const;
const detailInclude = { ...include, ...detailRelations };
// What the product page itself needs beyond the shared public select: status-independent SEO overrides and
// the type/care/material relations (internal SEO fields like the focus keyword stay admin-only).
const PUBLIC_DETAIL_SELECT = {
  ...PUBLIC_PRODUCT_SELECT,
  typeId: true,
  status: true, // the admin preview labels drafts; on the public read it is always PUBLISHED
  ogTitle: true,
  ogDescription: true,
  ogImageUrl: true,
  canonicalUrl: true,
  careOverride: true,
  ...publicDetailRelations,
} as const;

type PresentableRow = {
  attributes: unknown;
  attributeValues: Parameters<typeof presentAttributes>[0]["attributeValues"];
  type: TypeWithTemplate | null;
  typeId: string | null;
  productType: string;
  careOverride?: unknown;
  carePreset: { name: string; steps: unknown } | null;
  materials: { materialId: string | null; customName: string | null; percentage: { toString(): string } | number | null; material: { name: string } | null }[];
  sections?: SectionRow[];
  faqs?: { question: string; answer: string }[];
  relations?: { kind: string; relatedId: string; related?: { id: string; name: string } }[];
};
type Presented<T> = Omit<T, "attributeValues" | "type" | "attributes" | "typeId" | "carePreset" | "materials" | "sections" | "faqs" | "relations"> & {
  typeId: string | null;
  attributes: Record<string, unknown>;
  materials: { materialId: string | null; customName: string | null; percentage: number | null }[];
  resolved: ProductResolvedView;
};

/** Rows written before typeId existed (or by direct inserts) have no type row: resolve it by the legacy enum key. */
async function typeForRow(row: Pick<PresentableRow, "type" | "productType">): Promise<TypeWithTemplate | null> {
  return row.type ?? (await getTypeByKey(row.productType));
}

/** Turns a raw detail row into what clients receive: `attributes` as one flat map (typed rows + legacy
 * remainder), the editable `materials` list, and a `resolved` view (spec groups, size guide, care, materials,
 * variant dimensions) computed from the template. Also hands back the resolved type config for callers that
 * need to score the product against it. */
async function presentWithConfig<T extends PresentableRow>(
  row: T,
): Promise<{ presented: Presented<T>; config: ResolvedTypeConfig | null; admin: AdminExtras }> {
  const type = await typeForRow(row);
  const config = type ? toResolvedTypeConfig(type) : null;
  const attributes = presentAttributes(row, config?.fields ?? []);
  const materials = row.materials.map((m) => ({
    materialId: m.materialId,
    customName: m.customName,
    percentage: m.percentage === null ? null : Number(m.percentage.toString()),
  }));
  // Sections: product override → template override → store-wide override → default, field by field.
  const sectionsResolved = resolveSections({
    global: layerFromRows(await loadGlobalRows()),
    template: layerFromRows(type?.template.sections),
    product: layerFromRows(row.sections),
  });
  const faqs = (row.faqs ?? []).map((f) => ({ question: f.question, answer: f.answer }));
  const resolved = buildResolvedView(config, attributes, {
    care: buildCareView({ careOverride: row.careOverride, carePreset: row.carePreset }, config),
    materials: row.materials.map((m, i) => ({ name: m.material?.name ?? m.customName ?? "", percentage: materials[i]!.percentage })),
    // Only what the page will render: enabled sections, in order. Text is sent only for the text-type ones.
    sections: sectionsResolved
      .filter((s) => s.enabled)
      .map((s) => ({ key: s.key, title: s.title, order: s.order, area: s.area, content: s.contentType === "none" ? null : s.content })),
    faqs,
  });
  const relations = groupRelations(row.relations);
  const {
    attributeValues: _values, type: _type, attributes: _attrs, typeId: _typeId, carePreset: _care, materials: _materials,
    sections: _sections, faqs: _faqs, relations: _relations, ...rest
  } = row;
  void _values; void _type; void _attrs; void _typeId; void _care; void _materials; void _sections; void _faqs; void _relations;
  return {
    presented: { ...rest, typeId: type?.id ?? null, attributes, materials, resolved } as unknown as Presented<T>,
    config,
    admin: { sectionOverrides: overridesFromRows(row.sections), sectionsResolved, faqs, relations },
  };
}

interface AdminExtras {
  sectionOverrides: ReturnType<typeof overridesFromRows>;
  sectionsResolved: ResolvedSection[];
  faqs: { question: string; answer: string }[];
  relations: { kind: string; productIds: string[]; products: { id: string; name: string }[] }[];
}

/** [{kind, relatedId}] in stored order -> [{kind, productIds}] — the shape the editor and the write API use. */
function groupRelations(rows: { kind: string; relatedId: string; related?: { id: string; name: string } }[] | undefined) {
  const byKind = new Map<string, { id: string; name: string }[]>();
  for (const r of rows ?? []) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), { id: r.relatedId, name: r.related?.name ?? r.relatedId }]);
  return [...byKind.entries()].map(([kind, products]) => ({ kind, productIds: products.map((p) => p.id), products }));
}

async function presentProduct<T extends PresentableRow>(row: T): Promise<Presented<T>> {
  return (await presentWithConfig(row)).presented;
}

type DetailRow = Prisma.ProductGetPayload<{ include: typeof detailInclude }>;

/** Scores a detail row against its type's template — the same function the editor runs on live form values. */
function completenessOf(presented: Presented<DetailRow>, config: ResolvedTypeConfig | null): CompletenessResult {
  return computeCompleteness(
    {
      name: presented.name,
      categoryId: presented.categoryId,
      basePrice: presented.basePrice.toString(),
      description: presented.description,
      seoDescription: presented.seoDescription,
      trackInventory: presented.trackInventory,
      variants: presented.variants,
      imageCount: presented.images.length,
      attributes: presented.attributes,
      materialCount: presented.materials.length,
      hasCare: presented.resolved.care !== null,
      sizeGuideShown: !config || config.sizeGuide.mode === "NOT_APPLICABLE" ? null : presented.resolved.sizeGuide.show,
    },
    config,
  );
}

/** Admin detail read: the presented product plus its completeness (never sent to the storefront). */
async function presentForAdmin(row: DetailRow) {
  const { presented, config, admin } = await presentWithConfig(row);
  return { ...presented, completeness: completenessOf(presented, config), ...admin };
}

/** JSON column input: `undefined` leaves the column alone, `null` clears it (Prisma needs the JsonNull
 * sentinel for that — a bare `undefined`/`null` would silently do nothing / be rejected). */
function toJsonInput(value: Record<string, unknown> | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonObject;
}

/** Nested-create shape for a variant's attribute links — `attributeValueIds` isn't a real column, it drives this join table instead.
 * `sortOrder` comes from the variant's position in the submitted array: the storefront shows `variants[0]`'s color/size as the
 * default selection, so reordering variants in the admin form is how "which color is the main one" gets set. */
function toVariantCreateData(variant: CreateVariantInput, sortOrder: number) {
  // `imageIds` isn't a column: galleries are written after the variant exists (see syncVariantGallery).
  const { attributeValueIds = [], imageIds: _imageIds, ...rest } = variant;
  void _imageIds;
  return {
    ...rest,
    size: rest.size || NO_SIZE_VALUE,
    color: rest.color || "",
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

export async function invalidateCache() {
  await invalidateProductCache();
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

/** How many search-matching candidates get pulled in (unpaginated) to be scored and ranked by
 * relevance in JS before slicing out the requested page — bounded rather than the whole matching
 * set so a very broad query on a large catalog can't turn a search into an unbounded fetch. Every
 * real search result set is inherently a filtered slice of the catalog already (see the `where`
 * clause this runs against), so this cap only ever engages for pathologically broad single-word
 * queries; ranking quality for the page(s) a shopper actually looks at is unaffected. */
const RELEVANCE_CANDIDATE_CAP = 300;

type RelevanceCandidate = {
  id: string;
  name: string;
  description: string;
  brand: string | null;
  category: { name: string };
  createdAt: Date;
};

/** Textual relevance score for one candidate against the search — direct matches on the original
 * query outrank matches that only exist via a synonym expansion, and name matches outrank matches
 * only found in the description, so e.g. a product literally named "Cap" ranks above one that only
 * mentions "cap" once in a paragraph of care instructions. Purely additive/comparative — the exact
 * numbers only matter relative to each other, not as an absolute "quality" score. */
function computeRelevanceScore(candidate: RelevanceCandidate, rawQuery: string, expandedTerms: string[]): number {
  const query = rawQuery.trim().toLowerCase();
  const name = candidate.name.toLowerCase();
  const description = candidate.description.toLowerCase();
  const brand = candidate.brand?.toLowerCase() ?? "";
  const categoryName = candidate.category.name.toLowerCase();

  let score = 0;
  if (name === query) score += 1000;
  else if (name.startsWith(query)) score += 700;
  else if (name.includes(query)) score += 500;

  const originalWords = new Set(query.split(/\s+/).filter(Boolean));

  for (const term of expandedTerms) {
    // A term that's literally one of the shopper's own words counts for more than one that only
    // matched because it's a synonym of a word they typed — a search for "cap" ranking a product
    // that says "cap" above one that only says its Bangla synonym "টুপি" (or vice versa) reads as
    // more relevant, even though both are legitimate matches.
    const isDirect = originalWords.has(term) || term === query;
    const weight = isDirect ? 1 : 0.4;
    if (name.includes(term)) score += 80 * weight;
    if (categoryName.includes(term)) score += 50 * weight;
    if (brand.includes(term)) score += 40 * weight;
    if (description.includes(term)) score += 15 * weight;
  }

  return score;
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

const DID_YOU_MEAN_NAME_THRESHOLD = 0.25;

/** Best single spelling-corrected guess drawn from real catalog data (product and category
 * names), for when the curated vocabulary (findClosestVocabularyTerm) doesn't recognize the query
 * at all — catches a misspelled brand or product name that was never going to be in a generic
 * "cap/shirt/panjabi" style dictionary. Lower threshold than the typo-tolerant result fallback
 * above since this only ever surfaces as a suggestion the shopper opts into, never as silently
 * injected results. */
async function findBestNameSuggestion(query: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ term: string; sim: number }>>`
    SELECT name AS term, word_similarity(${query}, name) AS sim
    FROM "Product"
    WHERE "isActive" = true AND "deletedAt" IS NULL
    UNION ALL
    SELECT name AS term, word_similarity(${query}, name) AS sim
    FROM "Category"
    WHERE "isActive" = true
    ORDER BY sim DESC
    LIMIT 1
  `;
  const best = rows[0];
  return best && best.sim > DID_YOU_MEAN_NAME_THRESHOLD ? best.term : null;
}

/** Zero real results even after the typo-tolerant fallback — the curated catalog vocabulary
 * (Bangla/English/transliteration aware) gets first say since a hit there is a "canonical" term
 * the shopper can actually search again; a raw product/category name is the fallback for whatever
 * that dictionary doesn't cover. */
async function findDidYouMean(query: string): Promise<string | undefined> {
  return (findClosestVocabularyTerm(query) ?? (await findBestNameSuggestion(query))) ?? undefined;
}

/** Fire-and-forget — a real search-page visit, not typeahead. Never allowed to break search.
 * `suggestion` is whatever findDidYouMean already computed for this exact search (see the call
 * site below) — passed in rather than recomputed here, so a zero-result search never pays for a
 * second trigram lookup. */
async function logSearch(query: string, resultCount: number, suggestion?: string) {
  try {
    await prisma.searchLog.create({ data: { query: query.trim().toLowerCase(), resultCount, suggestion: suggestion ?? null } });
  } catch {
    // logging is best-effort only
  }
}

export async function listProducts(query: ProductListQuery) {
  const where = {
    deletedAt: query.trashed ? { not: null } : null,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.typeId ? { typeId: query.typeId } : {}),
    // Matches by product name OR any variant's SKU — the admin product list and the "Create
    // order" product picker both advertise "search by name or SKU", so a staff member typing in
    // a barcode/SKU (which never appears in the name) must still find the exact product.
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { variants: { some: { sku: { contains: query.search, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };

  return paginate(
    query,
    (p) => prisma.product.findMany({ where, include: { ...include, type: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, ...p }),
    () => prisma.product.count({ where }),
  );
}

export async function getProductById(id: string) {
  const product = await prisma.product.findUnique({ where: { id }, include: detailInclude });
  if (!product) throw AppError.notFound("Product not found");
  return presentForAdmin(product);
}

/** Public lookup: only returns active products, matching what the storefront should link to. */
export async function getProductBySlug(slug: string) {
  const cacheKey = `${CACHE_PREFIX}slug:${slug}`;
  let product = await cacheGet<Presented<Prisma.ProductGetPayload<{ select: typeof PUBLIC_DETAIL_SELECT }>>>(cacheKey);

  if (!product) {
    const row = await prisma.product.findUnique({ where: { slug }, select: PUBLIC_DETAIL_SELECT });
    if (!row || !row.isActive || row.deletedAt) throw AppError.notFound("Product not found");
    product = await presentProduct(row);
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
  // "Relevance" only means something when there's actually a query to be relevant *to* — sort
  // falls back to the normal DB-ordered path otherwise (e.g. a bare category browse with no
  // search, which is the overwhelmingly common case and stays exactly as fast/cheap as before).
  const useRelevanceRanking = query.sort === "relevance" && searchTerms.length > 0;

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
    // Relevance mode pulls a bounded, unpaginated candidate pool and ranks it in application code
    // (see computeRelevanceScore) rather than paginating straight from the DB — Postgres has no
    // idea which of these matches is the "best" one, only that they all matched *something*.
    // Every other sort keeps the original single paginated query, completely unchanged.
    useRelevanceRanking
      ? prisma.product.findMany({
          where,
          select: PUBLIC_PRODUCT_SELECT,
          orderBy: { createdAt: "desc" },
          take: RELEVANCE_CANDIDATE_CAP,
        })
      : prisma.product.findMany({
          where,
          select: PUBLIC_PRODUCT_SELECT,
          orderBy: SORT_ORDER_BY[query.sort] ?? SORT_ORDER_BY.newest,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
    prisma.product.count({ where }),
  ]);

  let pageRaw = rawItems;
  if (useRelevanceRanking) {
    const scored = rawItems
      // Array.prototype.sort is stable, and rawItems already arrived newest-first, so equal
      // scores keep that relative order — a free, sensible tie-break with no extra comparator.
      .map((item) => ({ item, score: query.search ? computeRelevanceScore(item, query.search, searchTerms) : 0 }))
      .sort((a, b) => b.score - a.score);
    const start = (query.page - 1) * query.pageSize;
    pageRaw = scored.slice(start, start + query.pageSize).map((s) => s.item);
  }

  let items = await withFlashSaleInfo(pageRaw);
  let resultTotal = total;

  // Typo-tolerant fallback — only worth trying on page 1 of an actual search that came up short.
  if (query.search && query.page === 1 && total < TYPO_FALLBACK_THRESHOLD) {
    const fallbackIds = await findTypoTolerantProductIds(query.search, categoryIds, query.pageSize);
    const newIds = fallbackIds.filter((id) => !items.some((item) => item.id === id));

    if (newIds.length > 0) {
      const fallbackRaw = await prisma.product.findMany({
        where: { id: { in: newIds }, isActive: true, deletedAt: null },
        select: PUBLIC_PRODUCT_SELECT,
      });
      const fallbackItems = await withFlashSaleInfo(fallbackRaw);
      const byId = new Map(fallbackItems.map((p) => [p.id, p]));
      const orderedFallback = newIds.map((id) => byId.get(id)).filter((p): p is (typeof fallbackItems)[number] => Boolean(p));

      items = [...items, ...orderedFallback].slice(0, query.pageSize);
      resultTotal = total + orderedFallback.length;
    }
  }

  const didYouMean = query.search && resultTotal === 0 ? await findDidYouMean(query.search) : undefined;

  if (query.search) {
    void logSearch(query.search, resultTotal, didYouMean);
  }

  return { items, total: resultTotal, page: query.page, pageSize: query.pageSize, didYouMean };
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
    // "Standard" (no size) and blank colours are placeholders for types without that dimension — offering
    // them as filter chips would be meaningless (or an empty swatch).
    prisma.productVariant.findMany({
      where: { product: where, size: { not: NO_SIZE_VALUE } },
      distinct: ["size"],
      select: { size: true },
    }),
    prisma.productVariant.findMany({
      where: { product: where, color: { not: "" } },
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
  // description/brand/category/createdAt exist only to feed computeRelevanceScore below — never
  // sent to the client, see toSuggestionProduct's much narrower return shape.
  description: true,
  brand: true,
  category: { select: { name: true } },
  createdAt: true,
  images: { orderBy: { sortOrder: "asc" as const }, take: 1, select: { url: true } },
};

const SUGGEST_CANDIDATE_CAP = 40;

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

  // Same relevance-ranking approach as listStorefrontProducts: pull a bounded candidate pool and
  // rank in application code, rather than trusting "whichever `limit` rows the DB happened to
  // return newest-first" to also be the `limit` most relevant ones — the dropdown is exactly where
  // a shopper judges whether this search "understands" what they typed.
  const candidateRows = await prisma.product.findMany({
    where: { isActive: true, deletedAt: null, ...buildFieldSearchOr(searchTerms) },
    select: SUGGEST_SELECT,
    orderBy: { createdAt: "desc" },
    take: SUGGEST_CANDIDATE_CAP,
  });
  let productRows = candidateRows
    .map((item) => ({ item, score: computeRelevanceScore(item, query, searchTerms) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);

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

  const didYouMean = productRows.length === 0 && predictions.length === 0 ? await findDidYouMean(query) : undefined;

  return { products: productRows.map(toSuggestionProduct), predictions, didYouMean };
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
    select: PUBLIC_PRODUCT_SELECT,
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const ordered = ids.map((id) => byId.get(id)).filter((p): p is (typeof products)[number] => Boolean(p));
  return withFlashSaleInfo(ordered);
}

/** Same category, ranked by price-proximity to the target product — a lightweight stand-in for a
 * real similarity model that still gives a sensibly ordered result from data we actually have.
 * Pulls a bounded candidate pool (price-sorted both directions from the target) rather than every
 * active product in the category, so a large category doesn't turn this into a full-table scan. */
export async function getSimilarProducts(productId: string, limit = 8) {
  const target = await prisma.product.findUnique({ where: { id: productId }, select: { categoryId: true, basePrice: true } });
  if (!target) return [];

  const candidatePoolSize = limit * 4;
  const baseWhere = { categoryId: target.categoryId, isActive: true, deletedAt: null, id: { not: productId } };

  const [cheaperOrEqual, pricier] = await Promise.all([
    prisma.product.findMany({
      where: { ...baseWhere, basePrice: { lte: target.basePrice } },
      select: PUBLIC_PRODUCT_SELECT,
      orderBy: { basePrice: "desc" },
      take: candidatePoolSize,
    }),
    prisma.product.findMany({
      where: { ...baseWhere, basePrice: { gt: target.basePrice } },
      select: PUBLIC_PRODUCT_SELECT,
      orderBy: { basePrice: "asc" },
      take: candidatePoolSize,
    }),
  ]);

  const targetPrice = Number(target.basePrice);
  const candidates = [...cheaperOrEqual, ...pricier].sort(
    (a, b) => Math.abs(Number(a.basePrice) - targetPrice) - Math.abs(Number(b.basePrice) - targetPrice),
  );

  return withFlashSaleInfo(candidates.slice(0, limit));
}

/** Products actually co-purchased with this one, ranked by how often they appear in the same order.
 * Redis-cached (raw product rows, like getProductBySlug) since the aggregation touches every order
 * containing the product. */
export async function getFrequentlyBoughtTogether(productId: string, limit = 4) {
  const cacheKey = `${CACHE_PREFIX}fbt:${productId}`;
  let ranked = await cacheGet<PublicProduct[]>(cacheKey);

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
        select: PUBLIC_PRODUCT_SELECT,
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
  let pool = await cacheGet<PublicProduct[]>(TRENDING_CACHE_KEY);

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
        select: PUBLIC_PRODUCT_SELECT,
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
    select: PUBLIC_PRODUCT_SELECT,
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
    select: PUBLIC_PRODUCT_SELECT,
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
    select: PUBLIC_PRODUCT_SELECT,
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
    select: PUBLIC_PRODUCT_SELECT,
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
    totalViews: number;
    recentPurchaseCount: number;
    unitsSoldLast7Days: number;
    isFastSelling: boolean;
  }>(cacheKey);
  if (cached) return cached;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const variantIds = (await prisma.productVariant.findMany({ where: { productId }, select: { id: true } })).map(
    (v) => v.id,
  );

  // Lifetime count rather than "today" — a per-day count resets to a small, unimpressive number
  // every midnight and reads as "nobody's looking at this" on a slow morning; the running total
  // only ever goes up.
  const [totalViews, weekOrderItems, stockAgg] = await Promise.all([
    prisma.productViewLog.count({ where: { productId } }),
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
  const stock = stockAgg._sum.stock ?? 0;
  const isFastSelling = stock > 0 && unitsSoldLast7Days >= stock;

  const signals = {
    totalViews,
    recentPurchaseCount,
    unitsSoldLast7Days,
    isFastSelling,
  };

  await cacheSet(cacheKey, signals, URGENCY_CACHE_TTL_SECONDS);
  return signals;
}

type AttributeSplit = { defined: Record<string, unknown>; legacy: Record<string, unknown> };

/** Splits the submitted `attributes` map into values for the type's defined fields (stored as typed rows)
 * and the rest (kept in the legacy JSON). A key with no definition is only accepted when it is `sizeGuide`
 * or was already stored on the product — otherwise it would be an arbitrary write into the JSON column. */
function splitAttributes(
  fields: ResolvedAttributeField[],
  submitted: Record<string, unknown>,
  existingKeys: ReadonlySet<string>,
): AttributeSplit {
  const fieldKeys = new Set(fields.map((f) => f.key));
  const defined: Record<string, unknown> = {};
  const legacy: Record<string, unknown> = {};
  const unknown: string[] = [];

  for (const [key, value] of Object.entries(submitted)) {
    if (fieldKeys.has(key)) defined[key] = value;
    else if (key === "sizeGuide" || existingKeys.has(key)) legacy[key] = value;
    else unknown.push(key);
  }
  if (unknown.length) {
    throw AppError.badRequest("Validation failed", {
      formErrors: [],
      fieldErrors: { attributes: [`Unknown attribute(s): ${unknown.join(", ")}`] },
    });
  }
  return { defined, legacy };
}

function throwIfInvalid(issues: { path: (string | number)[]; message: string }[]) {
  if (!issues.length) return;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) (fieldErrors[issue.path.join(".")] ??= []).push(issue.message);
  throw AppError.badRequest("Validation failed", { formErrors: [], fieldErrors });
}

/** Which type a write targets: the explicit `typeId`, else the system type matching a legacy `productType`
 * (stale clients), else — for updates — the product's current type, else Clothing. */
async function resolveTypeForWrite(
  input: { typeId?: string; productType?: string },
  current?: { typeId: string | null; productType: string },
): Promise<TypeWithTemplate> {
  let type: TypeWithTemplate | null;
  if (input.typeId) {
    type = await getTypeWithTemplate(input.typeId).catch(() => null);
    if (!type) throw AppError.badRequest("Product type does not exist");
  } else if (input.productType && input.productType !== "CUSTOM") {
    type = await getTypeByKey(input.productType);
  } else if (current) {
    type = current.typeId ? await getTypeWithTemplate(current.typeId).catch(() => null) : await getTypeByKey(current.productType);
  } else {
    type = await getTypeByKey("CLOTHING");
  }
  if (!type) throw AppError.badRequest("Product type does not exist");
  // Archived types can't take on new products, but a product already on one may keep saving.
  if (!type.isActive && type.id !== current?.typeId) throw AppError.badRequest(`The "${type.name}" product type is archived`);
  return type;
}

/** Only the typed column that applies to the field's data type is written; the others stay null. */
function attributeRowData(field: ResolvedAttributeField, value: unknown) {
  const cols = toStoredColumns(field.dataType, value);
  return Object.fromEntries(Object.entries(cols).filter(([, v]) => v !== null)) as {
    valueText?: string;
    valueNumber?: number;
    valueBoolean?: boolean;
    valueDate?: Date;
    valueJson?: Prisma.InputJsonValue;
  };
}

const GATED_STATUSES: ReadonlySet<ProductStatus> = new Set(["READY", "PUBLISHED"]);

/** A product can only move to READY or PUBLISHED while every required completeness check passes. Runs inside the
 * write's transaction on the *saved* state, so a refusal rolls the whole save back — nothing half-applies. */
async function assertPublishable(tx: Prisma.TransactionClient, productId: string, target: ProductStatus) {
  const row = await tx.product.findUnique({ where: { id: productId }, include: detailInclude });
  if (!row) throw AppError.notFound("Product not found");
  const { presented, config } = await presentWithConfig(row);
  const result = completenessOf(presented, config);
  if (result.blockers.length) {
    const verb = target === "READY" ? "mark it ready" : "publish it";
    throw AppError.badRequest(`Can't ${verb} yet — missing: ${describeBlockers(result)}`, {
      formErrors: [`Missing before this product can go ${target === "READY" ? "ready" : "live"}: ${result.blockers.map((b) => b.detail ?? b.label).join("; ")}`],
      fieldErrors: {},
      blockers: result.blockers,
    });
  }
}

/** Validates the composition lines (real, non-archived materials) and replaces the product's rows. */
async function replaceMaterials(
  tx: Prisma.TransactionClient,
  productId: string,
  materials: NonNullable<CreateProductInput["materials"]>,
) {
  const ids = [...new Set(materials.map((m) => m.materialId).filter((x): x is string => Boolean(x)))];
  if (ids.length) {
    const found = await tx.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isArchived: true } });
    const foundIds = new Set(found.map((m) => m.id));
    if (ids.some((id) => !foundIds.has(id))) throw AppError.badRequest("One of the selected materials no longer exists");
    const existing = new Set(
      (await tx.productMaterial.findMany({ where: { productId, materialId: { in: ids } }, select: { materialId: true } })).map((m) => m.materialId),
    );
    const archived = found.find((m) => m.isArchived && !existing.has(m.id));
    if (archived) throw AppError.badRequest(`The material "${archived.name}" is archived`);
  }
  await tx.productMaterial.deleteMany({ where: { productId } });
  if (materials.length) {
    await tx.productMaterial.createMany({
      data: materials.map((m, sortOrder) => ({
        productId,
        materialId: m.materialId ?? null,
        customName: m.materialId ? null : (m.customName ?? null),
        percentage: m.percentage ?? null,
        sortOrder,
      })),
    });
  }
}

/** The product's FAQ is sent whole and replaces the stored one; order is the array order. */
async function replaceFaqs(tx: Prisma.TransactionClient, productId: string, faqs: { question: string; answer: string }[]) {
  await tx.productFaq.deleteMany({ where: { productId } });
  if (faqs.length) await tx.productFaq.createMany({ data: faqs.map((f, sortOrder) => ({ productId, question: f.question, answer: f.answer, sortOrder })) });
}

/** Replaces only the kinds sent. Every product must exist (and be undeleted); a product can't recommend itself. */
async function replaceRelations(tx: Prisma.TransactionClient, productId: string, relations: ProductRelationsInput) {
  const ids = [...new Set(relations.flatMap((r) => r.productIds))];
  if (ids.includes(productId)) throw AppError.badRequest("A product can't be its own related product");
  if (ids.length) {
    const found = await tx.product.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw AppError.badRequest("One of the selected related products no longer exists");
  }
  for (const { kind, productIds } of relations) {
    await tx.productRelation.deleteMany({ where: { productId, kind } });
    if (productIds.length) {
      await tx.productRelation.createMany({ data: productIds.map((relatedId, sortOrder) => ({ productId, relatedId, kind, sortOrder })) });
    }
  }
}

/** Replaces a variant's gallery with `imageIds` (in order) and points its primary image at the first. Every image
 * must belong to this product — a variant can't be given another product's photo. */
async function syncVariantGallery(tx: Prisma.TransactionClient, productId: string, variantId: string, imageIds: string[]) {
  if (imageIds.length) {
    const owned = await tx.productImage.count({ where: { id: { in: imageIds }, productId } });
    if (owned !== new Set(imageIds).size) throw AppError.badRequest("A selected variant image doesn't belong to this product");
  }
  await tx.variantImage.deleteMany({ where: { variantId } });
  if (imageIds.length) {
    await tx.variantImage.createMany({ data: imageIds.map((imageId, sortOrder) => ({ variantId, imageId, sortOrder })) });
  }
  await tx.productVariant.update({ where: { id: variantId }, data: { imageId: imageIds[0] ?? null } });
}

async function assertCarePresetUsable(carePresetId: string | null | undefined, currentId: string | null) {
  if (!carePresetId || carePresetId === currentId) return;
  const preset = await prisma.careGuidePreset.findUnique({ where: { id: carePresetId }, select: { isArchived: true } });
  if (!preset) throw AppError.badRequest("Care guide does not exist");
  if (preset.isArchived) throw AppError.badRequest("That care guide is archived");
}

/** `[]` and null both mean "no override" — stored as SQL NULL so "has an override" is a plain null check. */
function careOverrideInput(value: string[] | null | undefined) {
  if (value === undefined) return undefined;
  return value && value.length ? (value as Prisma.InputJsonArray) : Prisma.DbNull;
}

const toSnapshot = (p: Awaited<ReturnType<typeof getProductById>>): AuditSnapshot => p as unknown as AuditSnapshot; // includes sectionOverrides / faqs / relations from the admin presentation

function recordProductAudit(adminId: string, productId: string, ip: string | undefined, events: ReturnType<typeof diffProduct>) {
  for (const event of events) {
    recordAudit({ adminId, action: event.action, entityType: "products", entityId: productId, ipAddress: ip ?? null, metadata: { changes: event.changes } });
  }
}

export async function createProduct(input: CreateProductInput, adminId: string, ip?: string) {
  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!category || category.deletedAt) throw AppError.badRequest("Category does not exist");

  const skus = input.variants.map((v) => v.sku);
  if (new Set(skus).size !== skus.length) throw AppError.badRequest("Duplicate SKU in variants");

  const type = await resolveTypeForWrite(input);
  const config: ResolvedTypeConfig = toResolvedTypeConfig(type);
  const {
    variants,
    typeId: _typeId,
    productType: _productType,
    attributes: submitted,
    status: submittedStatus,
    isActive: legacyIsActive,
    materials,
    careOverride,
    sections,
    faqs,
    relations,
    ...productData
  } = input;
  void _typeId; void _productType;

  // A new product is a DRAFT unless the caller says otherwise; the old `isActive` flag still means what it did.
  const status: ProductStatus = submittedStatus ?? (legacyIsActive === true ? "PUBLISHED" : legacyIsActive === false ? "UNPUBLISHED" : "DRAFT");

  throwIfInvalid(validateProductAgainstConfig({ attributes: submitted ?? {}, variants }, config));
  const { defined, legacy } = splitAttributes(config.fields, submitted ?? {}, new Set());
  await assertCarePresetUsable(productData.carePresetId, null);

  const baseSlug = slugify(input.slug || input.name);
  const slug = await ensureUniqueSlug(baseSlug, async (candidate) => {
    return Boolean(await prisma.product.findUnique({ where: { slug: candidate } }));
  });

  let product;
  try {
    product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          ...productData,
          typeId: type.id,
          productType: type.legacyType,
          status,
          isActive: status === "PUBLISHED",
          attributes: toJsonInput(Object.keys(legacy).length ? legacy : null),
          careOverride: careOverrideInput(careOverride) === Prisma.DbNull ? undefined : careOverrideInput(careOverride),
          slug,
          variants: { create: variants.map((v, i) => toVariantCreateData(v, i)) },
        },
        include,
      });

      const rows = config.fields
        .filter((f) => f.key in defined && !isBlankAttributeValue(defined[f.key]))
        .map((f) => ({ productId: created.id, definitionId: f.definitionId, ...attributeRowData(f, defined[f.key]) }));
      if (rows.length) await tx.productAttributeValue.createMany({ data: rows });
      if (materials?.length) await replaceMaterials(tx, created.id, materials);
      if (sections?.length) await saveProductSections(tx, created.id, sections);
      if (faqs?.length) await replaceFaqs(tx, created.id, faqs);
      if (relations?.length) await replaceRelations(tx, created.id, relations);

      // Every variant starts life with a real stock number but no history explaining it — log it
      // as an opening RESTOCK movement so the ledger accounts for stock from the moment it exists.
      const stocked = created.variants.filter((v) => v.stock > 0);
      if (stocked.length) {
        await tx.stockMovement.createMany({
          data: stocked.map((v) => ({
            variantId: v.id,
            change: v.stock,
            reason: "RESTOCK" as const,
            adminId,
            note: "Initial stock on product creation",
          })),
        });
      }

      if (GATED_STATUSES.has(status)) await assertPublishable(tx, created.id, status);
      return created;
    });
  } catch (err) {
    // ensureUniqueSlug's check-then-create can still race on a concurrent request picking the
    // same candidate slug; SKUs have no equivalent pre-check at all. Both are unique-constrained
    // at the DB level, so this is the real backstop for either.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = err.meta?.target;
      const field = Array.isArray(target) ? target.join(", ") : "slug or SKU";
      throw AppError.conflict(`A product with this ${field} already exists`);
    }
    throw err;
  }

  await invalidateCache();
  recordAudit({
    adminId,
    action: "product.created",
    entityType: "products",
    entityId: product.id,
    ipAddress: ip ?? null,
    metadata: { changes: [{ field: "name", from: null, to: product.name }, { field: "status", from: null, to: status }] },
  });
  return getProductById(product.id);
}

export async function updateProduct(id: string, input: UpdateProductInput, adminId: string, ip?: string) {
  const existing = await getProductById(id);

  if (input.categoryId) {
    const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
    if (!category || category.deletedAt) throw AppError.badRequest("Category does not exist");
  }

  const type = await resolveTypeForWrite(input, { typeId: existing.typeId, productType: existing.productType });
  const config = toResolvedTypeConfig(type);
  const typeChanged = type.id !== existing.typeId;

  // Fields the payload didn't mention keep their current values, so a partial update from an API client
  // is judged on the resulting product, not on the fragment it sent.
  const attributesTouched = input.attributes !== undefined || typeChanged;
  const currentFieldKeys = new Set(config.fields.map((f) => f.key));
  // Values a previous stint on this type left behind (hidden while the product was on another type) count as
  // current again after switching back — otherwise a required field would demand re-entering data that exists.
  const restored: Record<string, unknown> = {};
  if (typeChanged) {
    const rows = await prisma.productAttributeValue.findMany({
      where: { productId: id, definitionId: { in: config.fields.map((f) => f.definitionId) } },
      include: { definition: { select: { key: true, dataType: true } } },
    });
    for (const row of rows) {
      const value = fromStoredRow(row.definition.dataType as AttributeDataType, row);
      if (!isBlankAttributeValue(value)) restored[row.definition.key] = value;
    }
  }
  const mergedAttributes = { ...restored, ...existing.attributes, ...(input.attributes ?? {}) };
  throwIfInvalid(
    validateProductAgainstConfig(
      { attributes: attributesTouched ? mergedAttributes : undefined, variants: input.variants },
      { ...config, fields: attributesTouched ? config.fields : [] },
    ),
  );

  const {
    typeId: _typeId,
    productType: _productType,
    attributes: _attributes,
    variants: _variants,
    status: submittedStatus,
    isActive: legacyIsActive,
    materials,
    careOverride,
    sections,
    faqs,
    relations,
    ...rest
  } = input;
  void _typeId; void _productType; void _attributes; void _variants;
  const data: Record<string, unknown> = { ...rest };
  if (careOverride !== undefined) data.careOverride = careOverrideInput(careOverride);
  await assertCarePresetUsable(rest.carePresetId, existing.carePresetId ?? null);

  // Status: an explicit `status` wins; the legacy `isActive` flag maps onto it (true = publish, false = unpublish
  // only a live product, so a stale form can't turn a draft into "unpublished").
  let target: ProductStatus | undefined = submittedStatus;
  if (!target && legacyIsActive !== undefined) {
    if (legacyIsActive) target = "PUBLISHED";
    else if (existing.status === "PUBLISHED") target = "UNPUBLISHED";
  }
  const statusChanged = target !== undefined && target !== existing.status;
  if (statusChanged) {
    data.status = target;
    data.isActive = target === "PUBLISHED";
  }

  if (typeChanged) {
    data.typeId = type.id;
    data.productType = type.legacyType;
  }

  let attributeSplit: AttributeSplit | null = null;
  if (input.attributes !== undefined) {
    const existingLegacyKeys = new Set(Object.keys(existing.attributes).filter((k) => !currentFieldKeys.has(k)));
    // `null` means "clear everything" — every defined field is blanked (its row deleted) and the legacy JSON emptied.
    const submitted = input.attributes ?? Object.fromEntries(config.fields.map((f) => [f.key, null]));
    attributeSplit = splitAttributes(config.fields, submitted, existingLegacyKeys);
    // The JSON column now only holds what has no attribute definition; defined values live in typed rows.
    data.attributes = toJsonInput(Object.keys(attributeSplit.legacy).length ? attributeSplit.legacy : null);
  }

  if (input.name && !input.slug) {
    data.slug = await ensureUniqueSlug(slugify(input.name), async (candidate) => {
      return Boolean(await prisma.product.findFirst({ where: { slug: candidate, NOT: { id } } }));
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data });
      if (materials !== undefined) await replaceMaterials(tx, id, materials);
      if (sections !== undefined) await saveProductSections(tx, id, sections);
      if (faqs !== undefined) await replaceFaqs(tx, id, faqs);
      if (relations !== undefined) await replaceRelations(tx, id, relations);

      if (attributeSplit) {
        for (const field of config.fields) {
          if (!(field.key in attributeSplit.defined)) continue;
          const value = attributeSplit.defined[field.key];
          const key = { productId_definitionId: { productId: id, definitionId: field.definitionId } };
          if (isBlankAttributeValue(value)) {
            await tx.productAttributeValue.deleteMany({ where: { productId: id, definitionId: field.definitionId } });
          } else {
            const columns = attributeRowData(field, value);
            await tx.productAttributeValue.upsert({
              where: key,
              update: { valueText: null, valueNumber: null, valueBoolean: null, valueDate: null, valueJson: Prisma.DbNull, ...columns },
              create: { productId: id, definitionId: field.definitionId, ...columns },
            });
          }
        }
      }

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
            const keptVariants = await tx.productVariant.findMany({
              where: { id: { in: mustKeep } },
              select: { id: true, stock: true },
            });
            await tx.productVariant.updateMany({ where: { id: { in: mustKeep } }, data: { stock: 0 } });
            const nonZero = keptVariants.filter((v) => v.stock !== 0);
            if (nonZero.length) {
              await tx.stockMovement.createMany({
                data: nonZero.map((v) => ({
                  variantId: v.id,
                  change: -v.stock,
                  reason: "ADJUSTMENT" as const,
                  adminId,
                  note: "Variant removed from product — had order history, stock zeroed instead of deleted",
                })),
              });
            }
          }
        }

        for (const [index, variant] of input.variants.entries()) {
          if (variant.id) {
            const { id: variantId, attributeValueIds = [], imageIds, ...updateData } = variant;
            // The gallery is authoritative when sent; an old client that only sends `imageId` means "exactly this one image".
            const gallery = imageIds ?? (updateData.imageId !== undefined ? (updateData.imageId ? [updateData.imageId] : []) : undefined);
            if (gallery) delete updateData.imageId; // syncVariantGallery sets it, from an image that is verified to belong here
            await tx.productVariant.update({
              where: { id: variantId },
              data: {
                ...updateData,
                // Only touch size/color when the payload carries them — omitting a field on a partial
                // variant update must keep the stored value, not reset it to the blank fallback.
                size: updateData.size === undefined ? undefined : updateData.size || NO_SIZE_VALUE,
                color: updateData.color === undefined ? undefined : updateData.color || "",
                sortOrder: index,
              },
            });
            if (gallery) await syncVariantGallery(tx, id, variantId, gallery);
            await tx.variantAttributeValue.deleteMany({ where: { variantId } });
            if (attributeValueIds.length) {
              await tx.variantAttributeValue.createMany({
                data: attributeValueIds.map((attributeValueId) => ({ variantId, attributeValueId })),
              });
            }
            // The plain Stock field on the product-edit form is the primary way admins change
            // stock day-to-day — diff it against the pre-update value so every save stays
            // ledger-complete without the form itself needing a reason/note prompt.
            if (updateData.stock !== undefined) {
              const before = existing.variants.find((v) => v.id === variantId);
              const delta = before ? updateData.stock - before.stock : 0;
              if (delta !== 0) {
                await tx.stockMovement.create({
                  data: { variantId, change: delta, reason: "ADJUSTMENT", adminId, note: "Manual edit via product form" },
                });
              }
            }
          } else {
            const created = await tx.productVariant.create({ data: { ...toVariantCreateData(variant, index), productId: id } });
            if (variant.imageIds?.length) await syncVariantGallery(tx, id, created.id, variant.imageIds);
            if (created.stock > 0) {
              await tx.stockMovement.create({
                data: { variantId: created.id, change: created.stock, reason: "RESTOCK", adminId, note: "Initial stock on variant creation" },
              });
            }
          }
        }
      }

      // Only a *move* to READY/PUBLISHED is gated: saving an already-live product never re-litigates its completeness.
      if (statusChanged && target && GATED_STATUSES.has(target)) await assertPublishable(tx, id, target);
    });
  } catch (err) {
    // Same race as createProduct — the ensureUniqueSlug check above isn't atomic with the write.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = err.meta?.target;
      const field = Array.isArray(target) ? target.join(", ") : "slug or SKU";
      throw AppError.conflict(`A product with this ${field} already exists`);
    }
    throw err;
  }

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

  const updated = await getProductById(id);
  recordProductAudit(adminId, id, ip, diffProduct(toSnapshot(existing), toSnapshot(updated)));
  return updated;
}

/** The product's change history, newest first: structured events (price changed, published, ...) recorded on every save. */
export async function getProductHistory(id: string, page = 1, pageSize = 30) {
  if (!(await prisma.product.findUnique({ where: { id }, select: { id: true } }))) throw AppError.notFound("Product not found");
  const where = { entityType: "products", entityId: id };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { admin: { select: { name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, page, pageSize };
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

/** Moves many products to a status. Going READY/PUBLISHED is gated per product: the ones that pass move, the ones that
 * don't are returned with what they're missing instead of failing the whole batch. */
export async function bulkUpdateProductStatus(ids: string[], target: ProductStatus, adminId: string, ip?: string) {
  const rows = await prisma.product.findMany({ where: { id: { in: ids } }, include: detailInclude });
  const blocked: { id: string; name: string; missing: string[] }[] = [];
  const movable: typeof rows = [];

  for (const row of rows) {
    if (row.status === target) continue;
    if (GATED_STATUSES.has(target)) {
      const { presented, config } = await presentWithConfig(row);
      const result = completenessOf(presented, config);
      if (result.blockers.length) {
        blocked.push({ id: row.id, name: row.name, missing: result.blockers.map((b) => b.label) });
        continue;
      }
    }
    movable.push(row);
  }

  if (movable.length) {
    await prisma.product.updateMany({
      where: { id: { in: movable.map((r) => r.id) } },
      data: { status: target, isActive: target === "PUBLISHED" },
    });
    for (const row of movable) {
      const action = target === "PUBLISHED" ? "product.published" : row.status === "PUBLISHED" ? "product.unpublished" : "product.status_changed";
      recordAudit({
        adminId, action, entityType: "products", entityId: row.id, ipAddress: ip ?? null,
        metadata: { changes: [{ field: "status", from: row.status, to: target }], bulk: true },
      });
    }
    await invalidateCache();
  }
  return { updated: movable.length, unchanged: rows.length - movable.length - blocked.length, blocked };
}

export async function bulkUpdateProductCategory(ids: string[], categoryId: string) {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.deletedAt) throw AppError.badRequest("Category does not exist");
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

export async function addProductImages(productId: string, images: Array<{ url: string; altText?: string; width?: number; height?: number }>) {
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
  // A variant whose primary image just went away (imageId SetNull) falls back to the next image in its own gallery.
  const orphaned = await prisma.productVariant.findMany({
    where: { productId, imageId: null, images: { some: {} } },
    select: { id: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { imageId: true } } },
  });
  for (const v of orphaned) await prisma.productVariant.update({ where: { id: v.id }, data: { imageId: v.images[0]!.imageId } });
  await deleteProductImageFiles(image.url);
  await invalidateCache();
}

export async function updateProductImage(productId: string, imageId: string, input: { altText?: string; caption?: string | null }) {
  const image = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (!image || image.productId !== productId) throw AppError.notFound("Image not found");
  await prisma.productImage.update({ where: { id: imageId }, data: input });
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

/* ───────────────────────── recommendation lists ───────────────────────── */

type RailKey = "related" | "frequentlyBought" | "crossSell" | "upsell" | "recommended";

/** For each hand-pickable list: the relation kind that feeds it, and the algorithm it falls back to when none are picked. */
const RAILS: Record<RailKey, { kind: "RELATED" | "FREQUENTLY_BOUGHT" | "CROSS_SELL" | "UPSELL" | "RECOMMENDED"; fallback: (productId: string) => Promise<unknown[]> }> = {
  related: { kind: "RELATED", fallback: (id) => getSimilarProducts(id) },
  frequentlyBought: { kind: "FREQUENTLY_BOUGHT", fallback: (id) => getFrequentlyBoughtTogether(id) },
  crossSell: { kind: "CROSS_SELL", fallback: (id) => getCompleteYourLook(id) },
  upsell: { kind: "UPSELL", fallback: (id) => getUpgradeOptions(id) },
  recommended: { kind: "RECOMMENDED", fallback: () => getTrendingProducts({ limit: 8 }) },
};
export const isRailKey = (key: string): key is RailKey => key in RAILS;

/** The products for one list: the admin's picks, in order (unpublished or trashed ones silently skipped), or — when
 * nothing is picked — the algorithm that always fed it, so an untouched product looks exactly as before. */
export async function getRail(productId: string, key: RailKey) {
  const { kind, fallback } = RAILS[key];
  const picks = await prisma.productRelation.findMany({ where: { productId, kind }, orderBy: { sortOrder: "asc" }, select: { relatedId: true } });
  if (picks.length) {
    // Picks that were since unpublished or deleted drop out; if none are left the section must not go blank.
    const items = await getProductsByIds(picks.map((p) => p.relatedId));
    if (items.length) return { source: "curated" as const, items };
  }
  return { source: "auto" as const, items: await fallback(productId) };
}

/** What the storefront would show for this product, whatever its status — for the admin preview. Same select and
 * presentation as the public read, so the preview can't drift from the real page. */
export async function getProductForPreview(id: string) {
  const row = await prisma.product.findUnique({ where: { id }, select: PUBLIC_DETAIL_SELECT });
  if (!row) throw AppError.notFound("Product not found");
  const [withFlash] = await withFlashSaleInfo([await presentProduct(row)]);
  return { ...withFlash, previewStatus: row.status };
}
