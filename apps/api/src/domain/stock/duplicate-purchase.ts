/**
 * Duplicate-purchase warning (blueprint P0.3; owner decision Q7 = A/A, 27 Oct 2026). A goods receipt — from the stock hub's
 * quick "Bought" form or the formal purchasing flow — is flagged as a possible duplicate of another live receipt when ALL
 * FOUR hold:
 *
 *   1. same supplier;
 *   2. receipt dates at most 3 days apart;
 *   3. at least 70% of the items in common (distinct variants shared ÷ the larger receipt's distinct variants);
 *   4. goods totals within 1% of each other.
 *
 * A warning only: nothing is ever refused, merged or deleted because of it. The match and the reason the person gave for
 * going ahead are stored on the new receipt. Reversed receipts are not compared (an undone purchase may be re-entered).
 */
import type { AppTransactionClient } from "../../config/prisma";
import { prisma } from "../../config/prisma";
import { docNumber } from "../finance/purchase-orders.service";
import { toMajorNumber, toMinor } from "../finance/finance-values";

export const DUPLICATE_PURCHASE_RULE = { maxDaysApart: 3, minItemOverlap: 0.7, maxTotalDifference: 0.01 } as const;

export interface PurchaseShape {
  /** Business date, YYYY-MM-DD. */
  date: string;
  variantIds: string[];
  totalMinor: number;
}

export interface DuplicateMatch {
  /** RECEIPT (default): another purchase; STOCK_ADDED: the same items came into stock lately without any purchase. */
  kind?: "RECEIPT" | "STOCK_ADDED";
  receiptId: string;
  number: string;
  receiptDate: string;
  total: number;
  /** Share of items in common, 0–1. */
  itemOverlap: number;
  /** Relative difference of the goods totals, 0–1. */
  totalDifference: number;
}

const DAY_MS = 86_400_000;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;

/** The four-condition rule for two purchases already known to share a supplier. Pure. Null when they don't match. */
export function compareAsDuplicate(a: PurchaseShape, b: PurchaseShape): Pick<DuplicateMatch, "itemOverlap" | "totalDifference"> | null {
  if (daysApart(a.date, b.date) > DUPLICATE_PURCHASE_RULE.maxDaysApart) return null;
  const setA = new Set(a.variantIds);
  const setB = new Set(b.variantIds);
  const larger = Math.max(setA.size, setB.size);
  if (!larger) return null;
  const shared = [...setA].filter((v) => setB.has(v)).length;
  const itemOverlap = shared / larger;
  if (itemOverlap < DUPLICATE_PURCHASE_RULE.minItemOverlap) return null;
  const biggerTotal = Math.max(Math.abs(a.totalMinor), Math.abs(b.totalMinor));
  const totalDifference = biggerTotal === 0 ? 0 : Math.abs(a.totalMinor - b.totalMinor) / biggerTotal;
  if (totalDifference > DUPLICATE_PURCHASE_RULE.maxTotalDifference) return null;
  return { itemOverlap: Math.round(itemOverlap * 1000) / 1000, totalDifference: Math.round(totalDifference * 10_000) / 10_000 };
}

/** Live (draft or posted) receipts of `supplierId` that match `shape` under the rule, newest first. */
export async function findDuplicateReceipts(
  db: AppTransactionClient | typeof prisma,
  args: { businessId: string; supplierId: string; shape: PurchaseShape; currency: string; excludeReceiptId?: string; purchaseOrderId?: string | null },
): Promise<DuplicateMatch[]> {
  const day = Date.parse(`${args.shape.date}T00:00:00Z`);
  const window = DUPLICATE_PURCHASE_RULE.maxDaysApart * DAY_MS;
  const rows = await db.goodsReceipt.findMany({
    where: {
      businessId: args.businessId,
      supplierId: args.supplierId,
      status: { in: ["DRAFT", "POSTED"] },
      receiptDate: { gte: new Date(day - window), lte: new Date(day + window) },
      ...(args.excludeReceiptId ? { id: { not: args.excludeReceiptId } } : {}),
      // deliveries against the same purchase order are its parts (a partial receipt and the rest), never a duplicate
      ...(args.purchaseOrderId ? { OR: [{ purchaseOrderId: null }, { purchaseOrderId: { not: args.purchaseOrderId } }] } : {}),
    },
    select: { id: true, number: true, receiptDate: true, lines: { select: { variantId: true, value: true } } },
    orderBy: { receiptDate: "desc" },
  });
  const out: DuplicateMatch[] = [];
  for (const r of rows) {
    const date = r.receiptDate.toISOString().slice(0, 10);
    const totalMinor = r.lines.reduce((s, l) => s + toMinor(l.value, args.currency), 0);
    const hit = compareAsDuplicate(args.shape, { date, variantIds: r.lines.map((l) => l.variantId), totalMinor });
    if (hit) out.push({ receiptId: r.id, number: docNumber("GRN", r.number), receiptDate: date, total: toMajorNumber(totalMinor, args.currency), ...hit });
  }
  return out;
}

/** Purchases recorded before costing was live (blueprint P1.4 simple mode): no receipt exists, so they are kept on their
 * stock hub entry and matched by the supplier's name (case-insensitive) under the same four-condition rule. */
export async function findDuplicateSimplePurchases(
  db: AppTransactionClient | typeof prisma,
  args: { businessId: string; supplierName: string; shape: PurchaseShape; currency: string; excludeEntryId?: string },
): Promise<DuplicateMatch[]> {
  const day = Date.parse(`${args.shape.date}T00:00:00Z`);
  const window = DUPLICATE_PURCHASE_RULE.maxDaysApart * DAY_MS;
  const rows = await db.stockHubEntry.findMany({
    where: {
      businessId: args.businessId,
      kind: "PURCHASE",
      completedAt: { not: null },
      entryDate: { gte: new Date(day - window), lte: new Date(day + window) },
      ...(args.excludeEntryId ? { id: { not: args.excludeEntryId } } : {}),
    },
    select: { id: true, entryDate: true, steps: true },
    orderBy: { entryDate: "desc" },
  });
  const name = args.supplierName.trim().toLowerCase();
  const out: DuplicateMatch[] = [];
  for (const r of rows) {
    const s = r.steps as { mode?: string; request?: { supplierName?: string; lines?: Array<{ variantId: string; amount: number }> } };
    if (s.mode !== "SIMPLE" || s.request?.supplierName?.trim().toLowerCase() !== name) continue;
    const lines = s.request.lines ?? [];
    const date = r.entryDate.toISOString().slice(0, 10);
    const totalMinor = lines.reduce((sum, l) => sum + toMinor(l.amount, args.currency), 0);
    const hit = compareAsDuplicate(args.shape, { date, variantIds: lines.map((l) => l.variantId), totalMinor });
    if (hit) out.push({ receiptId: r.id, number: "Purchase (not in the books)", receiptDate: date, total: toMajorNumber(totalMinor, args.currency), ...hit });
  }
  return out;
}

/**
 * Stock added without a purchase (docs/MATERIALS_PURCHASING.md §3): both live duplicates of October 2026 (GRN-000001 caps,
 * GRN-000002 oil) were goods already in the books — added at product creation, an import or a count — then entered again as
 * a purchase, which the receipt-to-receipt rule above can't see. So: when at least 70% of the items bought came into stock in
 * the 30 days before the purchase other than through a purchase (restock, import, count gain — never a receipt or a stock hub
 * purchase), and — where quantities are known — by at least half of what is being bought, it is flagged. A warning only.
 */
export const STOCK_ADDED_RULE = { days: 30, minItemOverlap: 0.7, minQtyShare: 0.5 } as const;

export interface StockInflow { variantId: string; qty: number; lastDate: string }

/** Pure: does a purchase of these lines look like stock already added? Null when it doesn't. */
export function matchStockAdded(lines: Array<{ variantId: string; quantity?: number | null }>, inflows: StockInflow[]): Pick<DuplicateMatch, "itemOverlap" | "receiptDate"> & { units: number } | null {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  if (!ids.length) return null;
  const by = new Map(inflows.map((i) => [i.variantId, i]));
  const hits = ids.filter((id) => {
    const inflow = by.get(id);
    if (!inflow || inflow.qty <= 0) return false;
    const bought = lines.filter((l) => l.variantId === id).reduce((s, l) => s + (l.quantity ?? 0), 0);
    return !bought || inflow.qty >= bought * STOCK_ADDED_RULE.minQtyShare;
  });
  const itemOverlap = hits.length / ids.length;
  if (itemOverlap < STOCK_ADDED_RULE.minItemOverlap) return null;
  const last = hits.map((id) => by.get(id)!.lastDate).sort().at(-1)!;
  return { itemOverlap: Math.round(itemOverlap * 1000) / 1000, receiptDate: last, units: hits.reduce((s, id) => s + by.get(id)!.qty, 0) };
}

/** Stock that came in without a purchase in the window before `date`, per item (reason RESTOCK / IMPORT / ADJUSTMENT gains). */
export async function stockAddedWithoutPurchase(db: AppTransactionClient | typeof prisma, variantIds: string[], date: string): Promise<StockInflow[]> {
  if (!variantIds.length) return [];
  const end = Date.parse(`${date}T00:00:00Z`) + 2 * DAY_MS;
  const rows = await db.stockMovement.findMany({
    where: {
      variantId: { in: variantIds },
      change: { gt: 0 },
      reason: { in: ["RESTOCK", "IMPORT", "ADJUSTMENT"] },
      createdAt: { gte: new Date(end - (STOCK_ADDED_RULE.days + 2) * DAY_MS), lt: new Date(end) },
      // a stock hub purchase before costing was live is a RESTOCK sourced on its entry: a purchase, matched above
      NOT: { reason: "RESTOCK", sourceType: "StockHubEntry" },
    },
    select: { variantId: true, change: true, createdAt: true },
  });
  const out = new Map<string, StockInflow>();
  for (const r of rows) {
    const d = r.createdAt.toISOString().slice(0, 10);
    const cur = out.get(r.variantId) ?? { variantId: r.variantId, qty: 0, lastDate: d };
    cur.qty += r.change;
    if (d > cur.lastDate) cur.lastDate = d;
    out.set(r.variantId, cur);
  }
  return [...out.values()];
}

/** What is stored on the receipt (GoodsReceipt.duplicateWarning). */
export interface DuplicateWarning {
  matches: DuplicateMatch[];
  checkedAt: string;
}
