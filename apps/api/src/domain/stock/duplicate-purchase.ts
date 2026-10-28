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

/** What is stored on the receipt (GoodsReceipt.duplicateWarning). */
export interface DuplicateWarning {
  matches: DuplicateMatch[];
  checkedAt: string;
}
