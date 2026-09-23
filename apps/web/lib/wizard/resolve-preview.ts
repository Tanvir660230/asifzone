import {
  buildCareView,
  buildResolvedView,
  NO_SIZE_VALUE,
  slugify,
  toPublicSections,
  type Category,
  type CreateProductInput,
  type Product,
  type ProductImage,
  type ProductVariant,
  type ResolvedSection,
  type ResolvedTypeConfig,
} from "@clothing-brand/shared";

/** Reference data the wizard already has loaded for its own editors — nothing here is fetched just for the preview. */
export interface PreviewReferenceData {
  config: ResolvedTypeConfig | null;
  resolvedSections: ResolvedSection[];
  categories: Category[];
  careGuides: { id: string; name: string; steps: string[] }[];
  materials: { id: string; name: string }[];
}

const money = (value: unknown): string | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? String(n) : null;
};

/** An empty `<input type="date" valueAsDate>` yields an Invalid Date, not undefined — calling toISOString() on it throws. */
const isoDate = (value: unknown): string | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Turns unsaved wizard values into the `Product` shape the storefront renders, using the same shared resolution the
 * API uses for a saved product (buildResolvedView / buildCareView / toPublicSections) — the preview can't drift from
 * the real page because it isn't a reimplementation of it. What it can't know without a save (reviews, flash sales,
 * automatic recommendations) comes from the saved product when there is one, else is empty. */
export function resolvePreviewProduct(
  values: Partial<CreateProductInput>,
  ref: PreviewReferenceData,
  base: { initial?: Product; images: ProductImage[] },
): Product {
  const { initial } = base;
  const id = initial?.id ?? "preview";
  const name = values.name?.trim() || "Untitled product";
  const attributes = (values.attributes ?? {}) as Record<string, unknown>;

  const carePreset = values.carePresetId ? ref.careGuides.find((c) => c.id === values.carePresetId) : undefined;
  const materialName = new Map(ref.materials.map((m) => [m.id, m.name]));
  const resolved = buildResolvedView(ref.config, attributes, {
    care: buildCareView({ careOverride: values.careOverride ?? null, carePreset: carePreset ? { name: carePreset.name, steps: carePreset.steps } : null }, ref.config),
    materials: (values.materials ?? [])
      .filter((m) => m?.materialId || m?.customName)
      .map((m) => ({ name: (m.materialId ? materialName.get(m.materialId) : m.customName) ?? "", percentage: m.percentage ?? null })),
    sections: toPublicSections(ref.resolvedSections),
    faqs: (values.faqs ?? []).filter((f) => f?.question?.trim()).map((f) => ({ question: f.question, answer: f.answer ?? "" })),
  });

  const variants: ProductVariant[] = (values.variants ?? [])
    // The storefront never shows a switched-off variant.
    .filter((v) => v && v.isActive !== false)
    .map((v, i) => ({
      id: v.id ?? `preview-variant-${i}`,
      productId: id,
      sku: v.sku ?? "",
      barcode: v.barcode ?? null,
      // What the API stores for a type without a size dimension (or a blank one) — the pickers treat it as "no choice".
      size: v.size?.trim() || NO_SIZE_VALUE,
      sizeLabel: v.sizeLabel ?? null,
      color: v.color?.trim() || "",
      colorHex: v.colorHex ?? null,
      price: money(v.price),
      compareAtPrice: money(v.compareAtPrice),
      costPrice: money(v.costPrice),
      stock: Number.isFinite(v.stock) ? (v.stock as number) : 0,
      weight: money(v.weight),
      isActive: true,
      imageId: v.imageIds?.[0] ?? v.imageId ?? null,
      images: (v.imageIds ?? []).map((imageId, sortOrder) => ({ imageId, sortOrder })),
      sortOrder: i,
      attributeValues: [],
    }));

  const category = ref.categories.find((c) => c.id === values.categoryId) ?? initial?.category;
  const now = new Date().toISOString();

  return {
    id,
    name,
    slug: values.slug || initial?.slug || slugify(name) || "product",
    description: values.description ?? "",
    shortDescription: values.shortDescription ?? null,
    sortOrder: values.sortOrder ?? 0,
    categoryId: values.categoryId ?? "",
    category: category ?? ({ id: "", name: "Category", slug: "", parentId: null } as Category),
    productType: initial?.productType ?? "CUSTOM",
    typeId: values.typeId || null,
    attributes,
    brand: values.brand ?? null,
    brandTier: values.brandTier ?? "PREMIUM",
    basePrice: money(values.basePrice) ?? "0",
    compareAtPrice: money(values.compareAtPrice),
    costPrice: money(values.costPrice),
    taxRate: money(values.taxRate),
    trackInventory: values.trackInventory ?? true,
    lowStockThreshold: values.lowStockThreshold ?? 5,
    restockDate: isoDate(values.restockDate),
    isActive: initial?.isActive ?? false,
    status: initial?.status ?? "DRAFT",
    isFeatured: values.isFeatured ?? false,
    seoTitle: values.seoTitle ?? null,
    seoDescription: values.seoDescription ?? null,
    ogTitle: values.ogTitle ?? null,
    ogDescription: values.ogDescription ?? null,
    ogImageUrl: values.ogImageUrl ?? null,
    canonicalUrl: values.canonicalUrl ?? null,
    deletedAt: null,
    variants,
    images: base.images,
    resolved,
    activeFlashSale: initial?.activeFlashSale ?? null,
    avgRating: initial?.avgRating ?? 0,
    reviewCount: initial?.reviewCount ?? 0,
    createdAt: initial?.createdAt ?? now,
    updatedAt: now,
  };
}
