"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSection } from "@/components/admin/form-section";
import { VariantEditor } from "./variant-editor";

interface ProductFormProps {
  categories: Category[];
  initial?: Product;
  onSubmit: (values: CreateProductInput) => Promise<void>;
  submitLabel?: string;
}

export function ProductForm({ categories, initial, onSubmit, submitLabel = "Save product" }: ProductFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateProductInput>({
    resolver: zodResolver(createProductSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          slug: initial.slug,
          description: initial.description,
          categoryId: initial.categoryId,
          brandTier: initial.brandTier,
          basePrice: Number(initial.basePrice),
          compareAtPrice: initial.compareAtPrice ? Number(initial.compareAtPrice) : undefined,
          isActive: initial.isActive,
          isFeatured: initial.isFeatured,
          variants: initial.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            size: v.size,
            color: v.color,
            colorHex: v.colorHex,
            price: v.price ? Number(v.price) : undefined,
            stock: v.stock,
          })),
        }
      : { brandTier: "PREMIUM", isActive: true, isFeatured: false, variants: [{ sku: "", size: "", color: "", stock: 0 }] },
  });

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
            <Label htmlFor="brandTier">Tier</Label>
            <Select id="brandTier" {...register("brandTier")}>
              <option value="PREMIUM">Premium</option>
              <option value="PLATINUM">Platinum</option>
              <option value="LUXURY">Luxury</option>
            </Select>
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
        </div>

        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" rows={4} {...register("description")} />
        </div>
      </FormSection>

      <FormSection title="Pricing">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="basePrice">Base price (BDT)</Label>
            <Input id="basePrice" type="number" step="0.01" {...register("basePrice", { valueAsNumber: true })} />
            {errors.basePrice && <p className="mt-1 text-xs text-danger-600">{errors.basePrice.message}</p>}
          </div>

          <div>
            <Label htmlFor="compareAtPrice">Compare-at price (optional)</Label>
            <Input id="compareAtPrice" type="number" step="0.01" {...register("compareAtPrice", { valueAsNumber: true })} />
          </div>
        </div>
      </FormSection>

      <FormSection title="Variants" description="Size, color, SKU, price override, and stock for each purchasable option.">
        <VariantEditor control={control} register={register} />
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
