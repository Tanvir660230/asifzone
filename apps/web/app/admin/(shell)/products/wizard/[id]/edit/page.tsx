"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Eye } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { BackLink } from "@/components/ui/back-link";
import { ProductWizard } from "@/components/admin/product-wizard/wizard-shell";
import { DuplicateProductDialog } from "@/components/admin/duplicate-product-dialog";
import * as categoriesApi from "@/lib/api/categories";
import * as productsApi from "@/lib/api/products";
import { classicProductEditHref } from "@/lib/admin-routes";

export default function EditProductWizardPage() {
  const { id } = useParams<{ id: string }>();
  const [duplicating, setDuplicating] = useState(false);

  const { data: categoriesData } = useQuery({ queryKey: ["categories"], queryFn: () => categoriesApi.listCategories() });
  const { data: productData, isLoading } = useQuery({ queryKey: ["product", id], queryFn: () => productsApi.getProduct(id) });

  if (isLoading || !productData) {
    return <p className="text-ink-400">Loading…</p>;
  }

  const product = productData.product;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <PageHeader
        title={`Edit ${product.name}`}
        action={
          <div className="flex items-center gap-3">
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
            <Link href={classicProductEditHref(product.id)} className="text-xs text-ink-500 underline hover:text-ink-900">
              Classic editor
            </Link>
            <BackLink href="/admin/products" label="Back to Products" />
          </div>
        }
      />

      <DuplicateProductDialog product={duplicating ? { id: product.id, name: product.name } : null} onClose={() => setDuplicating(false)} />

      <ProductWizard categories={categoriesData?.categories ?? []} initial={product} />
    </div>
  );
}
