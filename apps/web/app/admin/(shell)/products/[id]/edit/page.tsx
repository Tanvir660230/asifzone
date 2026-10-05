"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Eye } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { BackLink } from "@/components/ui/back-link";
import { buttonVariants, Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/empty-state";
import { ProductBuilder } from "@/components/admin/product-builder/builder";
import { DuplicateProductDialog } from "@/components/admin/duplicate-product-dialog";
import * as categoriesApi from "@/lib/api/categories";
import * as productsApi from "@/lib/api/products";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const [duplicating, setDuplicating] = useState(false);

  const { data: categoriesData } = useQuery({ queryKey: ["categories"], queryFn: () => categoriesApi.listCategories() });
  const { data: productData, isLoading, isError, refetch } = useQuery({ queryKey: ["product", id], queryFn: () => productsApi.getProduct(id) });

  if (isError) return <ErrorState variant="bordered" title="Couldn't load this product" onRetry={() => void refetch()} />;
  if (isLoading || !productData) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-5" aria-busy="true" aria-label="Loading product">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const product = productData.product;
  const pill = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader
        eyebrow="Product Builder"
        title={`Edit ${product.name}`}
        action={
          <>
            {/* Preview renders the storefront page for any status (drafts included) and needs the admin session. */}
            <Link href={`/preview/${product.id}`} target="_blank" rel="noreferrer" className={pill}>
              <Eye size={14} aria-hidden="true" /> Preview
            </Link>
            {product.status === "PUBLISHED" && (
              <Link href={`/product/${product.slug}`} target="_blank" rel="noreferrer" className={pill}>
                <ExternalLink size={14} aria-hidden="true" /> View on site
              </Link>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => setDuplicating(true)}>
              <Copy size={14} aria-hidden="true" /> Duplicate
            </Button>
            <BackLink href="/admin/products" label="Back to Products" />
          </>
        }
      />

      <DuplicateProductDialog product={duplicating ? { id: product.id, name: product.name } : null} onClose={() => setDuplicating(false)} />

      <ProductBuilder key={product.id} categories={categoriesData?.categories ?? []} initial={product} />
    </div>
  );
}
