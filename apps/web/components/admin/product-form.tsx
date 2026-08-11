"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import {
  createProductSchema,
  type Category,
  type CreateProductInput,
  type Product,
} from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/admin/form-section";
import { VariantEditor } from "./variant-editor";
import type { StagedImage } from "./image-uploader";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "basic", label: "Basic Info" },
  { value: "pricing", label: "Pricing & Inventory" },
  { value: "variants", label: "Variants" },
  { value: "seo", label: "SEO" },
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
  const { data: attributesData } = useQuery({ queryKey: ["attributes"], queryFn: attributesApi.listAttributes });
  const attributes = attributesData?.attributes ?? [];
  const categoryOptions = buildCategoryOptions(categories);

  const { data: aiStatus } = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.getAiStatus });
  // AI generation is OWNER-only on the backend (it bills real API usage) — hide the entry points
  // for STAFF rather than showing a button that always 403s.
  const { data: currentAdmin } = useCurrentAdmin();
  const canUseAi = aiStatus?.configured && currentAdmin?.admin.role === "OWNER";

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateProductInput>({
    resolver: zodResolver(createProductSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          slug: initial.slug,
          description: initial.description,
          shortDescription: initial.shortDescription,
          sortOrder: initial.sortOrder,
          categoryId: initial.categoryId,
          brand: initial.brand,
          brandTier: initial.brandTier,
          basePrice: Number(initial.basePrice),
          compareAtPrice: initial.compareAtPrice ? Number(initial.compareAtPrice) : undefined,
          costPrice: initial.costPrice ? Number(initial.costPrice) : undefined,
          taxRate: initial.taxRate ? Number(initial.taxRate) : undefined,
          trackInventory: initial.trackInventory,
          lowStockThreshold: initial.lowStockThreshold,
          isActive: initial.isActive,
          isFeatured: initial.isFeatured,
          seoTitle: initial.seoTitle,
          seoDescription: initial.seoDescription,
          variants: initial.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            barcode: v.barcode,
            size: v.size,
            sizeLabel: v.sizeLabel,
            color: v.color,
            colorHex: v.colorHex,
            price: v.price ? Number(v.price) : undefined,
            costPrice: v.costPrice ? Number(v.costPrice) : undefined,
            stock: v.stock,
            weight: v.weight ? Number(v.weight) : undefined,
            imageId: v.imageId,
            attributeValueIds: (v.attributeValues ?? []).map((av) => av.attributeValueId),
          })),
        }
      : {
          brandTier: "PREMIUM",
          isActive: true,
          isFeatured: false,
          trackInventory: true,
          lowStockThreshold: 5,
          sortOrder: 0,
          variants: [{ sku: "", size: "", color: "", stock: 0, attributeValueIds: [] }],
        },
  });

  const basePrice = watch("basePrice");
  const costPrice = watch("costPrice");
  const margin =
    basePrice && costPrice && basePrice > 0 ? (((basePrice - costPrice) / basePrice) * 100).toFixed(1) : null;

  const productName = watch("name");
  const categoryName = categories.find((c) => c.id === watch("categoryId"))?.name;
  const brandName = watch("brand");
  const aiProductContext = { productName: productName || undefined, category: categoryName, brand: brandName ?? undefined };

  const TAB_FIELDS: Record<ProductFormTab, string[]> = {
    basic: ["name", "categoryId", "brand", "brandTier", "sortOrder", "shortDescription", "description"],
    pricing: ["basePrice", "compareAtPrice", "costPrice", "taxRate", "trackInventory", "lowStockThreshold", "restockDate"],
    variants: ["variants"],
    seo: ["seoTitle", "seoDescription"],
  };
  const tabHasError = (t: ProductFormTab) => TAB_FIELDS[t].some((f) => f in errors);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="mb-2 flex flex-wrap gap-1 border-b border-ink-100">
        {TABS.map((t) => (
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
              <Checkbox {...register("isActive")} />
              Active
            </label>
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
      <FormSection title="SEO">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <Input id="seoTitle" placeholder="Defaults to product name" {...register("seoTitle")} />
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
            <Input id="seoDescription" placeholder="Shown in search results" {...register("seoDescription")} />
          </div>
        </div>
      </FormSection>
      )}

      {tab === "variants" && (
      <FormSection title="Variants" description="Size, color, SKU, price override, and stock for each purchasable option.">
        <VariantEditor
          control={control}
          register={register}
          watch={watch}
          setValue={setValue}
          attributes={attributes}
          productImages={initial?.images ?? []}
          stagedImages={stagedImages}
          variantImageKeys={variantImageKeys}
          onVariantImageKeyChange={onVariantImageKeyChange}
          skuPrefix={(initial?.slug ?? watch("name") ?? "SKU").toString()}
        />
        {errors.variants && <p className="mt-1 text-xs text-danger-600">{errors.variants.message as string}</p>}
      </FormSection>
      )}

      <div className="flex justify-end">
        <Button type="submit" variant="brass" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
