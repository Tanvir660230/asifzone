"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Megaphone } from "lucide-react";
import type { Product, ProductListExtras } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { toast } from "@/components/ui/toast";
import { DataTable } from "@/components/admin/data-table";
import type { DataTableColumn } from "@/components/admin/data-table/types";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { PermissionState } from "@/components/admin/permission-state";
import { useCapabilities } from "@/hooks/use-capability";
import * as booksApi from "@/lib/api/finance-books";
import { listProducts } from "@/lib/api/products";
import { formatPrice } from "@/lib/format";

type Row = Product & ProductListExtras;
const PAGE_SIZE = 25;
const lpPath = (slug: string) => `/lp/${slug}`;

/**
 * Marketing › Landing pages (blueprint P2.5): every published product has a one-page order form for ads at /lp/<slug>.
 * This lists them with the link to copy into an ad and the campaigns already pointing at each — so an ad never sends
 * people to a product that is no longer published.
 */
export default function LandingPagesPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("promotions.manage");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const products = useQuery({
    queryKey: ["admin", "landing-pages", { search, page }],
    queryFn: () => listProducts({ status: "PUBLISHED", search: search.trim() || undefined, page, pageSize: PAGE_SIZE, sort: "name" }),
    enabled: allowed,
  });
  // campaigns that send people to a landing page (Ads › each campaign's landing page); only for roles that read the books
  const campaigns = useQuery({ queryKey: ["admin", "landing-pages", "campaigns"], queryFn: () => booksApi.listCampaigns({}), enabled: allowed && can("finance.view") });
  const byPath = new Map<string, string[]>();
  for (const c of campaigns.data?.campaigns ?? []) if (c.landingPath && !c.archivedAt) byPath.set(c.landingPath, [...(byPath.get(c.landingPath) ?? []), c.name]);

  if (ready && !allowed) return <div><ModuleTabs /><PermissionState icon={Megaphone} page="Landing pages" /></div>;

  const copy = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${lpPath(slug)}`);
      toast.success("Link copied — paste it into the ad");
    } catch {
      toast.error("Couldn't copy — select the link and copy it");
    }
  };

  const columns: DataTableColumn<Row>[] = [
    {
      id: "product",
      header: "Product",
      card: "title",
      cell: (p) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-fg">{p.name}</span>
          <span className="block truncate font-mono text-xs text-fg-muted">{lpPath(p.slug)}</span>
        </span>
      ),
    },
    { id: "price", header: "Price", align: "right", cell: (p) => <span className="tabular-nums">{formatPrice(Number(p.basePrice))}</span> },
    {
      id: "campaigns",
      header: "Ads sending people here",
      label: "Ads",
      cell: (p) => {
        const names = byPath.get(lpPath(p.slug)) ?? [];
        return names.length ? <span className="text-sm text-fg">{names.join(", ")}</span> : <Badge variant="outline">None yet</Badge>;
      },
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      label: "Actions",
      hideable: false,
      align: "right",
      cell: (p) => (
        <span className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => void copy(p.slug)} aria-label={`Copy the landing page link for ${p.name}`}>
            <Copy className="h-4 w-4" aria-hidden /> Copy link
          </Button>
          <Link href={lpPath(p.slug)} target="_blank" rel="noreferrer" prefetch={false} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:bg-ink-900/[0.06] hover:text-fg" aria-label={`Open the landing page for ${p.name} (new tab)`}>
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Link>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Landing pages" description="A one-page order form for each published product — the link to put in an ad." />
      <DataTable
        caption="Landing pages"
        columns={columns}
        rows={products.data?.items}
        getRowId={(p) => p.id}
        loading={products.isLoading}
        error={products.error}
        onRetry={() => void products.refetch()}
        page={page}
        pageSize={PAGE_SIZE}
        total={products.data?.total}
        onPageChange={setPage}
        cardBelow="md"
        toolbar={<SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Find a product…" aria-label="Find a product" className="w-full sm:w-72" />}
        empty={
          <EmptyState
            icon={Megaphone}
            title={search ? `No published product matches “${search}”` : "No published products yet"}
            description={search ? undefined : "A product gets its landing page the moment it is published."}
            action={search ? undefined : <Link href="/admin/products" className="text-sm font-medium text-accent hover:underline">Go to products</Link>}
          />
        }
      />
    </div>
  );
}
