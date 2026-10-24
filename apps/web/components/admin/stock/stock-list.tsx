"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getErrorMessage } from "@/lib/api-client";
import type { StockGroupKey } from "@/lib/api/stock";
import { listStockItems, smartKeys, type StockListItem, type StockStatus } from "@/lib/api/stock-smart";
import { cn } from "@/lib/utils";
import { num, spacedUnit, variantWords } from "./stock-shared";

/**
 * Every stock item in one list (docs/STOCK_HUB.md §7): searched, filtered by status and kind, and sorted by what needs doing
 * first — all on the server, a page at a time, so it reads the same with 20 items or 2,000. A row opens the item.
 */

const PAGE = 50;
type StatusFilter = StockStatus | "ALL";
type GroupFilter = StockGroupKey | "ALL";

const STATUS_LABEL: Record<StatusFilter, string> = { ALL: "All", NEEDS_FILL: "Needs filling", OUT: "Out", LOW: "Running low", OK: "OK", EMPTY: "None in stock" };
const GROUP_LABEL: Record<StockGroupKey, string> = { FILL_TO_ORDER: "Attar", MATERIAL: "Materials", FINISHED: "Products" };

function StatusPill({ item }: { item: StockListItem }) {
  if (item.status === "NEEDS_FILL") return <Badge variant="info">Fill {num(item.policy?.owed ?? 0)}</Badge>;
  if (item.status === "OUT") return <Badge variant="danger">Out</Badge>;
  if (item.status === "LOW") return <Badge variant="warning">Running low</Badge>;
  if (item.status === "EMPTY") return <Badge variant="outline">None in stock</Badge>;
  return <Badge variant="neutral">OK</Badge>;
}

/** "Attar oil — ZAYAN ELIXIR" on the Zayan Elixir row reads "Attar oil". */
const shortMaterial = (material: string, product: string) => material.replace(new RegExp(`\\s*—\\s*${product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "").trim() || material;

const unitOf = (i: StockListItem) => (i.unit === "pcs" ? "" : ` ${spacedUnit(i.unit)}`);
const lasts = (d: number | null) => (d === null ? "—" : d === 0 ? "None left" : `${num(d)} day${d === 1 ? "" : "s"}`);

function subLine(i: StockListItem): string {
  if (i.group === "FILL_TO_ORDER") return `${spacedUnit(variantWords(i))} · attar${i.limitedBy ? ` · ${shortMaterial(i.limitedBy.name, i.productName).toLowerCase()} runs out first` : ""}`;
  if (i.group === "MATERIAL") return "Material";
  return variantWords(i);
}

export function StockList({ hasFillToOrder, onOpen }: { hasFillToOrder: boolean; onOpen: (item: StockListItem) => void }) {
  // the filters live in the URL (?status=&kind=&q=), so Back and a shared link keep them
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fromUrl = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const v = params.get(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  };
  const [status, setStatus] = useState<StatusFilter>(() => fromUrl<StatusFilter>("status", ["ALL", "NEEDS_FILL", "OUT", "LOW", "OK", "EMPTY"], "ALL"));
  const [group, setGroup] = useState<GroupFilter>(() => fromUrl<GroupFilter>("kind", ["ALL", "FILL_TO_ORDER", "MATERIAL", "FINISHED"], "ALL"));
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const q = useDebouncedValue(search.trim(), 250);
  useEffect(() => {
    const next = new URLSearchParams(params.toString());
    const put = (k: string, v: string, empty: string) => (v && v !== empty ? next.set(k, v) : next.delete(k));
    put("status", status, "ALL");
    put("kind", group, "ALL");
    put("q", q, "");
    const s = next.toString();
    if (s !== params.toString()) router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [status, group, q, params, pathname, router]);
  const filters = { status: status === "ALL" ? undefined : status, group: group === "ALL" ? undefined : group, q: q || undefined, limit: PAGE };
  const list = useInfiniteQuery({
    queryKey: smartKeys.list(filters),
    queryFn: ({ pageParam }) => listStockItems({ ...filters, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: (prev) => prev,
  });
  const pages = list.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const counts = pages[0]?.counts;
  const statuses: StatusFilter[] = ["ALL", ...(hasFillToOrder ? (["NEEDS_FILL"] as const) : []), "OUT", "LOW", "OK", "EMPTY"];
  const groups: GroupFilter[] = ["ALL", ...(hasFillToOrder ? (["FILL_TO_ORDER"] as const) : []), "MATERIAL", "FINISHED"];

  return (
    <section aria-labelledby="stock-all" className="space-y-3" data-testid="stock-list">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="stock-all" className="text-lg font-semibold tracking-tight text-fg">All stock</h2>
        {counts && <p className="text-sm tabular-nums text-fg-muted">{num(counts.ALL)} item{counts.ALL === 1 ? "" : "s"}</p>}
      </div>
      <div className="space-y-2">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name or SKU" wrapperClassName="md:w-80" data-testid="stock-search" />
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <SegmentedControl aria-label="Kind" value={group} onChange={setGroup} options={groups.map((g) => ({ value: g, testId: `stock-kind-${g}`, label: g === "ALL" ? "Everything" : GROUP_LABEL[g] }))} />
          </div>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <SegmentedControl
            aria-label="Show"
            value={status}
            onChange={setStatus}
            options={statuses.map((s) => ({ value: s, testId: `stock-filter-${s}`, label: <>{STATUS_LABEL[s]}{counts && <span className="tabular-nums text-fg-subtle">{num(counts[s])}</span>}</> }))}
          />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_8rem_6rem_6rem_6rem_1rem] gap-4 border-b border-line-subtle bg-surface-muted px-4 py-2 text-xs font-medium text-fg-muted md:grid">
          <span>Item</span><span>Status</span><span className="text-right">In stock</span><span className="text-right">Can sell</span><span className="text-right">Lasts</span><span />
        </div>
        {list.isLoading ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading stock">
            {[0, 1, 2, 3, 4].map((k) => <Skeleton key={k} className="h-10 w-full" />)}
          </div>
        ) : list.isError ? (
          <p className="px-4 py-6 text-sm text-fg-muted">{getErrorMessage(list.error, "The stock list couldn't be loaded.")} <button type="button" onClick={() => list.refetch()} className="font-medium text-fg underline underline-offset-4">Try again</button></p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fg-muted" data-testid="stock-list-empty">
            {q ? <>Nothing matches “{q}”.</> : status !== "ALL" ? <>Nothing is {STATUS_LABEL[status].toLowerCase()} right now.</> : "No stock-tracked items yet."}
          </p>
        ) : (
          <ul className={cn("divide-y divide-line-subtle transition-opacity duration-base", list.isPlaceholderData && "opacity-60")}>
            {items.map((i) => (
              <li key={i.variantId}>
                <button
                  type="button"
                  onClick={() => onOpen(i)}
                  data-testid={`stock-row-${i.sku}`}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors duration-fast hover:bg-ink-900/[0.03] focus-visible:bg-ink-900/[0.04] md:grid-cols-[minmax(0,1fr)_8rem_6rem_6rem_6rem_1rem] md:gap-4"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] text-fg">{i.productName}</span>
                    <span className="block truncate text-xs text-fg-muted">{subLine(i)}</span>
                  </span>
                  <span className="justify-self-end md:justify-self-start"><StatusPill item={i} /></span>
                  <span className="col-span-2 flex gap-3 text-xs tabular-nums text-fg-muted md:hidden">
                    <span>{num(Math.max(0, i.stock))}{unitOf(i)} in stock</span>
                    {i.canSell !== null && i.group === "FILL_TO_ORDER" && <span>sells {num(i.canSell)}</span>}
                    <span>{i.daysLeft === null ? "no recent use" : i.daysLeft === 0 ? "none left" : `lasts ${lasts(i.daysLeft).toLowerCase()}`}</span>
                  </span>
                  <span className="hidden text-right tabular-nums text-fg md:block"><span className="sr-only">In stock </span>{num(Math.max(0, i.stock))}{unitOf(i)}</span>
                  <span className="hidden text-right tabular-nums text-fg md:block"><span className="sr-only">Can sell </span>{i.canSell === null ? "No limit" : num(i.canSell)}</span>
                  <span className="hidden text-right tabular-nums text-fg-muted md:block"><span className="sr-only">Lasts </span>{lasts(i.daysLeft)}</span>
                  <ChevronRight aria-hidden="true" className="hidden h-4 w-4 text-fg-subtle md:block" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <div className="border-t border-line-subtle p-3 text-center">
            <Button variant="ghost" size="sm" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} data-testid="stock-load-more">Show more</Button>
          </div>
        )}
      </Card>
    </section>
  );
}
