"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { productCarouselConfigSchema, type ProductCarouselConfig } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import * as categoriesApi from "@/lib/api/categories";

interface FormProps {
  initialConfig: Record<string, unknown>;
  onSubmit: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export function ProductCarouselForm({ initialConfig, onSubmit, onCancel }: FormProps) {
  const { data } = useQuery({ queryKey: ["admin-categories"], queryFn: () => categoriesApi.listCategories() });
  const categories = data?.categories ?? [];

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProductCarouselConfig>({
    resolver: zodResolver(productCarouselConfigSchema),
    defaultValues: {
      heading: "Featured",
      source: "featured",
      itemCount: 8,
      ...(initialConfig as Partial<ProductCarouselConfig>),
    },
  });
  const source = watch("source");

  return (
    <form onSubmit={handleSubmit(async (values) => onSubmit(values))} className="space-y-4">
      <div>
        <Label htmlFor="heading">Heading</Label>
        <Input id="heading" {...register("heading")} />
        {errors.heading && <p className="mt-1 text-xs text-danger-600">{errors.heading.message}</p>}
      </div>
      <div>
        <Label htmlFor="subtitle">Subtitle (optional)</Label>
        <Input id="subtitle" {...register("subtitle")} />
      </div>
      <div>
        <Label htmlFor="source">Products</Label>
        <Select id="source" {...register("source")}>
          <option value="featured">Featured (falls back to newest if none)</option>
          <option value="new">Newest arrivals</option>
          <option value="category">One category</option>
        </Select>
      </div>
      {source === "category" && (
        <div>
          <Label htmlFor="category">Category</Label>
          <Select id="category" {...register("category")}>
            <option value="">Select a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
          {errors.category && <p className="mt-1 text-xs text-danger-600">{errors.category.message}</p>}
        </div>
      )}
      <div>
        <Label htmlFor="itemCount">Number of products</Label>
        <Input id="itemCount" type="number" min={1} max={24} {...register("itemCount", { valueAsNumber: true })} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brass" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
