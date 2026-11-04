"use client";

import Link from "next/link";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { Layers, Plus } from "lucide-react";
import type { ProductFamilySummary } from "@clothing-brand/shared";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/admin/data-table";
import type { DataTableColumn } from "@/components/admin/data-table/types";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { PermissionState } from "@/components/admin/permission-state";
import { useCapabilities } from "@/hooks/use-capability";
import { thumbnailUrl } from "@/lib/image-url";
import * as familiesApi from "@/lib/api/product-families";
import { timeAgo } from "@/lib/format";

const editHref = (id: string) => `/admin/products/families/${id}`;

/**
 * Products › Product families. A family links matching products — the same cap in several colours, a jacket with and
 * without sleeves — so each one's product page shows the others as photo tiles. Products are never merged or changed.
 */
export default function ProductFamiliesPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("catalog.manage");
  const families = useQuery({ queryKey: ["admin", "product-families"], queryFn: () => familiesApi.listProductFamilies(), enabled: allowed });

  if (ready && !allowed) return <div><ModuleTabs /><PermissionState icon={Layers} page="Product families" /></div>;

  const columns: DataTableColumn<ProductFamilySummary>[] = [
    {
      id: "family",
      header: "Family",
      card: "title",
      cell: (f) => (
        <Link href={editHref(f.id)} className="flex min-w-0 items-center gap-3 hover:underline">
          <span className="flex shrink-0 -space-x-2" aria-hidden="true">
            {f.imageUrls.map((url) => (
              <span key={url} className="relative h-9 w-9 overflow-hidden rounded-full bg-surface-muted ring-2 ring-surface">
                <Image src={thumbnailUrl(url)} alt="" fill sizes="36px" className="object-cover" />
              </span>
            ))}
          </span>
          <span className="truncate font-medium text-fg">{f.name}</span>
        </Link>
      ),
    },
    { id: "members", header: "Products", align: "right", cell: (f) => <span className="tabular-nums">{f.memberCount}</span> },
    { id: "updated", header: "Edited", cell: (f) => <span className="text-sm text-fg-muted">{timeAgo(f.updatedAt)}</span> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      label: "Actions",
      hideable: false,
      align: "right",
      cell: (f) => (
        <Link href={editHref(f.id)} className={buttonVariants({ size: "sm", variant: "ghost" })}>
          Edit
        </Link>
      ),
    },
  ];

  const newButton = (
    <Link href={editHref("new")} className={buttonVariants({})} data-testid="family-new">
      <Plus className="h-4 w-4" aria-hidden /> New family
    </Link>
  );

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Product families"
        description="Link matching products so each one's page shows the others as photos. Every product stays separate — its own stock, price and orders."
        action={newButton}
      />
      <DataTable
        caption="Product families"
        columns={columns}
        rows={families.data?.families}
        getRowId={(f) => f.id}
        loading={families.isLoading || !ready}
        error={families.error}
        onRetry={() => void families.refetch()}
        cardBelow="md"
        empty={
          <EmptyState
            icon={Layers}
            title="No families yet"
            description="Make one to show matching products together — for example every colour of a cap, or a jacket with and without sleeves."
            action={newButton}
          />
        }
      />
    </div>
  );
}
