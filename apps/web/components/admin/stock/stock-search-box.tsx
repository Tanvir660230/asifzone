"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, XCircle } from "lucide-react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { listStockItems, smartKeys, type StockListItem } from "@/lib/api/stock-smart";
import { cn } from "@/lib/utils";
import { Highlight, ItemThumb } from "./item-thumb";
import { num, spacedUnit } from "./stock-shared";

export type QuickAction = "fill" | "reorder" | "count";

/** The one thing to do with an item now, by its status. */
export function quickActionOf(i: StockListItem): { action: QuickAction; label: string } {
  if (i.status === "NEEDS_FILL") return { action: "fill", label: "Fill" };
  if ((i.status === "OUT" || i.status === "LOW") && i.group !== "FILL_TO_ORDER") return { action: "reorder", label: "Reorder" };
  return { action: "count", label: "Count" };
}

/** The item's key figure: an attar's bottles to fill or what it can sell; anything else, what is on the shelf (and, with
 * `days`, how long that lasts). */
export function figureOf(i: StockListItem, days = false): string {
  if (i.group === "FILL_TO_ORDER") return i.status === "NEEDS_FILL" ? `${num(i.policy?.owed ?? 0)} to fill · sells ${i.canSell === null ? "any" : num(i.canSell)}` : i.canSell === null ? "sells any" : `sells ${num(i.canSell)}`;
  // Blueprint P1.3: the level on hand and, beside it, what is already promised to orders not yet packed
  const free = `${num(Math.max(0, i.stock))} ${i.unit === "pcs" ? "pcs" : spacedUnit(i.unit)}`;
  const shelf = i.reserved > 0 ? `${free} · ${num(i.reserved)} on orders` : free;
  return days && i.daysLeft !== null ? `${shelf} · ${i.daysLeft === 0 ? "none left" : `${num(i.daysLeft)} days`}` : shelf;
}

const HINTS = ["zayan 12", "black xl", "bottle", "oil"];

/**
 * Find anything in stock as you'd say it (docs/STOCK_HUB.md §7): words in any order, typos forgiven. Results appear as you
 * type, with their pictures and the one thing to do with each; Enter (or a click) opens the item, ↑/↓ move, Esc closes.
 * The text also filters the list below. "/" anywhere on the page jumps here (the shell focuses the field marked data-page-search).
 */
export function StockSearchBox({ value, onChange, onOpen, onAction }: { value: string; onChange: (v: string) => void; onOpen: (i: StockListItem) => void; onAction: (i: StockListItem, a: QuickAction) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebouncedValue(value.trim(), 120);
  const results = useQuery({
    queryKey: smartKeys.list({ q, limit: 6 }),
    queryFn: () => listStockItems({ q, limit: 6 }),
    enabled: open && q.length > 0,
    placeholderData: (p) => p,
  });
  const items = q ? results.data?.items ?? [] : [];
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (i: StockListItem) => { setOpen(false); onOpen(i); };

  return (
    <div ref={boxRef} className="relative" data-testid="stock-search-box">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          aria-label="Find in stock"
          placeholder="Search stock — “zayan 12”, “black xl”"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && open && items[active]) { e.preventDefault(); pick(items[active]!); }
            else if (e.key === "Escape") { if (open) setOpen(false); else onChange(""); }
          }}
          className="ui-control !h-12 rounded-2xl pl-12 pr-24 text-[15px] shadow-float [&::-webkit-search-cancel-button]:hidden"
          data-testid="stock-search"
          data-page-search=""
        />
        <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {value ? (
            <button type="button" onClick={() => { onChange(""); inputRef.current?.focus(); }} aria-label="Clear search" className="text-fg-subtle transition-colors duration-fast hover:text-fg"><XCircle className="h-5 w-5" /></button>
          ) : (
            <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-fg-subtle sm:inline">/</kbd>
          )}
        </span>
      </div>

      {open && (q.length > 0 ? (
        <div className="ui-floating absolute left-0 right-0 top-full z-overlay mt-2 overflow-hidden p-1.5" role="presentation">
          {items.length === 0 ? (
            <p className="px-3 py-3 text-sm text-fg-muted" data-testid="stock-search-none">{results.isFetching ? "Looking…" : <>Nothing matches “{q}”. Try fewer words.</>}</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Matches" data-testid="stock-search-results">
              {items.map((i, k) => {
                const qa = quickActionOf(i);
                return (
                  <li key={i.variantId} id={`${listId}-${k}`} role="option" aria-selected={k === active} onMouseEnter={() => setActive(k)}
                    className={cn("flex items-center gap-3 rounded-xl px-2.5 py-2", k === active && "bg-ink-900/[0.045]")}>
                    <button type="button" tabIndex={-1} onClick={() => pick(i)} className="flex min-w-0 flex-1 items-center gap-3 text-left" data-testid="stock-search-result">
                      <ItemThumb imageUrl={i.imageUrl} name={i.productName} unit={i.unit} attar={i.group === "FILL_TO_ORDER"} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-fg"><Highlight text={i.label} query={q} /></span>
                        <span className="block truncate text-xs text-fg-muted">{figureOf(i, true)}</span>
                      </span>
                    </button>
                    <button type="button" tabIndex={-1} onClick={() => { setOpen(false); onAction(i, qa.action); }} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-medium text-fg transition-colors duration-fast hover:border-ink-400 hover:bg-surface" data-testid={`stock-search-${qa.action}`}>
                      {qa.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className="ui-floating absolute left-0 right-0 top-full z-overlay mt-2 p-3 text-sm text-fg-muted" role="presentation">
          Try {HINTS.map((h, k) => <span key={h}>{k > 0 && ", "}<button type="button" className="font-medium text-fg underline-offset-4 hover:underline" onClick={() => { onChange(h); inputRef.current?.focus(); }}>{h}</button></span>)} — words in any order, typos are fine.
        </div>
      ))}
    </div>
  );
}
