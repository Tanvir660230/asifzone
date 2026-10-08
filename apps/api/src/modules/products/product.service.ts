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
  computeCompleteness,
  describeBlockers,
  findDuplicateSkus,
  isBlankAttributeValue,
  resolveSections,
  toPublicSections,
  validateProductAgainstConfig,
  type ProductRelationsInput,
  type ProductSalesSummary,
  type UrgencySignals,
  type ResolvedSection,
  NO_SIZE_VALUE,
  type AttributeDataType,
  type CompletenessResult,
  type ProductResolvedView,
  type ProductStatus,
  type ResolvedAttributeField,
  type ResolvedTypeConfig,
  variantStockState,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { getSearchExpander } from "./search-synonyms.service";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { csvCell } from "../../lib/csv";
import { ensureUniqueSlug } from "../../lib/unique-slug";
import { deleteProductImageFiles } from "../uploads/upload.service";
import { getCategoryBySlug, getCategoryDescendantIds, getSiblingCategoryIds } from "../categories/category.service";
import { priceProductsForDisplay, type ProductPricingDto } from "../../domain/pricing/pricing.service";
import {
  ensureFreshReadModels,
  presentStorefrontProducts,
  projectedSellingPrice,
  refreshReadModels,
  sellingPriceOrderBy,
  sellingPriceWhere,
} from "../../domain/storefront/read-model.service";
import { notifyReplenished, recordInitialStock, setVariantStockCount, setVariantStockFromForm, zeroVariantStock } from "../inventory/inventory.service";
import { upsertSlugRedirect } from "../redirects/redirect.service";
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
import { SALE_ORDER_WHERE } from "../../domain/metrics/sale-order";
import { resolveLegacyWindow, utcInstant } from "../../domain/metrics/store-time";
import { layerFromRows, loadGlobalRows, overridesFromRows, saveProductSections, type SectionRow } from "../catalog/sections.service";
import { PRODUCT_CACHE_PREFIX, invalidateProductCache, triggerStorefrontRevalidation, type RevalidationContext } from "./product.cache";
import { diffProduct, type AuditSnapshot } from "./product-audit";
import { PUBLIC_PRODUCT_SCALARS, PUBLIC_VARIANT_FIELDS } from "./product-public-select";
import { captureError } from "../../lib/observability/error-capture";

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
  ...PUBLIC_PRODUCT_SCALARS,
  images: include.images,
  category: include.category,
  // The storefront never sees an inactive variant (the admin reads use `include` and see them all), nor a variant's cost.
  variants: {
    select: { ...PUBLIC_VARIANT_FIELDS, attributeValues: include.variants.include.attributeValues, images: include.variants.include.images },
    where: { isActive: true },
    orderBy: include.variants.orderBy,
  },
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
    sections: toPublicSections(sectionsResolved),
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
  // `resolved.sections` is already filtered to enabled-only (see presentWithConfig) — the same signal the
  // storefront uses to decide whether to render the Material/Care accordion items at all.
  const enabledSectionKeys = new Set(presented.resolved.sections.map((s) => s.key));
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
      materialEnabled: enabledSectionKeys.has("material"),
      careEnabled: enabledSectionKeys.has("care"),
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
  // `id` is dropped on purpose: a variant's primary key is the database's to choose, not the client's.
  // `stock`/`expectedStock` aren't written here either: a variant is created at 0 and its opening stock is recorded by
  // inventory.service (recordInitialStock) so the ledger explains every unit (docs/INVENTORY_INVARIANTS.md).
  const { id: _id, attributeValueIds = [], imageIds: _imageIds, stock: _stock, expectedStock: _expected, ...rest } = variant;
  void _imageIds;
  void _id;
  void _stock;
  void _expected;
  return {
    ...rest,
    stock: 0,
    size: rest.size || NO_SIZE_VALUE,
    color: rest.color || "",
    sortOrder,
    attributeValues: { create: attributeValueIds.map((attributeValueId) => ({ attributeValueId })) },
  };
}

/** Every storefront product read is presented by the Storefront Read Model (docs/STOREFRONT_READ_MODEL.md): canonical
 * `pricing` (live, from the pricing engine), `availability` (from canonical inventory state + D5) and the deprecated
 * `activeFlashSale` compat view — one DTO for PDP, listings, search, quick view, compare and recommendations. */
const withStorefrontReadModel = presentStorefrontProducts;


/** Invalidates the API's own Redis read cache (immediate, always) and, best-effort and non-blocking,
 * asks the storefront to drop the specific Next.js fetch-cache tags this change affects (see
 * product.cache.ts). `context` is optional so every existing call site keeps compiling as-is — pass
 * it wherever the affected product(s) are already known, which is every call site below. */
export async function invalidateCache(context?: RevalidationContext) {
  await invalidateProductCache();
  // Eager projection refresh for the products this write touched (best-effort — the read-time freshness guard catches
  // anything missed, e.g. a crash between the write and this line).
  const touched = [...(context?.productId ? [context.productId] : []), ...(context?.productIds ?? [])];
  if (touched.length) await refreshReadModels(touched).catch((err) => captureError(err, { msg: "[read-model] eager refresh failed:" }));
  void triggerStorefrontRevalidation(context).catch((err) => captureError(err, { msg: "[revalidate] unexpected failure:" }));
}

// Price sorts use the canonical selling price from the Storefront Read Model projection — never basePrice.
const SORT_ORDER_BY: Record<string, object> = {
  newest: { createdAt: "desc" },
  price_asc: sellingPriceOrderBy("asc"),
  price_desc: sellingPriceOrderBy("desc"),
};
const PRICE_SORTS = new Set(["price_asc", "price_desc"]);

const TYPO_FALLBACK_THRESHOLD = 3;
const TYPO_SIMILARITY_THRESHOLD = 0.3;

/** Multi-field OR filter across every expanded search term (original query + any known
 * synonyms) — name, description, brand, and category name, unlike the old name-only match — plus the
 * admin's search tags. Tags match whole (not as substrings): they're stored with the same normalization
 * expandSearchTerms applies, so a tag "ator" is found by "ator", "Ator" or "ator perfume". */
function buildFieldSearchOr(terms: string[]) {
  return {
    OR: [
      ...terms.flatMap((term) => [
        { name: { contains: term, mode: "insensitive" as const } },
        { description: { contains: term, mode: "insensitive" as const } },
        { brand: { contains: term, mode: "insensitive" as const } },
        { category: { name: { contains: term, mode: "insensitive" as const } } },
      ]),
      { tags: { hasSome: terms } },
    ],
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
  /** Only where the read selected them (relevance mode looks them up separately — they never reach the storefront). */
  tags?: string[];
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
    // The admin tagged the product with exactly this word — as deliberate a signal as its category.
    if (candidate.tags?.includes(term)) score += 50 * weight;
  }

  return score;
}

/** "Did you mean" typo tolerance via pg_trgm's word_similarity, for when exact/synonym
 * matching comes up short — catches e.g. "panjabee" -> "panjabi", and "atorr" against a product
 * tagged "ator" (tags are compared as one space-joined string, so any single tag can match).
 * Scoped to active products (and category, if given); intentionally doesn't also honor
 * price/size/color facet filters, since this is a fallback safety net, not a full facet-aware query path. */
async function findTypoTolerantProductIds(query: string, categoryIds: string[] | undefined, limit: number) {
  const categoryFilter = categoryIds && categoryIds.length > 0 ? Prisma.sql`AND "categoryId" IN (${Prisma.join(categoryIds)})` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM (
      SELECT id, GREATEST(word_similarity(${query}, name), word_similarity(${query}, array_to_string(tags, ' '))) AS sim
      FROM "Product"
      WHERE "isActive" = true AND "deletedAt" IS NULL ${categoryFilter}
    ) scored
    WHERE sim > ${TYPO_SIMILARITY_THRESHOLD}
    ORDER BY sim DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

const DID_YOU_MEAN_NAME_THRESHOLD = 0.25;

/** Best single spelling-corrected guess drawn from real catalog data (product and category
 * names), for when the synonym vocabulary (built-in + the store's groups) doesn't recognize the query
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
  return ((await getSearchExpander()).closest(query) ?? (await findBestNameSuggestion(query))) ?? undefined;
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

/** Product stock state over its active variants (the inventory page's rule, variantStockState, rolled up). */
function productStockState(p: { trackInventory: boolean; lowStockThreshold: number; variants: { stock: number; isActive: boolean }[] }) {
  const active = p.variants.filter((v) => v.isActive);
  const totalStock = active.reduce((sum, v) => sum + Math.max(v.stock, 0), 0);
  if (!p.trackInventory) return { stockState: "UNLIMITED" as const, totalStock };
  const states = active.map((v) => variantStockState(true, v.stock, p.lowStockThreshold));
  if (states.length === 0 || states.every((s) => s === "OUT_OF_STOCK")) return { stockState: "OUT_OF_STOCK" as const, totalStock };
  if (states.some((s) => s !== "IN_STOCK")) return { stockState: "LOW_STOCK" as const, totalStock };
  return { stockState: "IN_STOCK" as const, totalStock };
}

/** "low": tracked, something in stock, and some active variant at or below the product's threshold (a column compare,
 * so SQL). The ids feed the list's where clause. */
async function lowStockProductIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM "Product" p
    WHERE p."trackInventory"
      AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p.id AND v."isActive" AND v.stock > 0)
      AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p.id AND v."isActive" AND v.stock <= p."lowStockThreshold")`;
  return rows.map((r) => r.id);
}

const LIST_ORDER: Record<NonNullable<ProductListQuery["sort"]>, Prisma.ProductOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }],
  updated: [{ updatedAt: "desc" }],
  name: [{ name: "asc" }],
  price: [{ basePrice: "asc" }, { name: "asc" }],
  "-price": [{ basePrice: "desc" }, { name: "asc" }],
};

/** Completeness of one page of products — the editor's meter, from the same detail read the editor uses. */
async function completenessForPage(ids: string[]) {
  if (ids.length === 0) return new Map<string, { score: number; missing: string[] }>();
  const rows = await prisma.product.findMany({ where: { id: { in: ids } }, include: detailInclude });
  const out = new Map<string, { score: number; missing: string[] }>();
  for (const row of rows) {
    const { presented, config } = await presentWithConfig(row);
    const result = completenessOf(presented, config);
    out.set(row.id, { score: result.score, missing: result.checks.filter((c) => c.status === "missing").map((c) => c.label) });
  }
  return out;
}

export async function listProducts(query: ProductListQuery) {
  const stockWhere: Prisma.ProductWhereInput =
    query.stock === "out"
      ? { trackInventory: true, variants: { none: { isActive: true, stock: { gt: 0 } } } }
      : query.stock === "low"
        ? { id: { in: await lowStockProductIds() } }
        : {};
  const where = {
    ...stockWhere,
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

  const result = await paginate(
    query,
    (p) => prisma.product.findMany({ where, include: { ...include, type: { select: { id: true, name: true } } }, orderBy: LIST_ORDER[query.sort ?? "newest"], ...p }),
    () => prisma.product.count({ where }),
  );
  const completeness = await completenessForPage(result.items.map((p) => p.id));
  return {
    ...result,
    items: result.items.map((p) => ({ ...p, ...productStockState(p), completeness: completeness.get(p.id) ?? null })),
  };
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

  // Stock is overlaid live from the canonical inventory state, so `availability` (and the variant stock the page shows)
  // is never the cached copy's.
  const liveStock = new Map(
    (await prisma.productVariant.findMany({ where: { productId: product.id }, select: { id: true, stock: true } })).map((v) => [v.id, v.stock]),
  );
  const fresh = { ...product, variants: product.variants.map((v) => ({ ...v, stock: liveStock.get(v.id) ?? v.stock })) };
  const [presented] = await withStorefrontReadModel([fresh]);
  return presented;
}

/** Admin "test a search" (Catalog → Search synonyms): what a shopper's query expands to with the current synonym
 * groups, and which live products that finds — the same matching listStorefrontProducts uses, minus facets. */
export async function previewStorefrontSearch(query: string) {
  const terms = (await getSearchExpander()).expand(query);
  if (terms.length === 0) return { terms, total: 0, products: [] };
  const where = { isActive: true, deletedAt: null, ...buildFieldSearchOr(terms) };
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, select: { ...SUGGEST_SELECT, tags: true }, orderBy: { createdAt: "desc" }, take: RELEVANCE_CANDIDATE_CAP }),
  ]);
  const products = rows
    .map((p) => ({ p, score: computeRelevanceScore(p, query, terms) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ p }) => ({ id: p.id, name: p.name, slug: p.slug, imageUrl: p.images[0]?.url ?? null }));
  return { terms, total, products };
}

/** Storefront browsing: active products only, optionally scoped to a category (and its subcategories), searched, sorted. */
export async function listStorefrontProducts(query: StorefrontProductQuery) {
  const now = new Date();
  // Price sort/filter read the projection: make every row they read current first (freshness guard).
  if (PRICE_SORTS.has(query.sort) || query.minPrice !== undefined || query.maxPrice !== undefined) await ensureFreshReadModels(now);
  let categoryIds: string[] | undefined;
  if (query.category) {
    const category = await getCategoryBySlug(query.category);
    categoryIds = await getCategoryDescendantIds(category.id);
  }

  const searchTerms = query.search ? (await getSearchExpander()).expand(query.search) : [];
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
    // The price filter matches the canonical "from" price (what the card shows), not the stored base price.
    ...sellingPriceWhere({ gte: query.minPrice, lte: query.maxPrice }),
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
    // Tags aren't in the public select (they're admin data), so fetch them just for scoring.
    const tagRows = await prisma.product.findMany({ where: { id: { in: rawItems.map((p) => p.id) } }, select: { id: true, tags: true } });
    const tagsById = new Map(tagRows.map((r) => [r.id, r.tags]));
    const scored = rawItems
      // Array.prototype.sort is stable, and rawItems already arrived newest-first, so equal
      // scores keep that relative order — a free, sensible tie-break with no extra comparator.
      .map((item) => ({ item, score: query.search ? computeRelevanceScore({ ...item, tags: tagsById.get(item.id) }, query.search, searchTerms) : 0 }))
      .sort((a, b) => b.score - a.score);
    const start = (query.page - 1) * query.pageSize;
    pageRaw = scored.slice(start, start + query.pageSize).map((s) => s.item);
  }

  let items = await withStorefrontReadModel(pageRaw, now);
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
      const fallbackItems = await withStorefrontReadModel(fallbackRaw);
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
  await ensureFreshReadModels();
  let categoryIds: string[] | undefined;
  if (query.category) {
    const category = await getCategoryBySlug(query.category);
    categoryIds = await getCategoryDescendantIds(category.id);
  }

  const facetSearchTerms = query.search ? (await getSearchExpander()).expand(query.search) : [];

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
    // Bounds of the canonical "from" price across the scoped products — the same value the price filter matches.
    prisma.productReadModel.aggregate({ where: { product: where }, _min: { minSellingPrice: true }, _max: { minSellingPrice: true } }),
  ]);

  return {
    sizes: sizes.map((s) => s.size).sort(),
    colors: colors.map((c) => ({ color: c.color, colorHex: c.colorHex })).sort((a, b) => a.color.localeCompare(b.color)),
    minPrice: priceRange._min.minSellingPrice ? Number(priceRange._min.minSellingPrice) : 0,
    maxPrice: priceRange._max.minSellingPrice ? Number(priceRange._max.minSellingPrice) : 0,
  };
}

const SUGGEST_SELECT = {
  id: true,
  name: true,
  slug: true,
  basePrice: true,
  // compareAtPrice/variants feed the canonical display pricing (priceProductsForDisplay) for the suggestion's price.
  compareAtPrice: true,
  variants: { select: { id: true, price: true, compareAtPrice: true, isActive: true } },
  // description/brand/category/createdAt exist only to feed computeRelevanceScore below — never
  // sent to the client, see toSuggestionProduct's much narrower return shape.
  description: true,
  brand: true,
  category: { select: { name: true } },
  createdAt: true,
  tags: true,
  images: { orderBy: { sortOrder: "asc" as const }, take: 1, select: { url: true } },
};

const SUGGEST_CANDIDATE_CAP = 40;

/** `price` is the server-resolved "from" price (list → variant → live flash sale) — the same number the PDP shows. */
function toSuggestionProduct(
  p: { id: string; name: string; slug: string; basePrice: unknown; images: { url: string }[] },
  pricing: Map<string, ProductPricingDto>,
) {
  const price = pricing.get(p.id)?.from ?? Number(p.basePrice);
  return { id: p.id, name: p.name, slug: p.slug, price, imageUrl: p.images[0]?.url ?? null };
}

/** Typeahead dropdown data: a handful of matching products plus "prediction" query-completion
 * strings drawn from product names, category names, and past popular searches. Never logged —
 * only a real search-page navigation (via listStorefrontProducts) counts as a real search. */
export async function suggestSearch(query: string, limit = 6) {
  const searchTerms = (await getSearchExpander()).expand(query);
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

  const pricing = await priceProductsForDisplay(productRows);
  return { products: productRows.map((p) => toSuggestionProduct(p, pricing)), predictions, didYouMean };
}

const POPULAR_SEARCHES_CACHE_KEY = `${CACHE_PREFIX}popular-searches`;
const POPULAR_SEARCHES_TTL_SECONDS = 600;
const POPULAR_SEARCHES_LOOKBACK_DAYS = 30;

/** Top real search queries in the last 30 days, Redis-cached — one cache entry serves every
 * `limit` request since filtering to `limit` happens after the cached list is loaded. */
export async function getPopularSearches(limit = 8) {
  const cached = await cacheGet<string[]>(POPULAR_SEARCHES_CACHE_KEY);
  if (cached) return cached.slice(0, limit);

  // Business-time window + utcInstant: a bare bound Date against the naive-UTC column was 6 h off (METRICS_REGISTRY §1).
  const window = await resolveLegacyWindow(POPULAR_SEARCHES_LOOKBACK_DAYS);
  const rows = await prisma.$queryRaw<Array<{ query: string; count: bigint }>>`
    SELECT lower(query) AS query, COUNT(*)::bigint AS count
    FROM "SearchLog"
    WHERE "createdAt" >= ${utcInstant(window.startUtc)}
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
  return withStorefrontReadModel(ordered);
}

/** Same category, ranked by price-proximity to the target product — a lightweight stand-in for a
 * real similarity model that still gives a sensibly ordered result from data we actually have.
 * Pulls a bounded candidate pool (price-sorted both directions from the target) rather than every
 * active product in the category, so a large category doesn't turn this into a full-table scan. */
export async function getSimilarProducts(productId: string, limit = 8) {
  const target = await getTargetProductContext(productId);
  if (!target) return [];

  const candidatePoolSize = limit * 4;
  const baseWhere = { categoryId: target.categoryId, isActive: true, deletedAt: null, id: { not: productId } };
  const select = { ...PUBLIC_PRODUCT_SELECT, readModel: { select: { minSellingPrice: true } } };

  // Price proximity by the canonical selling price (projection), not the stored base price.
  const [cheaperOrEqual, pricier] = await Promise.all([
    prisma.product.findMany({
      where: { ...baseWhere, ...sellingPriceWhere({ lte: target.sellingPrice }) },
      select,
      orderBy: sellingPriceOrderBy("desc"),
      take: candidatePoolSize,
    }),
    prisma.product.findMany({
      where: { ...baseWhere, ...sellingPriceWhere({ gt: target.sellingPrice }) },
      select,
      orderBy: sellingPriceOrderBy("asc"),
      take: candidatePoolSize,
    }),
  ]);

  const distance = (p: { id: string; readModel: { minSellingPrice: unknown } | null }) => Math.abs(Number(p.readModel!.minSellingPrice) - target.sellingPrice);
  const candidates = [...cheaperOrEqual, ...pricier].sort((a, b) => distance(a) - distance(b) || (a.id < b.id ? -1 : 1));

  return withStorefrontReadModel(candidates.slice(0, limit).map(({ readModel: _projection, ...product }) => product));
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
                where: { variantId: { in: variantIds }, order: SALE_ORDER_WHERE },
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

  return withStorefrontReadModel(ranked.slice(0, limit));
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
    // Demand = units ordered on sale orders (docs/METRICS_REGISTRY.md `units_ordered`, P5-9) over N business days.
    const window = await resolveLegacyWindow(TRENDING_LOOKBACK_DAYS);
    const items = await prisma.orderItem.findMany({
      where: { order: { ...SALE_ORDER_WHERE, createdAt: { gte: window.startUtc, lt: window.endUtc } } },
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

  // The budget filter matches the canonical "from" price (live, the same number the card shows).
  const presented = await withStorefrontReadModel(pool);
  const filtered = presented.filter((p) => {
    const price = p.pricing.from;
    if (minPrice !== undefined && price < minPrice) return false;
    if (maxPrice !== undefined && price > maxPrice) return false;
    return true;
  });

  return filtered.slice(0, limit);
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

  return withStorefrontReadModel(items);
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

/** The product a price-relative rail is built around, with its canonical selling price from the (fresh) projection. */
async function getTargetProductContext(productId: string) {
  await ensureFreshReadModels();
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { categoryId: true, brandTier: true } });
  if (!product) return null;
  // A hidden/trashed target has no guarded row; project it on demand so its rails still have a reference price.
  let sellingPrice = await projectedSellingPrice(productId);
  if (sellingPrice === null) {
    await refreshReadModels([productId]);
    sellingPrice = await projectedSellingPrice(productId);
  }
  return sellingPrice === null ? null : { ...product, sellingPrice };
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
      ...sellingPriceWhere({ lt: target.sellingPrice }),
    },
    select: PUBLIC_PRODUCT_SELECT,
    orderBy: sellingPriceOrderBy("desc"),
    take: limit,
  });

  return withStorefrontReadModel(items);
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
      ...sellingPriceWhere({ gt: target.sellingPrice }),
    },
    select: PUBLIC_PRODUCT_SELECT,
    orderBy: sellingPriceOrderBy("asc"),
    take: limit,
  });

  return withStorefrontReadModel(items);
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
    orderBy: sellingPriceOrderBy("desc"),
    take: limit,
  });

  return withStorefrontReadModel(items);
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

/** Admin-only: how many units of a product sold in the last `days` days, in how many orders, and its lifetime page views.
 * Not cached (few readers). */
export async function getProductSalesSummary(productId: string, days = 7): Promise<ProductSalesSummary> {
  if (!(await prisma.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw AppError.notFound("Product not found");
  // Units ordered on sale orders over the last `days` business days — the registry's `units_ordered` (P5-9), the same
  // predicate and window mechanism as the storefront urgency line, so the two can never disagree.
  const window = await resolveLegacyWindow(days);
  const since = window.startUtc;
  const variantIds = (await prisma.productVariant.findMany({ where: { productId }, select: { id: true } })).map((v) => v.id);
  const items = variantIds.length
    ? await prisma.orderItem.findMany({
        where: { variantId: { in: variantIds }, order: { ...SALE_ORDER_WHERE, createdAt: { gte: since, lt: window.endUtc } } },
        select: { orderId: true, variantId: true, quantity: true, skuSnapshot: true, sizeSnapshot: true, colorSnapshot: true },
      })
    : [];

  const byVariant = new Map<string, ProductSalesSummary["byVariant"][number]>();
  for (const i of items) {
    const row = byVariant.get(i.variantId) ?? { variantId: i.variantId, sku: i.skuSnapshot, size: i.sizeSnapshot, color: i.colorSnapshot, units: 0 };
    row.units += i.quantity;
    byVariant.set(i.variantId, row);
  }
  return {
    productId,
    days,
    since: since.toISOString(),
    // Views are the shop's own figure — shown to admins only, never to shoppers.
    totalViews: await prisma.productViewLog.count({ where: { productId } }),
    unitsSold: items.reduce((sum, i) => sum + i.quantity, 0),
    orders: new Set(items.map((i) => i.orderId)).size,
    byVariant: [...byVariant.values()].sort((a, b) => b.units - a.units),
  };
}

export async function getUrgencySignals(productId: string) {
  // Public: only the yes/no "selling fast" flag. View and sales counts are admin-only (getProductSalesSummary). v3 key so
  // no cached older copy (which still carried the counts) is ever served.
  const cacheKey = `${CACHE_PREFIX}urgency:v3:${productId}`;
  const cached = await cacheGet<UrgencySignals>(cacheKey);
  if (cached) return cached;

  const week = await resolveLegacyWindow(7);

  const variantIds = (await prisma.productVariant.findMany({ where: { productId }, select: { id: true } })).map(
    (v) => v.id,
  );

  const [weekOrderItems, stockAgg] = await Promise.all([
    variantIds.length
      ? prisma.orderItem.findMany({
          where: {
            variantId: { in: variantIds },
            order: { ...SALE_ORDER_WHERE, createdAt: { gte: week.startUtc, lt: week.endUtc } },
          },
          select: { quantity: true },
        })
      : [],
    prisma.productVariant.aggregate({ where: { productId }, _sum: { stock: true } }),
  ]);

  const unitsSoldLast7Days = weekOrderItems.reduce((sum, i) => sum + i.quantity, 0);
  const stock = stockAgg._sum.stock ?? 0;
  const signals: UrgencySignals = { isFastSelling: stock > 0 && unitsSoldLast7Days >= stock };

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

export async function createProduct(
  input: CreateProductInput,
  adminId: string,
  ip?: string,
  options: { stockReason?: "RESTOCK" | "IMPORT" } = {},
) {
  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!category || category.deletedAt) throw AppError.badRequest("Category does not exist");

  if (findDuplicateSkus(input.variants.map((v) => v.sku)).size) throw AppError.badRequest("Duplicate SKU in variants");

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

      // Opening stock: each variant was created at 0; its initial quantity lands through the inventory service as an
      // opening RESTOCK (or IMPORT from a CSV) movement, so the ledger accounts for stock from the moment it exists.
      const stockBySku = new Map(variants.map((v) => [v.sku, v.stock ?? 0]));
      for (const v of created.variants) {
        await recordInitialStock(tx, v.id, stockBySku.get(v.sku) ?? 0, options.stockReason ?? "RESTOCK", {
          adminId,
          note: options.stockReason === "IMPORT" ? "Initial stock from CSV import" : "Initial stock on product creation",
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

  await invalidateCache({ productId: product.id, slug: product.slug });
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

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
  adminId: string,
  ip?: string,
  // `stockMode: "count"` (CSV import) treats a variant's stock as a declared count; the default treats it as a
  // compare-and-set edit against `expectedStock` (docs/INVENTORY_INVARIANTS.md rule 6).
  options: { stockNote?: string; stockMode?: "form" | "count" } = {},
) {
  const replenished: string[] = [];
  const existing = await getProductById(id);
  // Same rule as create, checked up front: otherwise two rows sharing a SKU only fail at the DB unique index, as a
  // generic conflict that doesn't say which rows clash. A row listed by id without a SKU keeps its stored one.
  if (input.variants) {
    const resultingSkus = input.variants.map((v) => v.sku ?? existing.variants.find((e) => e.id === v.id)?.sku);
    if (findDuplicateSkus(resultingSkus).size) throw AppError.badRequest("Duplicate SKU in variants");
  }

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
  // A variant listed by id without its size or colour keeps the stored one, so it is judged as it will be saved.
  const variantsToCheck = input.variants?.map((v) => {
    const before = v.id ? existing.variants.find((e) => e.id === v.id) : undefined;
    return { size: v.size ?? before?.size, color: v.color ?? before?.color };
  });
  throwIfInvalid(
    validateProductAgainstConfig(
      { attributes: attributesTouched ? mergedAttributes : undefined, variants: variantsToCheck },
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
  } else if (input.slug) {
    // `data.slug` already carries this from `...rest` above — unlike the name-derived branch, nothing had
    // checked it for a collision. Fail fast with a clean conflict instead of leaning on the P2002 catch below.
    const candidate = slugify(input.slug);
    if (await prisma.product.findFirst({ where: { slug: candidate, NOT: { id } } })) {
      throw AppError.conflict("A product with this slug already exists");
    }
    data.slug = candidate;
  }
  // A product that was already live keeps working at its old URL: redirect it to the new one. A product
  // that was never published had nothing to protect (nobody could have bookmarked or indexed the old slug).
  const newSlug = typeof data.slug === "string" ? data.slug : undefined;
  const slugRedirect = newSlug && newSlug !== existing.slug && existing.status === "PUBLISHED"
    ? { from: `/product/${existing.slug}`, to: `/product/${newSlug}` }
    : null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data });
      if (slugRedirect) await upsertSlugRedirect(tx, slugRedirect.from, slugRedirect.to);
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
            await zeroVariantStock(tx, mustKeep, { adminId, note: "Variant removed from product — had order history, stock zeroed instead of deleted" });
          }
        }

        for (const [index, variant] of input.variants.entries()) {
          if (variant.id) {
            const { id: variantId, attributeValueIds, imageIds, stock: desiredStock, expectedStock, ...updateData } = variant;
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
            // Option links are replaced only when the payload carries them; leaving them out keeps the stored ones.
            if (attributeValueIds !== undefined) {
              await tx.variantAttributeValue.deleteMany({ where: { variantId } });
              if (attributeValueIds.length) {
                await tx.variantAttributeValue.createMany({
                  data: attributeValueIds.map((attributeValueId) => ({ variantId, attributeValueId })),
                });
              }
            }
            // Stock is never overwritten here: a form edit is a compare-and-set against what the editor last saw, a
            // CSV import is a declared count — both applied by the inventory service under a row lock, ledger-complete.
            if (desiredStock !== undefined) {
              const actor = { adminId, note: options.stockNote ?? (options.stockMode === "count" ? "Changed by CSV import" : "Manual edit via product form") };
              const delta =
                options.stockMode === "count"
                  ? await setVariantStockCount(tx, variantId, desiredStock, "IMPORT", actor)
                  : await setVariantStockFromForm(tx, variantId, desiredStock, expectedStock, actor);
              if (delta > 0 && desiredStock - delta <= 0) replenished.push(variantId);
            }
          } else {
            const created = await tx.productVariant.create({
              data: { ...toVariantCreateData({ ...variant, sku: variant.sku!, stock: variant.stock ?? 0, attributeValueIds: variant.attributeValueIds ?? [] }, index), productId: id },
            });
            if (variant.imageIds?.length) await syncVariantGallery(tx, id, created.id, variant.imageIds);
            await recordInitialStock(tx, created.id, variant.stock ?? 0, options.stockMode === "count" ? "IMPORT" : "RESTOCK", {
              adminId,
              note: "Initial stock on variant creation",
            });
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

  await invalidateCache({ productId: id, slug: newSlug ?? existing.slug, previousSlug: newSlug && newSlug !== existing.slug ? existing.slug : undefined });

  // Fire-and-forget: real stock/price changes trigger real customer notifications — never
  // allowed to block or fail the admin's product save.
  notifyReplenished(replenished);
  if (input.basePrice !== undefined && input.basePrice < Number(existing.basePrice)) {
    notifyPriceDrop(id, input.basePrice).catch((err) => captureError(err, { msg: "[price-drop] notify failed:" }));
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
  const existing = await getProductById(id);
  await prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
  await invalidateCache({ productId: id, slug: existing.slug });
}

export async function restoreProduct(id: string) {
  const existing = await getProductById(id);
  await prisma.product.update({ where: { id }, data: { deletedAt: null } });
  await invalidateCache({ productId: id, slug: existing.slug });
  return getProductById(id);
}

/** Removes an image's files from disk — unless another image row still uses the same URL (call this after the row is gone).
 * Duplicating a product copies files rather than sharing them, so this is a guard, not the usual path. */
async function removeImageFilesIfUnused(urls: string[]) {
  for (const url of new Set(urls)) {
    if ((await prisma.productImage.count({ where: { url } })) === 0) await deleteProductImageFiles(url);
  }
}

/** Irreversible — only meaningful for a product already in Trash. */
export async function permanentlyDeleteProduct(id: string) {
  const product = await getProductById(id);
  if (!product.deletedAt) throw AppError.badRequest("Move the product to Trash before deleting it permanently");
  await prisma.product.delete({ where: { id } });
  await removeImageFilesIfUnused(product.images.map((img) => img.url));
  // The row is gone by now — pass the slug directly (this is the one call site resolveSlugs() can't help).
  await invalidateCache({ productId: id, slug: product.slug });
}

export async function bulkDeleteProducts(ids: string[]) {
  await prisma.product.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
  await invalidateCache({ productIds: ids });
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
    await invalidateCache({ productIds: movable.map((r) => r.id) });
  }
  return { updated: movable.length, unchanged: rows.length - movable.length - blocked.length, blocked };
}

export async function bulkUpdateProductCategory(ids: string[], categoryId: string) {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.deletedAt) throw AppError.badRequest("Category does not exist");
  await prisma.product.updateMany({ where: { id: { in: ids } }, data: { categoryId } });
  await invalidateCache({ productIds: ids });
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
  await invalidateCache({ productId });
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
  await removeImageFilesIfUnused([image.url]);
  await invalidateCache({ productId });
}

export async function updateProductImage(productId: string, imageId: string, input: { altText?: string; caption?: string | null }) {
  const image = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (!image || image.productId !== productId) throw AppError.notFound("Image not found");
  await prisma.productImage.update({ where: { id: imageId }, data: input });
  await invalidateCache({ productId });
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
  await invalidateCache({ productId });
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
  const [withFlash] = await withStorefrontReadModel([await presentProduct(row)]);
  return { ...withFlash, previewStatus: row.status };
}
