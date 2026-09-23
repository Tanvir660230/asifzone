"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Eye } from "lucide-react";
import type { CreateProductInput } from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/page-header";
import { BackLink } from "@/components/ui/back-link";
import { ProductForm } from "@/components/admin/product-form";
import { DuplicateProductDialog } from "@/components/admin/duplicate-product-dialog";
import { ImageUploader } from "@/components/admin/image-uploader";
import * as categoriesApi from "@/lib/api/categories";
import * as productsApi from "@/lib/api/products";
import { describeApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { productEditHref } from "@/lib/admin-routes";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);

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
      toast.success(
        values.status === "PUBLISHED"
          ? "Product published"
          : values.status === "UNPUBLISHED"
            ? "Product unpublished"
            : values.status === "READY"
              ? "Marked ready to publish"
              : values.status === "DRAFT"
                ? "Moved back to draft"
                : "Product saved",
      );
      await queryClient.invalidateQueries({ queryKey: ["product-history", id] });
    } catch (err) {
      setError(describeApiError(err, "Failed to update product"));
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
            {/* Preview renders the storefront page for any status (drafts included) and needs the admin session. */}
            <Link
              href={`/preview/${product.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors duration-150 ease-smooth hover:border-ink-400 hover:text-ink-900"
            >
              <Eye size={13} />
              Preview
            </Link>
            {product.status === "PUBLISHED" && (
              <Link
                href={`/product/${product.slug}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors duration-150 ease-smooth hover:border-ink-400 hover:text-ink-900"
              >
                <ExternalLink size={13} />
                View on site
              </Link>
            )}
            <button
              type="button"
              onClick={() => setDuplicating(true)}
              className="flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors duration-150 ease-smooth hover:border-ink-400 hover:text-ink-900"
            >
              <Copy size={13} />
              Duplicate
            </button>
            <Link href={productEditHref(product.id)} className="text-xs text-ink-500 underline hover:text-ink-900">
              Step-by-step editor
            </Link>
            <BackLink href="/admin/products" label="Back to Products" />
          </div>
        }
      />

      <DuplicateProductDialog product={duplicating ? { id: product.id, name: product.name } : null} onClose={() => setDuplicating(false)} />

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
