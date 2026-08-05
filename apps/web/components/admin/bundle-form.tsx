"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createBundleSchema, type Bundle, type Category, type CreateBundleInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

interface BundleFormProps {
  categories: Category[];
  initial?: Bundle;
  onSubmit: (values: CreateBundleInput) => Promise<void>;
  onCancel: () => void;
}

export function BundleForm({ categories, initial, onSubmit, onCancel }: BundleFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateBundleInput>({
    resolver: zodResolver(createBundleSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          anchorCategoryId: initial.anchorCategoryId,
          discountType: initial.discountType,
          discountValue: Number(initial.discountValue),
          minSuggestedCategories: initial.minSuggestedCategories,
          isActive: initial.isActive,
          sortOrder: initial.sortOrder,
          suggestionCategoryIds: initial.suggestions.map((s) => s.categoryId),
        }
      : { discountType: "PERCENTAGE", minSuggestedCategories: 1, isActive: true, sortOrder: 0, suggestionCategoryIds: [] },
  });

  const anchorCategoryId = watch("anchorCategoryId");
  const suggestionCategoryIds = watch("suggestionCategoryIds") ?? [];
  const suggestionOptions = categories.filter((c) => c.id !== anchorCategoryId);

  function toggleSuggestion(categoryId: string) {
    const next = suggestionCategoryIds.includes(categoryId)
      ? suggestionCategoryIds.filter((id) => id !== categoryId)
      : [...suggestionCategoryIds, categoryId];
    setValue("suggestionCategoryIds", next, { shouldValidate: true });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="e.g. Panjabi Essentials" {...register("name")} />
        {errors.name && <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>}
      </div>

      <div>
        <Label htmlFor="anchorCategoryId">Anchor category (buying from this triggers the bundle)</Label>
        <Select id="anchorCategoryId" {...register("anchorCategoryId")}>
          <option value="">— Select a category —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {errors.anchorCategoryId && <p className="mt-1 text-xs text-danger-600">{errors.anchorCategoryId.message}</p>}
      </div>

      <div>
        <Label>Suggested categories</Label>
        <div className="mt-1 grid grid-cols-2 gap-2 rounded-lg border border-ink-100 p-3 sm:grid-cols-3">
          {suggestionOptions.length === 0 && <p className="col-span-full text-xs text-ink-400">No other categories yet.</p>}
          {suggestionOptions.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm text-ink-700">
              <Checkbox checked={suggestionCategoryIds.includes(c.id)} onChange={() => toggleSuggestion(c.id)} />
              {c.name}
            </label>
          ))}
        </div>
        {errors.suggestionCategoryIds && (
          <p className="mt-1 text-xs text-danger-600">Pick at least one suggested category</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="discountType">Discount type</Label>
          <Select id="discountType" {...register("discountType")}>
            <option value="PERCENTAGE">Percentage</option>
            <option value="FIXED">Fixed amount</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="discountValue">Discount value</Label>
          <Input id="discountValue" type="number" step="0.01" {...register("discountValue", { valueAsNumber: true })} />
          {errors.discountValue && <p className="mt-1 text-xs text-danger-600">{errors.discountValue.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="minSuggestedCategories">Min. suggested categories in cart</Label>
          <Input
            id="minSuggestedCategories"
            type="number"
            min={1}
            {...register("minSuggestedCategories", { valueAsNumber: true })}
          />
          <p className="mt-1 text-xs text-ink-400">How many of the suggested categories must also be bought to unlock the discount.</p>
        </div>
        <div>
          <Label htmlFor="sortOrder">Sort order</Label>
          <Input id="sortOrder" type="number" {...register("sortOrder", { valueAsNumber: true })} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <Checkbox {...register("isActive")} />
        Active
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brass" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save bundle"}
        </Button>
      </div>
    </form>
  );
}
