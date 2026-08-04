"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";
import { createCategorySchema, type Category, type CreateCategoryInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { uploadCategoryImage } from "@/lib/api/categories";
import { ApiError } from "@/lib/api-client";

interface CategoryFormProps {
  categories: Category[];
  initial?: Category;
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

export function CategoryForm({ categories, initial, onSubmit, onCancel }: CategoryFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateCategoryInput>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: initial
      ? {
          name: initial.name,
          slug: initial.slug,
          parentId: initial.parentId,
          imageUrl: initial.imageUrl,
          sortOrder: initial.sortOrder,
          isActive: initial.isActive,
        }
      : { sortOrder: 0, isActive: true },
  });

  const excluded = initial ? collectDescendantIds(categories, initial.id) : new Set<string>();
  const parentOptions = categories.filter((c) => c.id !== initial?.id && !excluded.has(c.id));

  const imageUrl = watch("imageUrl");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadMutation = useMutation({ mutationFn: uploadCategoryImage });

  async function handleImageSelected(file: File | null) {
    if (!file) return;
    setUploadError(null);
    try {
      const { url } = await uploadMutation.mutateAsync(file);
      setValue("imageUrl", url, { shouldValidate: true });
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Image upload failed");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name")} />
        {errors.name && <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>}
      </div>

      <div>
        <Label htmlFor="slug">Slug (auto-generated if left blank)</Label>
        <Input id="slug" placeholder="e.g. formal-shirts" {...register("slug")} />
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

      <div>
        <Label>Category image</Label>
        <input type="hidden" {...register("imageUrl")} />
        {imageUrl ? (
          <div className="relative mt-1 h-28 w-full overflow-hidden rounded-lg border border-ink-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => setValue("imageUrl", "", { shouldValidate: true })}
              className="absolute right-2 top-2 rounded-full bg-ink-900/70 p-1 text-cream-50"
              aria-label="Remove image"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="mt-1 flex h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ink-300 text-ink-500 transition-colors hover:border-brass-400 hover:text-brass-500 disabled:opacity-50"
          >
            <Upload size={18} />
            <span className="text-xs">{uploadMutation.isPending ? "Uploading…" : "Click to upload an image"}</span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleImageSelected(e.target.files?.[0] ?? null)}
        />
        {uploadError && <p className="mt-1 text-xs text-danger-600">{uploadError}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="sortOrder">Sort order</Label>
          <Input id="sortOrder" type="number" {...register("sortOrder", { valueAsNumber: true })} />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Checkbox {...register("isActive")} />
            Active
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
