"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateProductInput } from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductForm } from "@/components/admin/product-form";
import { ImageUploader } from "@/components/admin/image-uploader";
import * as categoriesApi from "@/lib/api/categories";
import * as productsApi from "@/lib/api/products";
import { ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: categoriesData } = useQuery({ queryKey: ["categories"], queryFn: categoriesApi.listCategories });
  const { data: productData, isLoading } = useQuery({
    queryKey: ["product", id],
    queryFn: () => productsApi.getProduct(id),
  });

  async function handleSubmit(values: CreateProductInput) {
    setError(null);
    try {
      await productsApi.updateProduct(id, values);
      await queryClient.invalidateQueries({ queryKey: ["product", id] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update product");
    }
  }

  if (isLoading || !productData) {
    return <p className="text-ink-400">Loading…</p>;
  }

  const product = productData.product;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">Edit {product.name}</h1>
        <button onClick={() => router.push("/admin/products")} className="text-sm text-ink-500 hover:text-ink-900">
          Back to products
        </button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Images</CardTitle>
        </CardHeader>
        <CardContent>
          <ImageUploader productId={product.id} images={product.images} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Product details</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}
          <ProductForm categories={categoriesData?.categories ?? []} initial={product} onSubmit={handleSubmit} />
        </CardContent>
      </Card>
    </div>
  );
}
