/**
 * The product action list (docs/METRICS_REGISTRY.md §4.10): the existing product signals — stock and selling speed per
 * variant, views → add to cart → orders, refusals, stock nobody orders — turned into what to DO, most urgent first. Each
 * rule needs enough data to mean something (a few views never trigger "fix the page"). Pure; money in major units.
 */

import { currencySymbol } from "@clothing-brand/shared";

export type ProductActionKind = "sold_out" | "restock" | "refusals" | "fix_page" | "clear_stock" | "promote";

export interface VariantSignal {
  /** "M", "Black / L", or the SKU. */
  label: string;
  stock: number;
  /** Units ordered per day over the last 30 days. */
  unitsPerDay: number;
  unitsSold30: number;
}

export interface ProductSignals {
  id: string;
  name: string;
  slug: string;
  /** Last 30 days. */
  views: number;
  addToCarts: number;
  orders: number;
  /** Tracked, sellable variants. */
  variants: VariantSignal[];
  /** Cost value of variants with stock and no order in 60 days. */
  deadStockValue: number;
  /** Finished parcels / refused, last 60 days (§4.7). */
  parcels: number;
  refused: number;
}

export interface StoreBaseline {
  viewToCartRate: number;
  viewToOrderRate: number;
  refusalRate: number;
  currency: string;
}

export interface ProductAction {
  productId: string;
  name: string;
  slug: string;
  kind: ProductActionKind;
  /** 1 = today, 2 = this week, 3 = when there's time. */
  priority: 1 | 2 | 3;
  title: string;
  detail: string;
  /** Orders within the same priority (smaller = more urgent). */
  sortKey: number;
}

export const RESTOCK_DAYS = 7;
const MIN_VIEWS_FOR_PAGE = 300;
const MIN_PARCELS_FOR_REFUSALS = 5;
const MIN_VIEWS_FOR_PROMOTE = 50;
const MAX_VIEWS_FOR_PROMOTE = 1000;
const MIN_ORDERS_FOR_PROMOTE = 3;

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const pct0 = (r: number) => `${Math.round(r * 100)}%`;
const n = (v: number) => Math.round(v).toLocaleString("en-US");
const money = (v: number, currency: string) => `${currencySymbol(currency)}${n(v)}`;
const perDay = (v: number) => (v >= 1 ? n(v) : v.toFixed(1));

export function productActions(products: ProductSignals[], store: StoreBaseline): ProductAction[] {
  const out: ProductAction[] = [];
  for (const p of products) {
    const add = (kind: ProductActionKind, priority: ProductAction["priority"], title: string, detail: string, sortKey: number) =>
      out.push({ productId: p.id, name: p.name, slug: p.slug, kind, priority, title, detail, sortKey });

    for (const v of p.variants) {
      if (v.stock <= 0 && v.unitsSold30 >= 3) {
        add("sold_out", 1, `${v.label} is sold out`, `Ordered ${n(v.unitsSold30)} times in the last 30 days`, -v.unitsSold30);
      } else if (v.stock > 0 && v.unitsPerDay > 0) {
        const days = v.stock / v.unitsPerDay;
        // Priority from the same rounded number the title shows, so "about 3 days" is always "Do today".
        const shown = Math.max(1, Math.round(days));
        if (days <= RESTOCK_DAYS) add("restock", shown <= 3 ? 1 : 2, `Restock ${v.label} — about ${shown} day${shown === 1 ? "" : "s"} left`, `${n(v.stock)} left, selling about ${perDay(v.unitsPerDay)} a day`, days);
      }
    }

    if (p.parcels >= MIN_PARCELS_FOR_REFUSALS && p.refused > 0) {
      const rate = p.refused / p.parcels;
      if (rate >= Math.max(store.refusalRate * 2, store.refusalRate + 0.1)) {
        add("refusals", 2, `Refused ${pct0(rate)} of the time`, `${n(p.refused)} of ${n(p.parcels)} parcels came back (store: ${pct0(store.refusalRate)}) — check it matches the photos and sizes`, -rate);
      }
    }

    if (p.views >= MIN_VIEWS_FOR_PAGE && store.viewToCartRate > 0) {
      const rate = p.addToCarts / p.views;
      if (rate < store.viewToCartRate / 2) {
        add("fix_page", 2, "Many look, few add to cart", `${n(p.views)} views, ${pct(rate)} added to cart (store: ${pct(store.viewToCartRate)}) — check photos, price and size info`, rate);
      }
    }

    if (p.deadStockValue > 0) {
      add("clear_stock", 3, `${money(p.deadStockValue, store.currency)} of stock not selling`, "No orders in 60 days — discount it, bundle it or stop restocking", -p.deadStockValue);
    }

    const cover = p.variants.reduce((s, v) => s + v.stock, 0) / Math.max(1e-9, p.variants.reduce((s, v) => s + v.unitsPerDay, 0));
    if (p.views >= MIN_VIEWS_FOR_PROMOTE && p.views <= MAX_VIEWS_FOR_PROMOTE && p.orders >= MIN_ORDERS_FOR_PROMOTE && store.viewToOrderRate > 0) {
      const rate = p.orders / p.views;
      if (rate >= store.viewToOrderRate * 2 && cover > RESTOCK_DAYS * 2) {
        add("promote", 3, "Converts well — show it to more people", `${pct(rate)} of viewers order (store: ${pct(store.viewToOrderRate)}) from only ${n(p.views)} views`, -rate);
      }
    }
  }
  // Within a priority: stock problems first (they cost sales today), then the rest, each by its own urgency.
  const rank: Record<ProductActionKind, number> = { sold_out: 0, restock: 1, refusals: 2, fix_page: 3, clear_stock: 4, promote: 5 };
  return out.sort((a, b) => a.priority - b.priority || rank[a.kind] - rank[b.kind] || a.sortKey - b.sortKey);
}
