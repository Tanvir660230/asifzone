"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import type { StockItem, StockRoll } from "@/lib/api/stock";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { byProduct, colorOf, num, sizeOf, spacedUnit, spreadWords, variantWords, type ProductGroup } from "./stock-shared";

/**
 * One group of the overview: a heading with its own summary, then a calm list — columns from `sm` up (the header row is
 * visual only; each figure carries its own screen-reader label), a stacked row on phones.
 */
function Group({ id, title, summary, columns, header, children, testId }: { id: string; title: string; summary?: ReactNode; columns: string; header: string[]; children: ReactNode; testId: string }) {
  return (
    <section aria-labelledby={id} className="space-y-3" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
        {summary && <p className="text-sm text-fg-muted">{summary}</p>}
      </div>
      <Card className="overflow-hidden p-0">
        <div aria-hidden="true" className={cn("hidden border-b border-line-subtle bg-surface-muted px-4 py-2 text-xs font-medium text-fg-muted sm:grid sm:gap-4", columns)}>
          {header.map((h, i) => <span key={`${h}-${i}`} className={i ? "text-right" : undefined}>{h}</span>)}
        </div>
        <ul className="divide-y divide-line-subtle">{children}</ul>
      </Card>
    </section>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-fg-subtle">{children}</span>;
const Sr = ({ children }: { children: ReactNode }) => <span className="sr-only">{children} </span>;
const days = (d: number | null) => (d === null ? <Muted>—</Muted> : d === 0 ? "None left" : `${num(d)} day${d === 1 ? "" : "s"}`);
const money = (v: number | null) => (v === null ? <Muted>—</Muted> : formatPrice(v));
const Empty = ({ children }: { children: ReactNode }) => <li className="px-4 py-6 text-sm text-fg-muted">{children}</li>;

// ── Sells as is (caps…) ──────────────────────────────────────────────────────────────────────────────────────────────

const FINISHED_COLS = "sm:grid-cols-[minmax(0,1fr)_6rem_6rem_8rem_1.25rem]";

export function FinishedGroup({ items, showCost }: { items: StockItem[]; showCost: boolean }) {
  const products = useMemo(() => byProduct(items), [items]);
  const [showEmpty, setShowEmpty] = useState(false);
  const withStock = products.filter((p) => p.stock > 0 || p.reserved > 0);
  const empty = products.length - withStock.length;
  const shown = showEmpty ? products : withStock;
  const units = products.reduce((s, p) => s + p.stock, 0);
  const value = products.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <Group
      id="stock-finished"
      testId="stock-group-finished"
      title="Sells as is"
      summary={<>{num(units)} pcs{showCost ? <> · {formatPrice(value)}</> : null}</>}
      columns={FINISHED_COLS}
      header={["Product", "In stock", "On orders", showCost ? "Value" : "", ""]}
    >
      {products.length === 0 && <Empty>Nothing here yet. Caps and other ready goods appear once they are stock-tracked.</Empty>}
      {shown.map((p) => <FinishedProduct key={p.productId} group={p} showCost={showCost} />)}
      {empty > 0 && (
        <li>
          <button type="button" onClick={() => setShowEmpty((s) => !s)} aria-expanded={showEmpty} className="w-full px-4 py-3 text-left text-sm text-fg-muted transition-colors duration-fast hover:bg-ink-900/[0.03] hover:text-fg">
            {showEmpty ? "Hide products with none in stock" : `Show ${empty} product${empty === 1 ? "" : "s"} with none in stock`}
          </button>
        </li>
      )}
    </Group>
  );
}

function FinishedProduct({ group, showCost }: { group: ProductGroup; showCost: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const single = group.items.length === 1;
  return (
    <li data-testid="stock-product">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn("grid w-full grid-cols-[minmax(0,1fr)_auto_1.25rem] items-center gap-x-4 gap-y-0.5 px-4 py-3 text-left transition-colors duration-fast hover:bg-ink-900/[0.03] sm:gap-4", FINISHED_COLS)}
      >
        <span className="min-w-0">
          <span className="block text-[15px] text-fg sm:truncate">{group.name}</span>
          <span className="block text-xs text-fg-muted">
            {single ? variantWords(group.items[0]!) : spreadWords(group.items)}
            {group.reserved > 0 && <span className="sm:hidden"> · {num(group.reserved)} on orders</span>}
          </span>
        </span>
        <span className="text-right tabular-nums text-fg sm:text-[15px]"><Sr>In stock</Sr>{num(group.stock)}<span className="text-xs text-fg-muted sm:hidden"> pcs</span></span>
        <span className="hidden text-right tabular-nums text-fg-muted sm:block"><Sr>On orders</Sr>{group.reserved ? num(group.reserved) : <Muted>—</Muted>}</span>
        <span className="hidden text-right tabular-nums text-fg-muted sm:block">{showCost ? <><Sr>Value</Sr>{money(group.value)}</> : null}</span>
        <ChevronDown aria-hidden="true" className={cn("h-4 w-4 justify-self-end text-fg-subtle transition-transform duration-base ease-smooth", open && "rotate-180")} />
      </button>
      {open && (
        <div id={panelId} className="animate-fade-in border-t border-line-subtle bg-surface-muted/60 px-4 py-3">
          <VariantGrid items={group.items} />
        </div>
      )}
    </li>
  );
}

/** Colours × sizes: what is in stock, with the units waiting on orders under it. */
function VariantGrid({ items }: { items: StockItem[] }) {
  const sizes = [...new Set(items.map((i) => sizeOf(i) ?? ""))];
  const colors = [...new Set(items.map((i) => colorOf(i) ?? ""))];
  const at = new Map(items.map((i) => [`${colorOf(i) ?? ""}|${sizeOf(i) ?? ""}`, i]));
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <Table data-no-stack="" className="w-auto border-separate border-spacing-0 text-sm">
        <caption className="sr-only">In stock by colour and size</caption>
        <thead>
          <tr>
            <th scope="col" className="py-1 pr-4 text-left text-xs font-medium text-fg-muted"><span className="sr-only">Colour</span></th>
            {sizes.map((s) => <th key={s} scope="col" className="min-w-[4.5rem] px-2 py-1 text-right text-xs font-medium text-fg-muted">{s || "—"}</th>)}
          </tr>
        </thead>
        <tbody>
          {colors.map((c) => (
            <tr key={c}>
              <th scope="row" className="py-1.5 pr-4 text-left text-xs font-medium text-fg">{c || "—"}</th>
              {sizes.map((s) => {
                const i = at.get(`${c}|${s}`);
                if (!i) return <td key={s} className="px-2 py-1.5 text-right text-fg-subtle"><span aria-label="No such variant">·</span></td>;
                return (
                  <td key={s} className="px-2 py-1.5 text-right align-top tabular-nums">
                    <span className={i.stock > 0 ? "text-fg" : "text-fg-subtle"}>{num(Math.max(0, i.stock))}</span>
                    {i.reserved > 0 && <span className="block text-xs text-fg-muted">{num(i.reserved)} on order</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

// ── Filled to order (attar) ──────────────────────────────────────────────────────────────────────────────────────────

const FILL_COLS = "sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem_7rem]";

export function FillGroup({ items }: { items: StockItem[] }) {
  const products = useMemo(() => byProduct(items), [items]);
  const toFill = items.reduce((s, i) => s + Math.max(0, -i.stock), 0);
  return (
    <Group
      id="stock-fill"
      testId="stock-group-fill"
      title="Filled to order"
      summary={items.length ? (toFill > 0 ? `${num(toFill)} bottle${toFill === 1 ? "" : "s"} to fill for orders` : "Every order has its bottle") : undefined}
      columns={FILL_COLS}
      header={["Attar and size", "Filled", "On orders", "To fill", "Can make"]}
    >
      {products.length === 0 && <Empty>No attar is set to fill to order yet.</Empty>}
      {products.map((p) => (
        <li key={p.productId} className="py-1" data-testid="stock-fill-product">
          <p className="px-4 pb-1 pt-2 text-[15px] font-medium text-fg">{p.name}</p>
          <ul>
            {p.items.map((i) => {
              const toFillNow = Math.max(0, -i.stock);
              return (
                <li key={i.variantId} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-1.5 sm:gap-4", FILL_COLS)} data-testid="stock-fill-row">
                  <span className="min-w-0 text-sm text-fg-muted">
                    <span className="text-fg">{spacedUnit(variantWords(i))}</span>
                    {i.daysLeft !== null && <span className="text-fg-subtle"> · {i.daysLeft === 0 ? "none left" : `about ${num(i.daysLeft)} days`}</span>}
                    <span className="block text-xs sm:hidden">{num(i.expectedOnShelf)} filled · {num(i.reserved)} on orders{toFillNow ? ` · ${num(toFillNow)} to fill` : ""}</span>
                  </span>
                  <span className="hidden text-right text-sm tabular-nums text-fg sm:block"><Sr>Filled</Sr>{num(i.expectedOnShelf)}</span>
                  <span className="hidden text-right text-sm tabular-nums text-fg-muted sm:block"><Sr>On orders</Sr>{i.reserved ? num(i.reserved) : <Muted>—</Muted>}</span>
                  <span className={cn("hidden text-right text-sm tabular-nums sm:block", toFillNow ? "font-medium text-fg" : "text-fg-muted")}><Sr>To fill</Sr>{toFillNow ? num(toFillNow) : <Muted>—</Muted>}</span>
                  <span className="flex items-center justify-end gap-2 text-right tabular-nums">
                    {i.low && <Badge variant="warning">Low</Badge>}
                    <span className="text-[15px] text-fg"><span className="text-xs text-fg-muted sm:hidden">can make </span><span className="sr-only max-sm:hidden">Can make </span>{num(i.makeable ?? 0)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </Group>
  );
}

// ── Materials ────────────────────────────────────────────────────────────────────────────────────────────────────────

const MAT_COLS_COST = "sm:grid-cols-[minmax(0,1fr)_7rem_6rem_7rem_6rem]";
const MAT_COLS = "sm:grid-cols-[minmax(0,1fr)_7rem_6rem]";

/** "Empty attar bottle 6 ml" + "6 ml" → no repeat; "Attar oil — ROYAL AMBER" + "Bulk oil" → shown under it. */
function materialWords(i: StockItem): string | null {
  const w = variantWords(i);
  if (w === i.sku) return null;
  return i.productName.toLowerCase().includes(w.toLowerCase()) ? null : w;
}

export function MaterialGroup({ items, rolls, showCost }: { items: StockItem[]; rolls: StockRoll[]; showCost: boolean }) {
  const low = items.filter((i) => i.low).length;
  const cols = showCost ? MAT_COLS_COST : MAT_COLS;
  return (
    <Group
      id="stock-materials"
      testId="stock-group-materials"
      title="Materials"
      summary={low ? <span className="text-warning-700">{low} running low</span> : items.length ? "Nothing running low" : undefined}
      columns={cols}
      header={showCost ? ["Material", "In stock", "Average", "Value", "Lasts"] : ["Material", "In stock", "Lasts"]}
    >
      {items.length === 0 && <Empty>No materials yet. Oil, bottles, boxes and stickers appear here once they are set up.</Empty>}
      {items.map((i) => {
        const sub = materialWords(i);
        const lasts = i.daysLeft === null ? "not used lately" : i.daysLeft === 0 ? "none left" : `lasts about ${num(i.daysLeft)} days`;
        return (
          <li key={i.variantId} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 sm:gap-4", cols)} data-testid="stock-material-row">
            <span className="min-w-0">
              <span className="block text-[15px] text-fg sm:truncate">{i.productName}</span>
              <span className="block text-xs text-fg-muted">
                {sub}
                <span className="sm:hidden">{sub ? " · " : ""}{lasts}</span>
              </span>
            </span>
            <span className="flex items-center justify-end gap-2 text-right tabular-nums">
              {i.low && <Badge variant="warning">Low</Badge>}
              <span className="text-[15px] text-fg"><Sr>In stock</Sr>{num(i.stock)} <span className="text-xs text-fg-muted">{i.unit}</span></span>
            </span>
            {showCost && <span className="hidden text-right text-sm tabular-nums text-fg-muted sm:block"><Sr>Average cost</Sr>{i.avgCost === null ? <Muted>—</Muted> : formatPrice(i.avgCost)}</span>}
            {showCost && <span className="hidden text-right text-sm tabular-nums text-fg-muted sm:block"><Sr>Value</Sr>{money(i.value)}</span>}
            <span className={cn("hidden text-right text-sm tabular-nums sm:block", i.low ? "font-medium text-warning-700" : "text-fg-muted")}><Sr>Lasts</Sr>{days(i.daysLeft)}</span>
          </li>
        );
      })}
      {rolls.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm" data-testid="stock-roll">
          <span className="min-w-0 text-fg-muted"><span className="text-fg">{r.material.replace(/\b(\w+)\s+\1$/i, "$1")} in use</span> since {formatBookDate(r.openedOn)}, {num(r.parcels)} parcel{r.parcels === 1 ? "" : "s"} wrapped so far</span>
          <Link href="/admin/finance/stock-check" className="text-sm font-medium text-fg underline-offset-4 hover:underline">Finish a roll</Link>
        </li>
      ))}
    </Group>
  );
}
