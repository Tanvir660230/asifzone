"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { CreateProductInput } from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductForm } from "@/components/admin/product-form";
import { ImageUploader, type StagedImage } from "@/components/admin/image-uploader";
import * as categoriesApi from "@/lib/api/categories";
import * as productsApi from "@/lib/api/products";
import { ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";

export default function NewProductPage() {
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["categories"], queryFn: categoriesApi.listCategories });
  const [error, setError] = useState<string | null>(null);
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);

  async function handleSubmit(values: CreateProductInput) {
    setError(null);
    try {
      const { product } = await productsApi.createProduct(values);
      if (stagedImages.length) {
        try {
          await productsApi.uploadProductImages(
            product.id,
            stagedImages.map((s) => s.file),
          );
        } catch {
          // Product was created successfully; only the image upload failed. Don't block the
          // redirect — the admin can retry the upload from the edit page it lands on.
          toast.error("Product created, but image upload failed — try uploading again on the edit page.");
        }
      }
      router.push(`/admin/products/${product.id}/edit`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create product");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-2xl text-ink-900">Add product</h1>

      <Card>
        <CardHeader>
          <CardTitle>Images</CardTitle>
        </CardHeader>
        <CardContent>
          <ImageUploader staged={stagedImages} onStagedChange={setStagedImages} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Product details</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}
          <ProductForm categories={data?.categories ?? []} onSubmit={handleSubmit} submitLabel="Create product" />
        </CardContent>
      </Card>
    </div>
  );
}
