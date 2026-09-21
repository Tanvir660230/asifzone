/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useForm, Controller, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import {
  computeCompleteness,
  createProductSchema,
  validateProductAgainstConfig,
  type Category,
  type CreateProductInput,
  type Product,
  type ProductStatus,
  type ResolvedTypeConfig,
} from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/admin/form-section";
import { VariantEditor } from "./variant-editor";
import { SizeGuideEditor } from "./size-guide-editor";
import { AttributeFields } from "./attribute-fields";
import { CareMaterialSection } from "./care-material-section";
import { ProductHistory } from "./product-history";
import { ProductStatusPanel, type FixTarget } from "./product-status-panel";
import { stripHtml } from "@/lib/format";
import { slugify } from "@clothing-brand/shared";
import type { StagedImage } from "./image-uploader";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "basic", label: "Basic Info" },
  { value: "pricing", label: "Pricing & Inventory" },
  { value: "variants", label: "Variants" },
  { value: "care", label: "Care & Material" },
  { value: "seo", label: "SEO" },
  { value: "history", label: "History" },
] as const;
type ProductFormTab = (typeof TABS)[number]["value"];

/** Flattens the category tree into a top-level-first, indented option list (e.g. "— Cap" under
 * "Accessories") so the admin can see hierarchy in a single-select dropdown without a second field. */
function buildCategoryOptions(categories: Category[]) {
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const key = c.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  for (const group of byParent.values()) {
    group.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  const options: { id: string; label: string }[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const c of byParent.get(parentId) ?? []) {
      options.push({ id: c.id, label: `${"— ".repeat(depth)}${c.name}` });
      walk(c.id, depth + 1);
    }
  }
  walk(null, 0);
  return options;
}

// Tiptap + its ~9 sub-packages are large and admin-only — split out of the main bundle and
// only fetched once this form actually renders.
const RichTextEditor = dynamic(
  () => import("@/components/admin/rich-text-editor").then((m) => m.RichTextEditor),
  { ssr: false },
);
import * as attributesApi from "@/lib/api/attributes";
import * as catalogApi from "@/lib/api/catalog";

/** Sets `value` at a nested path, creating containers as needed — used to add template-validation errors
 * next to the ones zod already produced, in the shape react-hook-form reads them (errors.attributes.fit). */
function setNestedError(target: Record<string, any>, path: (string | number)[], value: unknown) {
  let node = target;
  path.slice(0, -1).forEach((key) => {
    node[key] ??= {};
    node = node[key];
  });
  node[path[path.length - 1]!] = value;
}

/** zod checks the payload's shape; the product type's template (fetched, so it can be data) adds the rules
 * zod can't know — required attributes, option lists, per-type variant dimensions. */
function buildResolver(getConfig: () => ResolvedTypeConfig | undefined): Resolver<CreateProductInput> {
  const zod = zodResolver(createProductSchema);
  return async (values, context, options) => {
    const result = await zod(values, context, options);
    const config = getConfig();
    const issues = config
      ? validateProductAgainstConfig({ attributes: values.attributes, variants: values.variants }, config)
      : [{ path: ["typeId"], message: "Select a product type" }];
    if (issues.length === 0) return result;

    const errors: Record<string, any> = "errors" in result ? { ...(result.errors as object) } : {};
    for (const issue of issues) setNestedError(errors, issue.path, { type: "validate", message: issue.message });
    return { values: {}, errors } as never;
  };
}

/** Keeps only the attribute keys the server will accept: the selected type's fields, the size guide, and
 * legacy keys this product already had that no type defines. Fields of the type it just left are dropped
 * from the payload on purpose — the server keeps those values (hidden), so switching back restores them. */
function pruneAttributes(
  attributes: Record<string, unknown> | null | undefined,
  config: ResolvedTypeConfig,
  allFieldKeys: Set<string>,
  initialKeys: Set<string>,
) {
  const fieldKeys = new Set(config.fields.map((f) => f.key));
  return Object.fromEntries(
    Object.entries(attributes ?? {}).filter(
      ([key]) => fieldKeys.has(key) || key === "sizeGuide" || (initialKeys.has(key) && !allFieldKeys.has(key)),
    ),
  );
}

import { uploadEditorImage } from "@/lib/api/uploads";
import * as aiApi from "@/lib/api/ai";
import { ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

function AiGenerateButton({ onGenerate, disabled }: { onGenerate: () => Promise<string>; disabled?: boolean }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await onGenerate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "AI generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      className="inline-flex items-center gap-1 text-xs text-brass-600 hover:text-brass-700 disabled:opacity-50"
    >
      <Sparkles size={12} /> {loading ? "Generating…" : "Generate with AI"}
    </button>
  );
}

interface ProductFormProps {
  categories: Category[];
  initial?: Product;
  onSubmit: (values: CreateProductInput) => Promise<void>;
  submitLabel?: string;
  /** Only relevant while creating a new product — see VariantEditorProps for why these exist. */
  stagedImages?: StagedImage[];
  variantImageKeys?: Record<number, string>;
  onVariantImageKeyChange?: (index: number, key: string) => void;
}

export function ProductForm({
  categories,
  initial,
  onSubmit,
  submitLabel = "Save product",
  stagedImages,
  variantImageKeys,
  onVariantImageKeyChange,
}: ProductFormProps) {
  const [tab, setTab] = useState<ProductFormTab>("basic");
  // Includes archived types so a product already on one still shows it; they're just not offered for new choices.
  const { data: typesData } = useQuery({ queryKey: ["catalog-types", "all"], queryFn: () => catalogApi.listTypes(true) });
  const types = useMemo(() => typesData?.types ?? [], [typesData]);
  const { data: attributesData } = useQuery({ queryKey: ["attributes"], queryFn: attributesApi.listAttributes });
  const attributes = attributesData?.attributes ?? [];
  const categoryOptions = buildCategoryOptions(categories);

  const { data: aiStatus } = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.getAiStatus });
  // AI generation is OWNER-only on the backend (it bills real API usage) — hide the entry points
  // for STAFF rather than showing a button that always 403s.
  const { data: currentAdmin } = useCurrentAdmin();
  const canUseAi = aiStatus?.configured && currentAdmin?.admin.role === "OWNER";

  const selectedConfigRef = useRef<ResolvedTypeConfig | undefined>(undefined);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateProductInput>({
    resolver: buildResolver(() => selectedConfigRef.current),
    defaultValues: initial
      ? {
          name: initial.name,
          slug: initial.slug,
          description: initial.description,
          shortDescription: initial.shortDescription,
          sortOrder: initial.sortOrder,
          categoryId: initial.categoryId,
          // Without these the form would re-submit a default type and blank spec fields, so saving
          // any edit would reset the product's type and wipe its attributes.
          typeId: initial.typeId ?? initial.resolved?.type?.id ?? "",
          attributes: initial.attributes ?? {},
          brand: initial.brand,
          brandTier: initial.brandTier,
          basePrice: Number(initial.basePrice),
          compareAtPrice: initial.compareAtPrice ? Number(initial.compareAtPrice) : undefined,
          costPrice: initial.costPrice ? Number(initial.costPrice) : undefined,
          taxRate: initial.taxRate ? Number(initial.taxRate) : undefined,
          trackInventory: initial.trackInventory,
          lowStockThreshold: initial.lowStockThreshold,
          isFeatured: initial.isFeatured,
          seoTitle: initial.seoTitle,
          seoDescription: initial.seoDescription,
          focusKeyword: initial.focusKeyword,
          ogTitle: initial.ogTitle,
          ogDescription: initial.ogDescription,
          ogImageUrl: initial.ogImageUrl,
          canonicalUrl: initial.canonicalUrl,
          carePresetId: initial.carePresetId ?? "",
          careOverride: initial.careOverride ?? [],
          materials: initial.materials ?? [],
          variants: initial.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            barcode: v.barcode,
            size: v.size,
            sizeLabel: v.sizeLabel,
            color: v.color,
            colorHex: v.colorHex,
            price: v.price ? Number(v.price) : undefined,
            compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : undefined,
            costPrice: v.costPrice ? Number(v.costPrice) : undefined,
            stock: v.stock,
            weight: v.weight ? Number(v.weight) : undefined,
            isActive: v.isActive ?? true,
            imageId: v.imageId,
            // The variant's own gallery, in order (falling back to its single legacy image).
            imageIds: v.images?.length ? [...v.images].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.imageId) : v.imageId ? [v.imageId] : [],
            attributeValueIds: (v.attributeValues ?? []).map((av) => av.attributeValueId),
          })),
        }
      : {
          typeId: "",
          attributes: {},
          brandTier: "PREMIUM",
          isFeatured: false,
          carePresetId: "",
          careOverride: [],
          materials: [],
          trackInventory: true,
          lowStockThreshold: 5,
          sortOrder: 0,
          variants: [{ sku: "", size: "", color: "", stock: 0, isActive: true, attributeValueIds: [] }],
        },
  });

  const typeId = watch("typeId");
  const selectedConfig = types.find((t) => t.typeId === typeId);
  selectedConfigRef.current = selectedConfig;
  const allFieldKeys = new Set(types.flatMap((t) => t.fields.map((f) => f.key)));
  const initialAttributeKeys = new Set(Object.keys(initial?.attributes ?? {}));

  // A new product starts on the first active type (Clothing, unless an admin reordered them).
  useEffect(() => {
    if (!initial && !typeId) {
      const first = types.find((t) => t.isActive);
      if (first) setValue("typeId", first.typeId);
    }
  }, [initial, typeId, types, setValue]);

  // Live completeness from what's in the form right now — the very function the server gates publishing with.
  const live = watch();
  const savedSizeGuide = (live.attributes as Record<string, any> | null | undefined)?.sizeGuide;
  const completeness = computeCompleteness(
    {
      name: live.name,
      categoryId: live.categoryId,
      basePrice: live.basePrice,
      description: live.description,
      seoDescription: live.seoDescription,
      trackInventory: live.trackInventory,
      variants: live.variants ?? [],
      // Images live outside this form: saved ones on the edit page, staged ones (uploaded after create) on the new page.
      imageCount: initial ? initial.images.length : (stagedImages?.length ?? 0),
      attributes: live.attributes,
      materialCount: (live.materials ?? []).filter((m) => m?.materialId || m?.customName).length,
      hasCare: (live.careOverride?.length ?? 0) > 0 || Boolean(live.carePresetId) || (selectedConfig?.care.steps.length ?? 0) > 0,
      sizeGuideShown:
        !selectedConfig || selectedConfig.sizeGuide.mode === "NOT_APPLICABLE"
          ? null
          : savedSizeGuide
            ? savedSizeGuide.enabled === true
            : selectedConfig.sizeGuide.mode === "ON_BY_DEFAULT",
    },
    selectedConfig ?? null,
  );

  /** `status` undefined = save without changing it. A new product is always created as a draft: its images are
   * uploaded after it exists, and publishing needs at least one. */
  function submitWith(status?: ProductStatus) {
    return handleSubmit((values) => {
      const withAttributes = selectedConfig
        ? { ...values, attributes: pruneAttributes(values.attributes, selectedConfig, allFieldKeys, initialAttributeKeys) }
        : values;
      return onSubmit({ ...withAttributes, ...(initial ? (status ? { status } : {}) : { status: "DRAFT" as const }) });
    })();
  }

  function jumpToFix(target: FixTarget) {
    if (target === "images") window.scrollTo({ top: 0, behavior: "smooth" });
    else setTab(target);
  }

  const basePrice = watch("basePrice");
  const costPrice = watch("costPrice");
  const margin =
    basePrice && costPrice && basePrice > 0 ? (((basePrice - costPrice) / basePrice) * 100).toFixed(1) : null;

  const productName = watch("name");
  const siteOrigin = typeof window === "undefined" ? "" : window.location.origin;
  const seoTitleText = watch("seoTitle") || productName || "";
  const defaultMeta = stripHtml(watch("shortDescription") || watch("description") || "").slice(0, 160);
  const metaText = watch("seoDescription") || defaultMeta;
  const slugText = watch("slug") || initial?.slug || slugify(productName ?? "");
  const keyword = (watch("focusKeyword") ?? "").trim().toLowerCase();
  const categoryName = categories.find((c) => c.id === watch("categoryId"))?.name;
  const brandName = watch("brand");
  const aiProductContext = { productName: productName || undefined, category: categoryName, brand: brandName ?? undefined };

  const TAB_FIELDS: Record<ProductFormTab, string[]> = {
    basic: ["name", "categoryId", "typeId", "attributes", "brand", "brandTier", "sortOrder", "shortDescription", "description"],
    pricing: ["basePrice", "compareAtPrice", "costPrice", "taxRate", "trackInventory", "lowStockThreshold", "restockDate"],
    variants: ["variants"],
    care: ["carePresetId", "careOverride", "materials"],
    seo: ["slug", "seoTitle", "seoDescription", "focusKeyword", "ogTitle", "ogDescription", "ogImageUrl", "canonicalUrl"],
    history: [],
  };
  const visibleTabs = TABS.filter((t) => t.value !== "history" || initial);
  const tabHasError = (t: ProductFormTab) => TAB_FIELDS[t].some((f) => f in errors);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitWith();
      }}
      className="space-y-6"
    >
      <ProductStatusPanel
        status={initial?.status ?? null}
        result={completeness}
        createLabel={submitLabel}
        busy={isSubmitting}
        onAction={(status) => submitWith(status)}
        onFix={jumpToFix}
      />

      <div className="mb-2 flex flex-wrap gap-1 border-b border-ink-100">
        {visibleTabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-150 ease-smooth",
              tab === t.value ? "border-ink-900 text-ink-900" : "border-transparent text-ink-400 hover:text-ink-700",
            )}
          >
            {t.label}
            {tabHasError(t.value) && <span className="h-1.5 w-1.5 rounded-full bg-danger-500" aria-label="Has errors" />}
          </button>
        ))}
      </div>

      {tab === "basic" && (
        <>
          <FormSection title="Basic information">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="name">Product name</Label>
                <Input id="name" {...register("name")} />
                {errors.name && <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>}
              </div>

              <div>
                <Label htmlFor="categoryId">Category</Label>
                <Select id="categoryId" {...register("categoryId")}>
                  <option value="">Select a category…</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                {errors.categoryId && <p className="mt-1 text-xs text-danger-600">{errors.categoryId.message}</p>}
              </div>

              <div>
                <Label htmlFor="typeId">Product type</Label>
                {/* Controlled on purpose: the options arrive after the form mounts, and an uncontrolled
                    select registered before then keeps the browser's "first option" instead of the
                    product's saved type. */}
                <Controller
                  control={control}
                  name="typeId"
                  render={({ field }) => (
                    <Select id="typeId" ref={field.ref} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur}>
                      {types.length === 0 && <option value="">Loading types…</option>}
                      {types
                        .filter((t) => t.isActive || t.typeId === typeId)
                        .map((t) => (
                          <option key={t.typeId} value={t.typeId}>
                            {t.name}
                            {t.isActive ? "" : " (archived)"}
                          </option>
                        ))}
                    </Select>
                  )}
                />
                {selectedConfig?.description && <p className="mt-1 text-xs text-ink-400">{selectedConfig.description}</p>}
                {initial && typeId && typeId !== initial.typeId && (
                  <p className="mt-1 text-xs text-brass-700">
                    Changing the type changes which fields appear. Values for fields the new type doesn&rsquo;t have are kept and come back if you switch back.
                  </p>
                )}
                {errors.typeId && <p className="mt-1 text-xs text-danger-600">{errors.typeId.message}</p>}
              </div>

              <div>
                <Label htmlFor="brand">Brand</Label>
                <Input id="brand" placeholder="e.g. Asif Zone Originals" {...register("brand")} />
              </div>

              <div>
                <Label htmlFor="brandTier">Tier</Label>
                <Select id="brandTier" {...register("brandTier")}>
                  <option value="PREMIUM">Premium</option>
                  <option value="PLATINUM">Platinum</option>
                  <option value="LUXURY">Luxury</option>
                </Select>
              </div>

              <div>
                <Label htmlFor="sortOrder">Sort order</Label>
                <Input id="sortOrder" type="number" {...register("sortOrder", { valueAsNumber: true })} />
                <p className="mt-1 text-xs text-ink-400">Lower numbers appear first within their category.</p>
              </div>

              <div className="flex items-end gap-6 pb-2">
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <Checkbox {...register("isFeatured")} />
                  Featured
                </label>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="shortDescription">Short description</Label>
                <Textarea
                  id="shortDescription"
                  rows={2}
                  placeholder="One or two lines shown in listings and previews"
                  {...register("shortDescription")}
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <Label>Description</Label>
                {canUseAi && (
                  <AiGenerateButton
                    disabled={!productName}
                    onGenerate={async () => {
                      const { text } = await aiApi.generateAiContent({ type: "product_description", ...aiProductContext });
                      setValue(
                        "description",
                        text
                          .split(/\n{2,}/)
                          .map((p) => `<p>${p.trim()}</p>`)
                          .join(""),
                        { shouldDirty: true },
                      );
                      return text;
                    }}
                  />
                )}
              </div>
              <Controller
                control={control}
                name="description"
                render={({ field }) => (
                  <RichTextEditor value={field.value ?? ""} onChange={field.onChange} uploadImage={uploadEditorImage} />
                )}
              />
            </div>
          </FormSection>
          {selectedConfig && (
            <>
              <AttributeFields
                fields={selectedConfig.fields}
                control={control}
                errors={errors}
                title={`${selectedConfig.name} details`}
                description={selectedConfig.description ?? undefined}
              />
              <SizeGuideEditor typeName={selectedConfig.name} sizeGuide={selectedConfig.sizeGuide} watch={watch} setValue={setValue} />
            </>
          )}
        </>
      )}

      {tab === "pricing" && (
      <>
      <FormSection title="Pricing & tax">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="basePrice">Base price (BDT)</Label>
            <Input id="basePrice" type="number" step="0.01" {...register("basePrice", { valueAsNumber: true })} />
            {errors.basePrice && <p className="mt-1 text-xs text-danger-600">{errors.basePrice.message}</p>}
          </div>

          <div>
            <Label htmlFor="compareAtPrice">Compare-at price</Label>
            <Input id="compareAtPrice" type="number" step="0.01" placeholder="Optional" {...register("compareAtPrice", { valueAsNumber: true })} />
          </div>

          <div>
            <Label htmlFor="costPrice">Cost price</Label>
            <Input id="costPrice" type="number" step="0.01" placeholder="Optional" {...register("costPrice", { valueAsNumber: true })} />
          </div>

          <div>
            <Label htmlFor="taxRate">Tax rate (%)</Label>
            <Input id="taxRate" type="number" step="0.01" placeholder="Optional" {...register("taxRate", { valueAsNumber: true })} />
          </div>
        </div>
        {margin && (
          <p className="text-xs text-ink-500">
            Estimated margin at base price: <span className="font-medium text-ink-800">{margin}%</span>
          </p>
        )}
      </FormSection>

      <FormSection title="Inventory" description="Controls stock tracking and the low-stock warning threshold.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 pt-6 text-sm text-ink-700">
            <Checkbox {...register("trackInventory")} />
            Track inventory for this product
          </label>
          <div>
            <Label htmlFor="lowStockThreshold">Low stock threshold</Label>
            <Input id="lowStockThreshold" type="number" {...register("lowStockThreshold", { valueAsNumber: true })} />
          </div>
          <div>
            <Label htmlFor="restockDate">Restock date</Label>
            <Input
              id="restockDate"
              type="date"
              defaultValue={initial?.restockDate ? initial.restockDate.slice(0, 10) : undefined}
              {...register("restockDate", { valueAsDate: true })}
            />
            <p className="mt-1 text-xs text-ink-400">
              Only shown to customers when set — leave blank if you don&rsquo;t have a real expected date.
            </p>
          </div>
        </div>
      </FormSection>
      </>
      )}

      {tab === "seo" && (
        <>
          <FormSection title="Search listing" description="How this product appears in search results. Leave a field blank to use the automatic default shown in grey — nothing here is overwritten for you.">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Label htmlFor="slug">URL slug</Label>
                <div className="flex items-center gap-1 text-sm text-ink-400">
                  <span className="shrink-0">/product/</span>
                  <Input id="slug" placeholder="auto-generated from the name" {...register("slug")} />
                </div>
                {errors.slug && <p className="mt-1 text-xs text-danger-600">{errors.slug.message as string}</p>}
                {initial && initial.status === "PUBLISHED" && (
                  <p className="mt-1 text-xs text-brass-700">This product is live — changing the slug changes its URL. Add a redirect from the old one under Settings → Redirects.</p>
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label htmlFor="seoTitle">SEO title</Label>
                  {canUseAi && (
                    <AiGenerateButton
                      disabled={!productName}
                      onGenerate={async () => {
                        const { text } = await aiApi.generateAiContent({ type: "seo_title", ...aiProductContext });
                        setValue("seoTitle", text, { shouldDirty: true });
                        return text;
                      }}
                    />
                  )}
                </div>
                <Input id="seoTitle" placeholder={productName || "Defaults to the product name"} {...register("seoTitle")} />
                <p className={cn("mt-1 text-xs", (watch("seoTitle") ?? "").length > 60 ? "text-brass-700" : "text-ink-400")}>{(watch("seoTitle") ?? "").length}/60 recommended</p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label htmlFor="seoDescription">Meta description</Label>
                  {canUseAi && (
                    <AiGenerateButton
                      disabled={!productName}
                      onGenerate={async () => {
                        const { text } = await aiApi.generateAiContent({ type: "meta_description", ...aiProductContext });
                        setValue("seoDescription", text, { shouldDirty: true });
                        return text;
                      }}
                    />
                  )}
                </div>
                <Textarea id="seoDescription" rows={2} placeholder={defaultMeta || "Shown in search results"} {...register("seoDescription")} />
                <p className={cn("mt-1 text-xs", (watch("seoDescription") ?? "").length > 160 ? "text-brass-700" : "text-ink-400")}>{(watch("seoDescription") ?? "").length}/160 recommended</p>
              </div>

              <div>
                <Label htmlFor="focusKeyword">Focus keyword</Label>
                <Input id="focusKeyword" placeholder="e.g. black cotton panjabi" {...register("focusKeyword")} />
                {keyword && (
                  <ul className="mt-1.5 space-y-0.5 text-xs" data-testid="keyword-checks">
                    {[
                      ["in the SEO title", (seoTitleText || "").toLowerCase().includes(keyword)],
                      ["in the meta description", (metaText || "").toLowerCase().includes(keyword)],
                      ["in the URL", (slugText || "").includes(keyword.replace(/\s+/g, "-"))],
                    ].map(([label, ok]) => (
                      <li key={label as string} className={ok ? "text-success-700" : "text-ink-400"}>
                        {ok ? "✓" : "○"} Keyword {ok ? "appears" : "not found"} {label as string}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-ink-100 bg-white p-4" data-testid="serp-preview">
              <p className="mb-2 text-xs uppercase tracking-wide text-ink-400">Search result preview</p>
              <p className="truncate text-lg text-blue-700">{(seoTitleText || "Untitled product").slice(0, 70)}</p>
              <p className="truncate text-xs text-success-700">{siteOrigin}/product/{slugText || "…"}</p>
              <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">{metaText || "No description — search engines will pick text from the page."}</p>
            </div>
          </FormSection>

          <FormSection title="Social sharing & canonical" description="Overrides for link previews and the canonical URL. Blank uses the defaults.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ogTitle">Social title</Label>
                <Input id="ogTitle" placeholder={seoTitleText || "Defaults to the SEO title"} {...register("ogTitle")} />
              </div>
              <div>
                <Label htmlFor="ogImageUrl">Social image URL</Label>
                <Input id="ogImageUrl" placeholder="Defaults to the product images" {...register("ogImageUrl")} />
                {errors.ogImageUrl && <p className="mt-1 text-xs text-danger-600">{errors.ogImageUrl.message as string}</p>}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="ogDescription">Social description</Label>
                <Textarea id="ogDescription" rows={2} placeholder={metaText || "Defaults to the meta description"} {...register("ogDescription")} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="canonicalUrl">Canonical URL</Label>
                <Input id="canonicalUrl" placeholder={`${siteOrigin}/product/${slugText || "…"}`} {...register("canonicalUrl")} />
                {errors.canonicalUrl && <p className="mt-1 text-xs text-danger-600">{errors.canonicalUrl.message as string}</p>}
                <p className="mt-1 text-xs text-ink-400">Only set this if another page is the &ldquo;main&rdquo; version of this product.</p>
              </div>
            </div>
          </FormSection>
        </>
      )}

      {tab === "care" && (
        <CareMaterialSection control={control} register={register} watch={watch} setValue={setValue} errors={errors} config={selectedConfig} />
      )}

      {tab === "history" && initial && <ProductHistory productId={initial.id} />}

      {tab === "variants" && (
      <FormSection title="Variants" description="Size, color, SKU, price override, and stock for each purchasable option.">
        <VariantEditor
          control={control}
          register={register}
          watch={watch}
          setValue={setValue}
          attributes={attributes}
          variantDimensions={selectedConfig?.variantDimensions}
          typeName={selectedConfig?.name}
          typeId={selectedConfig?.typeId}
          productImages={initial?.images ?? []}
          stagedImages={stagedImages}
          variantImageKeys={variantImageKeys}
          onVariantImageKeyChange={onVariantImageKeyChange}
          skuPrefix={(initial?.slug ?? watch("name") ?? "SKU").toString()}
        />
        {errors.variants && <p className="mt-1 text-xs text-danger-600">{errors.variants.message as string}</p>}
      </FormSection>
      )}

    </form>
  );
}
