"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type { CreateProductInput } from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/page-header";
import { BackLink } from "@/components/ui/back-link";
import { ProductForm } from "@/components/admin/product-form";
import { ImageUploader } from "@/components/admin/image-uploader";
import * as categoriesApi from "@/lib/api/categories";
import * as productsApi from "@/lib/api/products";
import { ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: categoriesData } = useQuery({ queryKey: ["categories"], queryFn: () => categoriesApi.listCategories() });
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
      <PageHeader
        title={`Edit ${product.name}`}
        action={
          <div className="flex items-center gap-3">
            <Link
              href={`/product/${product.slug}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors duration-150 ease-smooth hover:border-ink-400 hover:text-ink-900"
            >
              <ExternalLink size={13} />
              View on site
            </Link>
            <BackLink href="/admin/products" label="Back to Products" />
          </div>
        }
      />

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
