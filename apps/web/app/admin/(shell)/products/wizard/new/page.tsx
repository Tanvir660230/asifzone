"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/admin/page-header";
import { BackLink } from "@/components/ui/back-link";
import { ProductWizard } from "@/components/admin/product-wizard/wizard-shell";
import * as categoriesApi from "@/lib/api/categories";

export default function NewProductWizardPage() {
  const { data } = useQuery({ queryKey: ["categories"], queryFn: () => categoriesApi.listCategories() });

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <PageHeader title="Add product" action={<BackLink href="/admin/products" label="Back to Products" />} />
      <ProductWizard categories={data?.categories ?? []} />
    </div>
  );
}
