"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { History, Package, SlidersHorizontal } from "lucide-react";
import { formatVariantLabel, type StockLevelRow } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { useCapabilities } from "@/hooks/use-capability";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as inventoryApi from "@/lib/api/inventory";
import * as purchasingApi from "@/lib/api/purchasing";
import { formatCount, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AdjustStockPrefill } from "@/components/admin/adjust-stock-modal";
import { Thumbnail } from "@/components/admin/thumbnail";

type State = StockLevelRow["state"];

const STATE_TABS: Array<{ id: State | ""; label: string; countKey: State | "ALL" }> = [
  { id: "", label: "All", countKey: "ALL" },
  { id: "OUT_OF_STOCK", label: "Out of stock", countKey: "OUT_OF_STOCK" },
  { id: "LOW_STOCK", label: "Low", countKey: "LOW_STOCK" },
  { id: "IN_STOCK", label: "In stock", countKey: "IN_STOCK" },
  { id: "UNLIMITED", label: "Not tracked", countKey: "UNLIMITED" },
];

const STATE_BADGE: Record<State, { label: string; variant: "danger" | "warning" | "success" | "neutral" }> = {
  OUT_OF_STOCK: { label: "Out of stock", variant: "danger" },
  LOW_STOCK: { label: "Low", variant: "warning" },
  IN_STOCK: { label: "In stock", variant: "success" },
  UNLIMITED: { label: "Not tracked", variant: "neutral" },
};

const TAB_BASE = "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-fast ease-smooth";

/**
 * Inventory › Stock levels (Blueprint V2 §O): one row per variant with what can still be sold (Available), what unshipped
 * orders hold (Reserved) and what is physically in the warehouse (On hand), the product's low-stock point and days of
 * cover. Numbers come from GET /api/inventory/levels; changing stock always goes through the adjust dialog (a reason is
 * recorded in the ledger). Roles that see costs also get each variant's average cost and stock value from the costing
 * engine (the same figures as Finance › Reports › Inventory valuation), with the store total above the table.
 */
export function StockLevels({ onAdjust, canAdjust }: { onAdjust: (prefill: AdjustStockPrefill) => void; canAdjust: boolean }) {
  const [state, setState] = useState<State | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const debounced = useDebouncedValue(search, 350);

  const { data, isLoading } = useQuery({
    queryKey: ["stock-levels", { state, search: debounced, page }],
    queryFn: () => inventoryApi.listStockLevels({ state: state || undefined, search: debounced || undefined, page, pageSize }),
    placeholderData: (prev) => prev,
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const filtered = Boolean(search || state);

  const { can } = useCapabilities();
  const showCost = can("costing.view");
  const valuation = useQuery({
    queryKey: ["purchasing", "reports", "inventory-valuation", "stock-levels"],
    queryFn: purchasingApi.getInventoryValuation,
    enabled: showCost,
    staleTime: 60_000,
  });
  const costByVariant = useMemo(() => new Map((valuation.data?.items ?? []).map((i) => [i.variantId, i])), [valuation.data]);
  const cols = showCost ? 9 : 8;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          wrapperClassName="w-full sm:w-72"
          placeholder="Search product or SKU…"
          aria-label="Search stock levels"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <div role="group" aria-label="Filter by stock state" className="flex flex-nowrap items-center gap-1 overflow-x-auto">
          {STATE_TABS.map((t) => {
            const on = state === t.id;
            return (
              <button
                key={t.label}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setState(t.id);
                  setPage(1);
                }}
                className={cn(TAB_BASE, on ? "bg-ink-900/[0.08] text-fg" : "text-fg-muted hover:bg-ink-900/[0.04] hover:text-fg")}
              >
                {t.label}
                {data && <span className="tabular-nums text-fg-subtle">{formatCount(data.counts[t.countKey])}</span>}
              </button>
            );
          })}
        </div>
        {showCost && (
          <Link
            href="/admin/finance/reports?report=inventory-valuation"
            className="ml-auto flex items-baseline gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[13px] text-fg-muted hover:bg-ink-900/[0.04] hover:text-fg"
            title="Inventory valuation report"
          >
            Stock value
            <span className="font-semibold tabular-nums text-fg">
              {valuation.isError ? "unavailable" : valuation.data ? formatPrice(valuation.data.totals.value) : "…"}
            </span>
          </Link>
        )}
      </div>

      <TableContainer>
        <Table aria-label="Stock levels">
          <TableHead>
            <tr>
              <TableHeaderCell>Product</TableHeaderCell>
              <TableHeaderCell align="right">Available</TableHeaderCell>
              <TableHeaderCell align="right">Reserved</TableHeaderCell>
              <TableHeaderCell align="right" className="whitespace-nowrap">On hand</TableHeaderCell>
              <TableHeaderCell align="right" className="whitespace-nowrap" title="Low-stock point">Low at</TableHeaderCell>
              <TableHeaderCell align="right" className="whitespace-nowrap" title="Days of cover at the current sales pace">Cover</TableHeaderCell>
              {showCost && (
                <TableHeaderCell align="right" className="whitespace-nowrap" title="Value at average cost, with the cost of one unit">
                  Stock value
                </TableHeaderCell>
              )}
              <TableHeaderCell>State</TableHeaderCell>
              <TableHeaderCell align="right">
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </tr>
          </TableHead>
          <tbody>
            {isLoading && !data && <TableSkeleton rows={8} cols={cols} />}
            {data && data.items.length === 0 && (
              <TableMessageRow colSpan={cols}>
                <EmptyState
                  icon={Package}
                  title={filtered ? "No variants match" : "No products yet"}
                  description={filtered ? "Change the search or the state filter." : "Variants appear here once products are added."}
                />
              </TableMessageRow>
            )}
            {data?.items.map((r) => {
              const label = formatVariantLabel(r.size, r.color);
              const badge = STATE_BADGE[r.state];
              const cost = costByVariant.get(r.variantId);
              return (
                <TableRow key={r.variantId} className={cn(!r.active && "opacity-60")}>
                  <TableCell>
                    <span className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-subtle bg-ink-50">
                        {r.imageUrl ? (
                          <Thumbnail src={r.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <Package size={14} className="text-ink-300" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0">
                        <Link href={`/admin/products/${r.productId}/edit`} className="block max-w-[200px] truncate text-fg hover:text-accent hover:underline">
                          {r.productName}
                        </Link>
                        <span className="block max-w-[200px] truncate text-xs text-fg-subtle">
                          {[label, r.sku].filter(Boolean).join(" · ")}
                          {!r.active && " · inactive"}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell
                    align="right"
                    className={cn("font-semibold", r.state === "OUT_OF_STOCK" ? "text-danger-600" : r.state === "LOW_STOCK" ? "text-warning-700" : "text-fg")}
                  >
                    {r.trackInventory ? formatCount(r.available) : "—"}
                  </TableCell>
                  <TableCell align="right" className="text-fg-muted">
                    {r.reserved > 0 ? formatCount(r.reserved) : "—"}
                  </TableCell>
                  <TableCell align="right" className="text-fg-muted">
                    {r.trackInventory ? formatCount(r.onHand) : "—"}
                  </TableCell>
                  <TableCell align="right" className="text-fg-muted">
                    {r.trackInventory ? r.lowStockThreshold : "—"}
                  </TableCell>
                  <TableCell align="right" className="text-fg-muted" title="Available ÷ average daily units ordered over the last 30 days">
                    {r.daysOfCover === null || r.available <= 0 ? "—" : `${r.daysOfCover} d`}
                  </TableCell>
                  {showCost && (
                    <TableCell
                      align="right"
                      className="whitespace-nowrap tabular-nums"
                      title={cost?.status === "INCOMPLETE" ? "Some units have no known cost yet — the value covers only the costed units" : undefined}
                    >
                      <span className="block text-fg">
                        {cost ? formatPrice(cost.value) : "—"}
                        {cost?.status === "INCOMPLETE" && <span className="ml-1 text-warning-700" aria-label="incomplete cost">*</span>}
                      </span>
                      {cost?.avgUnitCost != null && <span className="block text-xs text-fg-subtle">{formatPrice(cost.avgUnitCost)} each</span>}
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge variant={badge.variant} dot>
                      {badge.label}
                    </Badge>
                  </TableCell>
                  <TableCell align="right">
                    <span className="inline-flex items-center gap-1">
                      {canAdjust && r.trackInventory && (
                        <Button variant="ghost" size="sm" onClick={() => onAdjust({ variantId: r.variantId, label: `${r.productName}${label ? ` — ${label}` : ""}` })}>
                          <SlidersHorizontal size={14} /> Adjust
                        </Button>
                      )}
                      <Link
                        href={`/admin/inventory?tab=movements&variantId=${r.variantId}`}
                        className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm text-fg-muted hover:bg-ink-900/[0.05] hover:text-fg"
                        title="Stock movements of this variant"
                        aria-label="History"
                      >
                        <History size={14} aria-hidden /> <span className="hidden 2xl:inline">History</span>
                      </Link>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </Table>
      </TableContainer>

      {data && data.total > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
          <span className="tabular-nums">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)} of {formatCount(data.total)}
          </span>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} className="mt-0" />
        </div>
      )}
    </div>
  );
}
