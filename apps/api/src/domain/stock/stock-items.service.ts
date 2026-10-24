/**
 * The stock list (docs/STOCK_HUB.md §7, /admin/stock): every stock-tracked item from the stock hub overview, each with a
 * status that says what to do — NEEDS_FILL (bottles sold, not yet filled), OUT (nothing to sell), LOW (10 days or less,
 * or 10 or fewer to sell), OK, EMPTY (none left and no recent use or orders) — what it can still sell, the recipe material that limits a fill-to-order item, and for a
 * bought item (material or finished goods) how much to reorder and by when:
 *
 *   suggested = max(0, ⌈used per day × (days to arrive + days to cover)⌉ − available)
 *   order by  = today + max(0, ⌊available ÷ used per day⌋ − days to arrive)
 *
 * where a material's available stock is what owed bottles haven't already claimed. Searched and filtered here (not in the
 * browser), sorted by urgency then SKU, and paged by an opaque cursor; the status counts honour the search and group but
 * not the status, so the filter chips always show what each holds.
 */
import { addDays, sellable, stockItemsQuerySchema, type StockItemsQuery, type StockStatus } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { businessToday, getFinanceContext } from "../finance/finance-context";
import { financeError } from "../finance/finance-values";
import { UNLIMITED_UNITS } from "./fill-capacity.service";
import { getItemSettings, type ItemSettings } from "./item-settings.service";
import { stockHub, type StockHubGroupKey, type StockHubItem } from "./stock-hub.service";

export interface StockListItem extends StockHubItem {
  group: StockHubGroupKey;
  /** A short name for lists: the product, plus the size / colour only where the product name doesn't already say it. */
  label: string;
  status: StockStatus;
  /** What the shop can still sell: filled + makeable for a fill-to-order item, the shelf otherwise; null = unlimited. */
  canSell: number | null;
  limitedBy: { variantId: string; name: string } | null;
  reorder: { suggested: number; orderBy: string } | null;
  settings: ItemSettings;
}

type Classifiable = Pick<StockHubItem, "stock" | "makeable" | "low" | "usedPerDay" | "reserved"> & { policy: { owed: number; policy: string } | null };

const BLANK = new Set(["", "-", "standard", "default"]);
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const spaced = (s: string) => s.replace(/^(\d+(?:\.\d+)?)\s*(ml|g|kg|l)$/i, "$1 $2");

/** "Premium Pakistani Cap - Black A" + 2XL / Black → "Premium Pakistani Cap - Black A — 2XL"; "Empty attar bottle 6 ml" + 6ml
 * → "Empty attar bottle 6 ml". A material is named by its product alone. */
export function itemLabel(i: { productName: string; size: string | null; color: string | null }, group?: StockHubGroupKey): string {
  if (group === "MATERIAL") return i.productName;
  const name = squash(i.productName);
  const parts = [i.size, i.color].map((p) => p?.trim() ?? "").filter((p) => !BLANK.has(p.toLowerCase()) && !name.includes(squash(p)));
  return parts.length ? `${i.productName} — ${parts.map(spaced).join(" / ")}` : i.productName;
}

export function canSellOf(i: Pick<StockHubItem, "stock" | "makeable">): number | null {
  if (i.makeable === null) return Math.max(0, i.stock);
  if (i.makeable >= UNLIMITED_UNITS) return null;
  return sellable(i.stock, i.makeable);
}

export function classify(i: Classifiable): StockStatus {
  if ((i.policy?.owed ?? 0) > 0) return "NEEDS_FILL";
  const can = canSellOf(i);
  // none left and nobody wants it: a size that isn't stocked any more is not an emergency
  if (can === 0) return (i.usedPerDay ?? 0) > 0 || i.reserved > 0 ? "OUT" : "EMPTY";
  if (i.low && can !== null) return "LOW";
  return "OK";
}

export function suggestReorder(i: { usedPerDay: number | null; available: number; leadTimeDays: number; coverDays: number; today: string }): { suggested: number; orderBy: string } | null {
  if (!i.usedPerDay || i.usedPerDay <= 0) return null;
  // owed bottles may already claim more than is on the shelf (available < 0): that shortfall is part of what to buy
  const suggested = Math.max(0, Math.ceil(i.usedPerDay * (i.leadTimeDays + i.coverDays) - 1e-9 - i.available));
  const lasts = Math.floor(Math.max(0, i.available) / i.usedPerDay);
  return { suggested, orderBy: addDays(i.today, Math.max(0, lasts - i.leadTimeDays)) };
}

const STATUS_ORDER: Record<StockStatus, number> = { NEEDS_FILL: 0, OUT: 1, LOW: 2, OK: 3, EMPTY: 4 };
const pad = (n: number) => String(Math.max(0, Math.min(999_999, Math.round(n)))).padStart(6, "0");

/** A sort key: NEEDS_FILL most owed first, OUT, LOW fewest days first, OK by name — then SKU, so the order is total. */
export function rankOf(r: { status: StockStatus; owed: number; daysLeft: number | null; name: string; sku: string }): string {
  const second = r.status === "NEEDS_FILL" ? pad(999_999 - r.owed) : r.status === "LOW" ? pad(r.daysLeft ?? 999_998) : r.name.toLowerCase();
  return `${STATUS_ORDER[r.status]}|${second}|${r.sku}`;
}

interface RecipeLine { materialVariantId: string; qtyPerUnit: number; wastagePct: number }
const needOf = (l: RecipeLine) => l.qtyPerUnit * (1 + l.wastagePct / 100);

/** The recipe material that makes the fewest units from what is in stock (first such line on a tie); null without one. */
export function limitingMaterial(lines: RecipeLine[], materialStock: Map<string, number>): string | null {
  let best: { id: string; units: number } | null = null;
  for (const l of lines) {
    const need = needOf(l);
    if (need <= 0) continue;
    const units = Math.floor(Math.max(0, materialStock.get(l.materialVariantId) ?? 0) / need);
    if (!best || units < best.units) best = { id: l.materialVariantId, units };
  }
  return best?.id ?? null;
}

/** Approved recipe lines (supplied by the business) per fill-to-order variant. */
async function recipesByVariant(): Promise<Map<string, RecipeLine[]>> {
  const products = await prisma.product.findMany({
    where: { fillToOrder: true, deletedAt: null },
    select: {
      variants: { select: { id: true } },
      billsOfMaterials: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1, select: { lines: { where: { suppliedBy: "BUSINESS" }, select: { finishedVariantId: true, materialVariantId: true, qtyPerUnit: true, wastagePct: true } } } },
    },
  });
  const out = new Map<string, RecipeLine[]>();
  for (const p of products) {
    for (const v of p.variants) {
      const lines = (p.billsOfMaterials[0]?.lines ?? []).filter((l) => !l.finishedVariantId || l.finishedVariantId === v.id);
      out.set(v.id, lines.map((l) => ({ materialVariantId: l.materialVariantId, qtyPerUnit: Number(l.qtyPerUnit), wastagePct: Number(l.wastagePct) })));
    }
  }
  return out;
}

const encodeCursor = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const o = (JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { o?: unknown }).o;
    if (typeof o === "number" && Number.isInteger(o) && o >= 0) return o;
  } catch { /* fall through */ }
  throw financeError(400, "STOCK_CURSOR_INVALID", "This page link is no longer valid — reload the list");
}

type AllStock = { items: StockListItem[]; today: string; hub: Awaited<ReturnType<typeof stockHub>>; claimed: Map<string, number> };

/** Paging, typing a search and the filter chips re-read the same list: it is kept while nothing it rests on has moved —
 * stock movements, orders, products, sizes, recipes and settings — and for at most MEMO_MS (the day rolls over). */
const MEMO_MS = 30_000;
const memo = new Map<string, { version: string; at: number; value: Promise<AllStock> }>();
async function versionOf(): Promise<string> {
  // stock and orders move the figures; products and variants (selling rule, fill to order, new sizes), recipes and
  // settings change what they mean
  const [moved, orders, settings, products, variants, recipes] = await Promise.all([
    prisma.stockMovement.aggregate({ _max: { createdAt: true }, _count: { _all: true } }),
    prisma.order.aggregate({ _max: { updatedAt: true } }),
    prisma.stockItemSetting.aggregate({ _max: { updatedAt: true } }),
    prisma.product.aggregate({ _max: { updatedAt: true } }),
    prisma.productVariant.aggregate({ _max: { updatedAt: true } }),
    prisma.billOfMaterials.aggregate({ _max: { updatedAt: true } }),
  ]);
  return [moved._max.createdAt, moved._count._all, orders._max.updatedAt, settings._max.updatedAt, products._max.updatedAt, variants._max.updatedAt, recipes._max.updatedAt]
    .map((x) => (x instanceof Date ? x.getTime() : x))
    .join("|");
}

/** Every item, classified and sorted — the list's source and what Today summarises. */
export async function allStockItems(viewer: { canSeeCost: boolean }): Promise<AllStock> {
  const key = viewer.canSeeCost ? "cost" : "plain";
  const version = await versionOf();
  const hit = memo.get(key);
  if (hit && hit.version === version && Date.now() - hit.at < MEMO_MS) return hit.value;
  const value = computeStockItems(viewer);
  memo.set(key, { version, at: Date.now(), value });
  value.catch(() => memo.delete(key));
  return value;
}

async function computeStockItems(viewer: { canSeeCost: boolean }): Promise<AllStock> {
  const [hub, recipes, { business }] = await Promise.all([stockHub(viewer), recipesByVariant(), getFinanceContext()]);
  const today = businessToday(business);
  const flat = hub.groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.key })));
  const settings = await getItemSettings(flat.map((i) => i.variantId));
  const byId = new Map(flat.map((i) => [i.variantId, i]));
  const materialStock = new Map(flat.filter((i) => i.group === "MATERIAL").map((i) => [i.variantId, i.stock]));
  // what owed bottles will take from each material when they are filled
  const claimed = new Map<string, number>();
  for (const i of flat) {
    const owed = i.policy?.owed ?? 0;
    if (!owed) continue;
    for (const l of recipes.get(i.variantId) ?? []) claimed.set(l.materialVariantId, (claimed.get(l.materialVariantId) ?? 0) + owed * needOf(l));
  }
  const items = flat.map((i): StockListItem => {
    const s = settings.get(i.variantId)!;
    const limit = i.group === "FILL_TO_ORDER" ? limitingMaterial(recipes.get(i.variantId) ?? [], materialStock) : null;
    const available = i.group === "MATERIAL" ? Math.floor(i.stock - (claimed.get(i.variantId) ?? 0)) : i.stock;
    return {
      ...i,
      label: itemLabel(i, i.group),
      status: classify(i),
      canSell: canSellOf(i),
      limitedBy: limit ? { variantId: limit, name: byId.get(limit)?.productName ?? "" } : null,
      reorder: i.group === "FILL_TO_ORDER" ? null : suggestReorder({ usedPerDay: i.usedPerDay, available, leadTimeDays: s.leadTimeDays, coverDays: s.coverDays, today }),
      settings: s,
    };
  });
  items.sort((a, b) => {
    const x = rankOf({ ...a, owed: a.policy?.owed ?? 0 });
    const y = rankOf({ ...b, owed: b.policy?.owed ?? 0 });
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return { items, today, hub, claimed };
}

export async function listStockItems(raw: StockItemsQuery, viewer: { canSeeCost: boolean }) {
  const query = stockItemsQuerySchema.parse(raw);
  const offset = decodeCursor(query.cursor);
  const { items } = await allStockItems(viewer);
  const needle = query.q?.toLowerCase();
  const scoped = items.filter((i) => (!query.group || i.group === query.group) && (!needle || i.sku.toLowerCase().includes(needle) || i.name.toLowerCase().includes(needle) || i.productName.toLowerCase().includes(needle)));
  const counts: Record<StockStatus | "ALL", number> = { ALL: scoped.length, NEEDS_FILL: 0, OUT: 0, LOW: 0, OK: 0, EMPTY: 0 };
  for (const i of scoped) counts[i.status]++;
  const filtered = query.status ? scoped.filter((i) => i.status === query.status) : scoped;
  const page = filtered.slice(offset, offset + query.limit);
  const next = offset + page.length;
  return { items: page, counts, nextCursor: next < filtered.length ? encodeCursor(next) : null };
}
