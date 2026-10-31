"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { getErrorMessage } from "@/lib/api-client";
import type { StockGroupKey } from "@/lib/api/stock";
import { listStockItems, smartKeys, type StockListItem, type StockStatus } from "@/lib/api/stock-smart";
import { cn } from "@/lib/utils";
import { Highlight, ItemThumb } from "./item-thumb";
import { figureOf } from "./stock-search-box";
import { num, spacedUnit, variantWords } from "./stock-shared";

/**
 * Every stock item in one list (docs/STOCK_HUB.md §7), each with its picture, what needs doing and how long it lasts —
 * searched (the box above), filtered and sorted by what needs doing first, all on the server and a page at a time, so it
 * reads the same with 20 items or 2,000. Status and kind live in the URL. A row opens the item.
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

/** How long it lasts against the days of stock it should keep: a full bar is a full cover. Nothing to show without use. */
function Lasts({ item }: { item: StockListItem }) {
  if (item.group === "FILL_TO_ORDER" || item.daysLeft === null) return <span className="text-xs text-fg-subtle">{item.group === "FILL_TO_ORDER" ? "" : "no recent use"}</span>;
  const share = Math.max(0, Math.min(1, item.daysLeft / Math.max(1, item.settings.coverDays)));
  const tone = item.status === "OUT" || item.daysLeft === 0 ? "bg-danger-600" : item.daysLeft <= item.settings.leadTimeDays + 7 ? "bg-warning-600" : "bg-success-600";
  return (
    <span className="flex items-center gap-2" title={`${num(item.daysLeft)} days at the last 30 days' pace`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-ink-900/[0.07]" aria-hidden="true"><span className={cn("block h-full origin-left rounded-full", tone)} style={{ transform: `scaleX(${share})` }} /></span>
      <span className="w-14 text-xs tabular-nums text-fg-muted">{item.daysLeft === 0 ? "none left" : `${num(item.daysLeft)} days`}</span>
    </span>
  );
}

const shortMaterial = (material: string, product: string) => material.replace(new RegExp(`\\s*—\\s*${product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "").trim() || material;

function metaOf(i: StockListItem): string {
  if (i.group === "FILL_TO_ORDER") return [spacedUnit(variantWords(i)), "attar", i.limitedBy ? `${shortMaterial(i.limitedBy.name, i.productName).toLowerCase()} runs out first` : null].filter(Boolean).join(" · ");
  if (i.group === "MATERIAL") return "Material";
  return variantWords(i) === i.sku ? "Product" : variantWords(i);
}

export function StockList({ hasFillToOrder, q, selectedId, onOpen }: { hasFillToOrder: boolean; q: string; selectedId: string | null; onOpen: (item: StockListItem) => void }) {
  // the filters live in the URL (?status=&kind=), so Back and a shared link keep them
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fromUrl = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const v = params.get(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  };
  const [status, setStatus] = useState<StatusFilter>(() => fromUrl<StatusFilter>("status", ["ALL", "NEEDS_FILL", "OUT", "LOW", "OK", "EMPTY"], "ALL"));
  const [group, setGroup] = useState<GroupFilter>(() => fromUrl<GroupFilter>("kind", ["ALL", "FILL_TO_ORDER", "MATERIAL", "FINISHED"], "ALL"));
  useEffect(() => {
    const next = new URLSearchParams(params.toString());
    const put = (k: string, v: string, empty: string) => (v && v !== empty ? next.set(k, v) : next.delete(k));
    put("status", status, "ALL");
    put("kind", group, "ALL");
    const s = next.toString();
    if (s !== params.toString()) router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [status, group, params, pathname, router]);

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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="stock-all" className="text-lg font-semibold tracking-tight text-fg">
          {q ? <>Matches for “{q}”</> : "All stock"} {counts && <span className="ml-1 text-sm font-normal tabular-nums text-fg-muted">{num(counts.ALL)}</span>}
        </h2>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <SegmentedControl aria-label="Kind" value={group} onChange={setGroup} options={groups.map((g) => ({ value: g, testId: `stock-kind-${g}`, label: g === "ALL" ? "Everything" : GROUP_LABEL[g] }))} />
        </div>
      </div>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <SegmentedControl
          aria-label="Show"
          value={status}
          onChange={setStatus}
          options={statuses.map((s) => ({ value: s, testId: `stock-filter-${s}`, label: <>{STATUS_LABEL[s]}{counts && <span className="tabular-nums text-fg-subtle">{num(counts[s])}</span>}</> }))}
        />
      </div>

      <div className="overflow-hidden rounded-2xl bg-surface shadow">
        {list.isLoading ? (
          <div className="space-y-1 p-2" aria-busy="true" aria-label="Loading stock">
            {[0, 1, 2, 3, 4, 5].map((k) => <div key={k} className="flex items-center gap-3 p-2"><Skeleton className="h-11 w-11 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-1/3" /></div></div>)}
          </div>
        ) : list.isError ? (
          <p className="px-4 py-6 text-sm text-fg-muted">{getErrorMessage(list.error, "The stock list couldn't be loaded.")} <button type="button" onClick={() => list.refetch()} className="font-medium text-fg underline underline-offset-4">Try again</button></p>
        ) : items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-fg-muted" data-testid="stock-list-empty">
            {q ? <>Nothing matches “{q}”. Try fewer words, or check the kind and status above.</> : status !== "ALL" ? <>Nothing is {STATUS_LABEL[status].toLowerCase()} right now.</> : "No stock-tracked items yet."}
          </p>
        ) : (
          <ul aria-busy={list.isPlaceholderData || undefined} className={cn("divide-y divide-line-subtle transition-opacity duration-base", list.isPlaceholderData && "opacity-60")}>
            {items.map((i) => (
              <li key={i.variantId}>
                <button
                  type="button"
                  onClick={() => onOpen(i)}
                  aria-current={selectedId === i.variantId ? "true" : undefined}
                  data-testid={`stock-row-${i.sku}`}
                  className={cn(
                    "grid w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 text-left transition-colors duration-fast hover:bg-ink-900/[0.025] focus-visible:bg-ink-900/[0.04] sm:px-4 md:grid-cols-[2.75rem_minmax(0,1fr)_auto_8.5rem_7rem]",
                    selectedId === i.variantId && "bg-accent/[0.06] hover:bg-accent/[0.08]",
                  )}
                >
                  <ItemThumb imageUrl={i.imageUrl} name={i.productName} unit={i.unit} attar={i.group === "FILL_TO_ORDER"} />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[15px] leading-snug text-fg"><Highlight text={i.productName} query={q} /></span>
                    <span className="block truncate text-xs text-fg-muted"><Highlight text={metaOf(i)} query={q} /><span className="md:hidden"> · {figureOf(i, true)}</span></span>
                  </span>
                  <span className="hidden whitespace-nowrap text-right text-sm tabular-nums text-fg md:block">{figureOf(i)}</span>
                  <span className="hidden md:block"><Lasts item={i} /></span>
                  <span className="justify-self-end"><StatusPill item={i} /></span>
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
      </div>
    </section>
  );
}

