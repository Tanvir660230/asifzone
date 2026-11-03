"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Megaphone, Plus } from "lucide-react";
import type { LandingPageSummary, Product, ProductListExtras } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { DataTable } from "@/components/admin/data-table";
import type { DataTableColumn } from "@/components/admin/data-table/types";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { PermissionState } from "@/components/admin/permission-state";
import { NewLandingPageDialog } from "@/components/admin/landing/new-landing-page-dialog";
import { useCapabilities } from "@/hooks/use-capability";
import * as booksApi from "@/lib/api/finance-books";
import * as landingApi from "@/lib/api/admin-landing-pages";
import { listProducts } from "@/lib/api/products";
import { formatPrice, timeAgo } from "@/lib/format";

type Row = Product & ProductListExtras;
const PAGE_SIZE = 25;
const lpPath = (slug: string) => `/lp/${slug}`;

async function copyLink(slug: string) {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}${lpPath(slug)}`);
    toast.success("Link copied — paste it into the ad");
  } catch {
    toast.error("Couldn't copy — select the link and copy it");
  }
}

/**
 * Marketing › Landing pages. Campaign pages are built here (sections, copy, which variants to offer — many pages can sell
 * one product from one stock); every published product also has an automatic one-page order form at /lp/<its slug>.
 * Both list the link to put in an ad and the ad campaigns already pointing at it.
 */
export default function LandingPagesPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("promotions.manage");
  const [tab, setTab] = useState<"campaign" | "product">("campaign");
  const [creating, setCreating] = useState(false);
  // campaigns that send people to a landing page (Ads › each campaign's landing page); only for roles that read the books
  const campaigns = useQuery({ queryKey: ["admin", "landing-pages", "campaigns"], queryFn: () => booksApi.listCampaigns({}), enabled: allowed && can("finance.view") });
  const byPath = new Map<string, string[]>();
  for (const c of campaigns.data?.campaigns ?? []) if (c.landingPath && !c.archivedAt) byPath.set(c.landingPath, [...(byPath.get(c.landingPath) ?? []), c.name]);

  if (ready && !allowed) return <div><ModuleTabs /><PermissionState icon={Megaphone} page="Landing pages" /></div>;

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Landing pages"
        description="One-page order forms to send ad traffic to. Campaign pages are yours to design; every published product also has its own."
        action={
          <Button onClick={() => setCreating(true)} data-testid="lp-new">
            <Plus className="h-4 w-4" aria-hidden /> New page
          </Button>
        }
      />
      <SegmentedControl
        aria-label="Which landing pages"
        value={tab}
        onChange={setTab}
        options={[
          { value: "campaign", label: "Campaign pages" },
          { value: "product", label: "Product pages" },
        ]}
      />
      {tab === "campaign" ? <CampaignPages byPath={byPath} onNew={() => setCreating(true)} /> : <ProductPages byPath={byPath} />}
      {creating && <NewLandingPageDialog open onClose={() => setCreating(false)} />}
    </div>
  );
}

function AdsCell({ names }: { names: string[] }) {
  return names.length ? <span className="text-sm text-fg">{names.join(", ")}</span> : <Badge variant="outline">None yet</Badge>;
}

function LinkActions({ slug, name, live }: { slug: string; name: string; live: boolean }) {
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => void copyLink(slug)} disabled={!live} aria-label={`Copy the landing page link for ${name}`}>
        <Copy className="h-4 w-4" aria-hidden /> Copy link
      </Button>
      <Link href={lpPath(slug)} target="_blank" rel="noreferrer" prefetch={false} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:bg-ink-900/[0.06] hover:text-fg" aria-label={`Open the landing page for ${name} (new tab)`}>
        <ExternalLink className="h-4 w-4" aria-hidden />
      </Link>
    </>
  );
}

function CampaignPages({ byPath, onNew }: { byPath: Map<string, string[]>; onNew: () => void }) {
  const pages = useQuery({ queryKey: ["admin", "landing-pages", "campaign"], queryFn: () => landingApi.listLandingPages() });
  const columns: DataTableColumn<LandingPageSummary>[] = [
    {
      id: "page",
      header: "Page",
      card: "title",
      cell: (p) => (
        <Link href={`/admin/marketing/landing-pages/${p.id}`} className="block min-w-0 hover:underline">
          <span className="block truncate font-medium text-fg">{p.name}</span>
          <span className="block truncate font-mono text-xs text-fg-muted">{lpPath(p.slug)}</span>
        </Link>
      ),
    },
    { id: "product", header: "Product", cell: (p) => <span className="text-sm text-fg">{p.productName}</span> },
    {
      id: "status",
      header: "Status",
      cell: (p) =>
        p.status === "PUBLISHED" ? (
          <span className="flex flex-wrap gap-1">
            <Badge variant="success" dot>Live</Badge>
            {p.hasUnpublishedChanges && <Badge variant="warning">Unpublished changes</Badge>}
          </span>
        ) : (
          <Badge variant="neutral" dot>Draft</Badge>
        ),
    },
    { id: "campaigns", header: "Ads sending people here", label: "Ads", cell: (p) => <AdsCell names={byPath.get(lpPath(p.slug)) ?? []} /> },
    { id: "updated", header: "Edited", cell: (p) => <span className="text-sm text-fg-muted">{timeAgo(p.updatedAt)}</span> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      label: "Actions",
      hideable: false,
      align: "right",
      cell: (p) => (
        <span className="flex justify-end gap-1">
          <Link href={`/admin/marketing/landing-pages/${p.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
            Edit
          </Link>
          <LinkActions slug={p.slug} name={p.name} live={p.status === "PUBLISHED"} />
        </span>
      ),
    },
  ];
  return (
    <DataTable
      caption="Campaign landing pages"
      columns={columns}
      rows={pages.data?.pages}
      getRowId={(p) => p.id}
      loading={pages.isLoading}
      error={pages.error}
      onRetry={() => void pages.refetch()}
      cardBelow="md"
      empty={
        <EmptyState
          icon={Megaphone}
          title="No campaign pages yet"
          description="Build a page for an ad: choose a product, which colours and sizes to offer, and the sections around the order form."
          action={<Button onClick={onNew}>New page</Button>}
        />
      }
    />
  );
}

function ProductPages({ byPath }: { byPath: Map<string, string[]> }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const products = useQuery({
    queryKey: ["admin", "landing-pages", { search, page }],
    queryFn: () => listProducts({ status: "PUBLISHED", search: search.trim() || undefined, page, pageSize: PAGE_SIZE, sort: "name" }),
  });

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
    { id: "campaigns", header: "Ads sending people here", label: "Ads", cell: (p) => <AdsCell names={byPath.get(lpPath(p.slug)) ?? []} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      label: "Actions",
      hideable: false,
      align: "right",
      cell: (p) => (
        <span className="flex justify-end gap-1">
          <LinkActions slug={p.slug} name={p.name} live />
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption="Product landing pages"
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
  );
}
