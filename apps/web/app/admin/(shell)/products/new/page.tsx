"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/admin/page-header";
import { BackLink } from "@/components/ui/back-link";
import { ProductBuilder } from "@/components/admin/product-builder/builder";
import * as categoriesApi from "@/lib/api/categories";

export default function NewProductPage() {
  const { data } = useQuery({ queryKey: ["categories"], queryFn: () => categoriesApi.listCategories() });

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader eyebrow="Product Builder" title="Add product" action={<BackLink href="/admin/products" label="Back to Products" />} />
      <ProductBuilder categories={data?.categories ?? []} />
    </div>
  );
}
