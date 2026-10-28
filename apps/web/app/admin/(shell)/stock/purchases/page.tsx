"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { SegmentedControl } from "@/components/ui/tabs";
import { DataTable } from "@/components/admin/data-table";
import type { DataTableColumn } from "@/components/admin/data-table/types";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { PermissionState } from "@/components/admin/permission-state";
import { useCapabilities } from "@/hooks/use-capability";
import * as purchasingApi from "@/lib/api/purchasing";
import * as stockApi from "@/lib/api/stock";
import type { StockPurchase } from "@/lib/api/stock";
import type { GoodsReceipt } from "@/lib/api/purchasing";
import { formatBookDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
/** What the stock hub's quick "Received goods" writes as a direct receipt's reason (domain/stock/purchase.service.ts). */
const QUICK_REASON = "Bought — stock hub";
type Filter = "ALL" | "DUPLICATES";

const pathOf = (r: GoodsReceipt) => (r.purchaseOrder ? `Order ${r.purchaseOrder.number}` : r.directReason === QUICK_REASON ? "Received goods" : "Without an order");
const unitsOf = (r: GoodsReceipt) => r.lines.reduce((s, l) => s + l.qtyAccepted, 0);

/**
 * Stock › Purchases (blueprint tab 2 §2, P0.3): every purchase in one list, whichever way it was entered — the everyday
 * Received goods form or the formal purchase-order path (both write a goods receipt) — so a buyer checks one place before
 * buying again. A receipt that looked like one already entered carries its warning (and the reason given), never a block.
 */
export default function StockPurchasesPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("purchasing.view");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>("ALL");
  const query = { page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: purchasingApi.purchasingDocKeys.receipts(query), queryFn: () => purchasingApi.listGoodsReceipts(query), enabled: allowed, placeholderData: (prev) => prev });
  // Blueprint P1.4: purchases recorded before stock costing started have no receipt — they come from the stock hub's list
  const hub = useQuery({ queryKey: [...stockApi.stockKeys.purchases(), "page", 50], queryFn: () => stockApi.listStockPurchases(50), enabled: allowed });

  if (ready && !allowed) return <div><ModuleTabs /><PermissionState icon={PackageCheck} page="Purchases" /></div>;

  const rows = (list.data?.goodsReceipts ?? []).filter((r) => filter === "ALL" || Boolean(r.duplicateWarning));
  const simpleRows = (hub.data?.purchases ?? []).filter((p) => p.mode === "SIMPLE" && (filter === "ALL" || p.duplicateMatches > 0));
  const simpleColumns: DataTableColumn<StockPurchase>[] = [
    {
      id: "purchase",
      header: "Purchase",
      card: "title",
      cell: (p) => (
        <span className="block min-w-0">
          <span className="block font-medium text-fg">{p.supplier.name}</span>
          <span className="block text-xs text-fg-muted">{formatBookDate(p.date)}</span>
        </span>
      ),
    },
    { id: "items", header: "Items", align: "right", cell: (p) => <span className="tabular-nums">{p.lines.length} · {p.lines.reduce((s, l) => s + l.quantity, 0).toLocaleString("en-US")} units</span> },
    { id: "total", header: "Paid", align: "right", cell: (p) => (p.total === null ? <span className="text-fg-muted">—</span> : <Money value={p.total} />) },
    {
      id: "status",
      header: "Status",
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant="success">In stock</Badge>
          {p.moneyPending && <Badge variant="neutral" title="What was paid is kept with the purchase and goes into the books when they start">Not in the books yet</Badge>}
          {p.duplicateMatches > 0 && <Badge variant="warning">Possible duplicate</Badge>}
        </span>
      ),
    },
  ];
  const columns: DataTableColumn<GoodsReceipt>[] = [
    {
      id: "receipt",
      header: "Purchase",
      card: "title",
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block font-medium text-fg">{r.supplier.displayName}</span>
          <span className="block text-xs text-fg-muted">{r.number} · {formatBookDate(r.receiptDate)}</span>
        </span>
      ),
    },
    { id: "path", header: "How it came in", label: "Path", cell: (r) => <span className="text-sm text-fg">{pathOf(r)}</span> },
    { id: "items", header: "Items", align: "right", cell: (r) => <span className="tabular-nums">{r.lines.length} · {unitsOf(r).toLocaleString("en-US")} units</span> },
    { id: "total", header: "Goods", align: "right", cell: (r) => <Money value={r.total} /> },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant={r.status === "POSTED" ? "success" : r.status === "REVERSED" ? "outline" : "neutral"}>{r.status === "POSTED" ? "In stock" : r.status === "REVERSED" ? "Undone" : "Draft"}</Badge>
          {r.duplicateWarning && (
            <Badge
              variant="warning"
              title={`Looks like ${r.duplicateWarning.matches.map((m) => m.number).join(", ")}${r.duplicateReason ? ` — entered anyway: ${r.duplicateReason}` : " — no reason given"}`}
            >
              Possible duplicate
            </Badge>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Purchases"
        description="Everything bought, however it was entered — check here before buying again."
        action={can("purchasing.receive") && (
          <Link href="/admin/stock?open=bought" className={cn(buttonVariants({ size: "sm" }))}>
            <Plus className="h-4 w-4" aria-hidden /> Received goods
          </Link>
        )}
      />
      <DataTable
        caption="Purchases"
        columns={columns}
        rows={list.data ? rows : undefined}
        getRowId={(r) => r.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        page={page}
        pageSize={PAGE_SIZE}
        total={filter === "ALL" ? list.data?.total : rows.length}
        onPageChange={setPage}
        cardBelow="md"
        toolbar={<SegmentedControl aria-label="Show" value={filter} onChange={setFilter} options={[{ value: "ALL" as const, label: "All" }, { value: "DUPLICATES" as const, label: "Possible duplicates" }]} />}
        empty={
          filter === "DUPLICATES"
            ? <EmptyState icon={PackageCheck} title="No possible duplicates on this page" description="A purchase that looks like one already entered shows here." />
            : simpleRows.length
              ? <EmptyState icon={PackageCheck} title="No purchases in the books yet" description="The purchases below were recorded before stock costing started." />
              : <EmptyState icon={PackageCheck} title="No purchases yet" description="Record what arrived with Received goods — it adds the stock and what you paid." action={can("purchasing.receive") ? <Link href="/admin/stock?open=bought" className="text-sm font-medium text-accent hover:underline">Received goods</Link> : undefined} />
        }
      />
      {simpleRows.length > 0 && (
        <section aria-labelledby="purchases-before-costing" className="space-y-3" data-testid="purchases-before-costing">
          <div>
            <h2 id="purchases-before-costing" className="text-base font-semibold text-fg">Recorded before stock costing started</h2>
            <p className="text-sm text-fg-muted">The goods are in stock. What was paid is kept with each purchase and goes into the books when they start.</p>
          </div>
          <DataTable caption="Purchases recorded before stock costing started" columns={simpleColumns} rows={simpleRows} getRowId={(p) => p.id} cardBelow="md" />
        </section>
      )}
    </div>
  );
}
