"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createCategorySchema, type Category, type CreateCategoryInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CourierNotePicker, inheritedCourierNoteIds } from "@/components/admin/courier-note-picker";
import { uploadCategoryImage, uploadCategoryBannerImage } from "@/lib/api/categories";
import { ImageUploadField } from "@/components/admin/image-upload-field";

interface CategoryFormProps {
  categories: Category[];
  initial?: Category;
  /** Pre-selects a parent when opening the form fresh from a tree row's "Add sub-category" action. */
  defaultParentId?: string | null;
  onSubmit: (values: CreateCategoryInput) => Promise<void>;
  onCancel: () => void;
}

function collectDescendantIds(categories: Category[], rootId: string): Set<string> {
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const key = c.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  const ids = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of byParent.get(id) ?? []) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return ids;
}

export function CategoryForm({ categories, initial, defaultParentId, onSubmit, onCancel }: CategoryFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateCategoryInput>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: initial
      ? {
          name: initial.name,
          slug: initial.slug,
          parentId: initial.parentId,
          imageUrl: initial.imageUrl,
          imageAltText: initial.imageAltText,
          bannerImageUrl: initial.bannerImageUrl,
          sortOrder: initial.sortOrder,
          isActive: initial.isActive,
          isFeatured: initial.isFeatured,
          seoTitle: initial.seoTitle,
          seoDescription: initial.seoDescription,
          courierNoteRuleIds: initial.courierNoteRuleIds ?? [],
        }
      : { sortOrder: 0, isActive: true, isFeatured: false, parentId: defaultParentId ?? null, courierNoteRuleIds: [] },
  });

  const excluded = initial ? collectDescendantIds(categories, initial.id) : new Set<string>();
  const parentOptions = categories.filter((c) => c.id !== initial?.id && !excluded.has(c.id));

  const parentId = watch("parentId");
  const parentName = categories.find((c) => c.id === parentId)?.name;

  const imageUrl = watch("imageUrl");
  const bannerImageUrl = watch("bannerImageUrl");



  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name")} />
        {errors.name && <p className="ui-field-error">{errors.name.message}</p>}
      </div>

      <div>
        <Label htmlFor="slug">Slug (auto-generated if left blank)</Label>
        <Input id="slug" placeholder="e.g. gift-sets" {...register("slug")} />
      </div>

      <div>
        <Label htmlFor="parentId">Parent category</Label>
        <Select id="parentId" {...register("parentId")}>
          <option value="">— None (top-level) —</option>
          {parentOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <input type="hidden" {...register("imageUrl")} />
      <ImageUploadField
        label="Category image"
        upload={uploadCategoryImage}
        value={imageUrl}
        onChange={(url) => setValue("imageUrl", url, { shouldValidate: true })}
      />

      <div>
        <Label htmlFor="imageAltText">Image alt text (optional)</Label>
        <Input id="imageAltText" placeholder={`Defaults to "${initial?.name ?? "category name"}"`} {...register("imageAltText")} />
      </div>

      <input type="hidden" {...register("bannerImageUrl")} />
      <ImageUploadField
        label="Banner image (category page hero, optional)"
        upload={uploadCategoryBannerImage}
        value={bannerImageUrl}
        onChange={(url) => setValue("bannerImageUrl", url, { shouldValidate: true })}
        uploadLabel="Click to upload a banner"
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="seoTitle">SEO title</Label>
          <Input id="seoTitle" placeholder="Defaults to category name" {...register("seoTitle")} />
        </div>
        <div>
          <Label htmlFor="seoDescription">Meta description</Label>
          <Input id="seoDescription" placeholder="Shown in search results" {...register("seoDescription")} />
        </div>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-800">Courier note</legend>
        <p className="mb-2 text-xs text-ink-500">Every product in this category and its sub-categories gets these.</p>
        <Controller
          control={control}
          name="courierNoteRuleIds"
          render={({ field }) => (
            <CourierNotePicker
              idPrefix="category-courier-note"
              value={field.value ?? []}
              onChange={field.onChange}
              inherited={inheritedCourierNoteIds(parentId, categories)}
              inheritedFrom={parentName ? `“${parentName}”` : "the parent category"}
            />
          )}
        />
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="sortOrder">Sort order</Label>
          <Input id="sortOrder" type="number" {...register("sortOrder", { valueAsNumber: true })} />
        </div>
        <div className="flex items-end gap-4 pb-2">
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

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brass" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save category"}
        </Button>
      </div>
    </form>
  );
}
