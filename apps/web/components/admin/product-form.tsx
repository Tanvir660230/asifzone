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
import { FormSection } from "@/components/admin/form-section";
import { VariantEditor } from "./variant-editor";

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
}

export function ProductForm({ categories, initial, onSubmit, submitLabel = "Save product" }: ProductFormProps) {
  const { data: attributesData } = useQuery({ queryKey: ["attributes"], queryFn: attributesApi.listAttributes });
  const attributes = attributesData?.attributes ?? [];

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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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

          <div className="flex items-end gap-6 pb-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <Checkbox {...register("isActive")} />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <Checkbox {...register("isFeatured")} />
              Featured
            </label>
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

      <FormSection title="Variants" description="Size, color, SKU, price override, and stock for each purchasable option.">
        <VariantEditor
          control={control}
          register={register}
          watch={watch}
          attributes={attributes}
          productImages={initial?.images ?? []}
          skuPrefix={(initial?.slug ?? watch("name") ?? "SKU").toString()}
        />
        {errors.variants && <p className="mt-1 text-xs text-danger-600">{errors.variants.message as string}</p>}
      </FormSection>

      <div className="flex justify-end">
        <Button type="submit" variant="brass" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
