/**
 * The smart stock page's API (docs/STOCK_HUB.md §7): Today, the stock list (status, search, paging), an item's reorder
 * settings, and count losses waiting for the owner. Keys sit under the stock hub's, so any stock write that refreshes
 * the hub refreshes these too.
 */
import { apiFetch } from "../api-client";
import { stockKeys, type StockGroupKey, type StockItem } from "./stock";

const BASE = "/api/v1/finance/stock";

/** EMPTY: none left and no recent use or orders — a size not stocked any more, not an emergency. */
export type StockStatus = "NEEDS_FILL" | "OUT" | "LOW" | "OK" | "EMPTY";

export interface ItemSettings {
  preferredSupplierId: string | null;
  leadTimeDays: number;
  coverDays: number;
}

export interface StockListItem extends StockItem {
  group: StockGroupKey;
  /** The product, plus the size / colour only where the name doesn't already say it. */
  label: string;
  status: StockStatus;
  /** What can still be sold; null = no limit (an attar on Unlimited). */
  canSell: number | null;
  /** The recipe material that runs out first (fill-to-order only). */
  limitedBy: { variantId: string; name: string } | null;
  reorder: { suggested: number; orderBy: string } | null;
  settings: ItemSettings;
  /** The size's picture, else the product's first; null when it has none. */
  imageUrl: string | null;
}

export interface StockListQuery {
  status?: StockStatus;
  group?: StockGroupKey;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface StockListPage {
  items: StockListItem[];
  counts: Record<StockStatus | "ALL", number>;
  nextCursor: string | null;
}

export interface StockToday {
  today: string;
  fill: {
    bottles: number;
    orders: number;
    lines: Array<{ variantId: string; sku: string; name: string; productName: string; owed: number }>;
    short: Array<{ variantId: string; sku: string; name: string; unit: string; need: number; have: number }>;
  } | null;
  /** partial: it stopped after writing — only Try again (the same fill) closes it. */
  fillProblems: Array<{ id: string; orderNumber: string; variantId: string; name: string; units: number; reason: string; partial: boolean }>;
  reorder: {
    items: Array<{ variantId: string; sku: string; name: string; productName: string; unit: string; status: StockStatus; daysLeft: number | null; suggested: number; orderBy: string; supplier: { id: string; name: string } | null; lastUnitCost: number | null }>;
    suppliers: number;
  } | null;
  count: { due: Array<{ variantId: string; sku: string; name: string; unit: string }>; minutes: number } | null;
  approvals: Array<{ id: string; variantId: string; name: string; difference: number; reason: string; value: number | null; requestedBy: string | null; countedOn: string }>;
}

export interface StockApproval {
  id: string;
  variantId: string;
  sku: string;
  name: string;
  difference: number;
  counted: number;
  expected: number;
  reason: string;
  note: string | null;
  value: number | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  countedOn: string;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export const smartKeys = {
  today: () => [...stockKeys.all, "today"] as const,
  list: (q: Omit<StockListQuery, "cursor">) => [...stockKeys.all, "list", q] as const,
  approvals: () => [...stockKeys.all, "approvals"] as const,
  activity: (limit: number) => [...stockKeys.all, "activity", limit] as const,
};

const qs = (q: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const getStockToday = () => apiFetch<StockToday>(`${BASE}/today`);
export const listStockItems = (q: StockListQuery) => apiFetch<StockListPage>(`${BASE}/items${qs({ ...q })}`);
export const setItemSettings = (variantId: string, body: ItemSettings) => apiFetch<ItemSettings>(`${BASE}/items/${variantId}/settings`, { method: "PUT", body });
export const listStockApprovals = (status: StockApproval["status"] = "PENDING") => apiFetch<{ approvals: StockApproval[] }>(`${BASE}/approvals${qs({ status })}`);
export const decideStockApproval = (id: string, body: { decision: "APPROVE" | "REJECT"; note?: string | null }) =>
  apiFetch<{ id: string; status: StockApproval["status"]; replayed: boolean }>(`${BASE}/approvals/${id}/decision`, { method: "POST", body });
/** Try again on a booked parcel's fill that couldn't be recorded: the same fill is sent once more. */
export const retryAutoFill = (id: string) => apiFetch<{ id: string; resolved: boolean; replayed: boolean }>(`${BASE}/auto-fill-failures/${id}/retry`, { method: "POST", body: {} });

export type StockEventKind = "BOUGHT" | "FILLED" | "AUTO_FILLED" | "COUNTED" | "APPROVED" | "REJECTED" | "FILL_PROBLEM";
export interface StockEvent {
  id: string;
  kind: StockEventKind;
  at: string;
  by: string | null;
  items: Array<{ variantId: string; name: string; imageUrl: string | null; change: number | null; unit: string }>;
  /** BOUGHT: supplier · COUNTED: items counted · FILL_PROBLEM: order number. */
  context: string | null;
  value: number | null;
  pending: boolean;
  note: string | null;
}
export interface StockActivity {
  events: StockEvent[];
  today: { date: string; purchases: number; bottlesFilled: number; counts: number; decisions: number };
}
/** What happened to the stock, newest first, and what was done today. */
export const getStockActivity = (limit = 30) => apiFetch<StockActivity>(`${BASE}/activity?limit=${limit}`);
