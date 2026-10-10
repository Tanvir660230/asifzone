/**
 * Purchasing, payables and inventory reports (Financial Core Phase 4G, docs/FINANCE_PHASE_4G.md). Read-only, derived from
 * the documents and the ledger — never stored — and each total ties to the account or check it explains:
 *
 *   purchase register        receipts and bills of a period, by supplier
 *   GRNI ageing              received-not-billed by age (+ returns not yet credited) = purchasing.grni
 *   price variance           billed vs ordered unit price on received goods, and the difference booked
 *   inventory valuation      per variant: quantity, value, average, status = inventory valuation total
 *   cost adjustments (5150)  the cost-adjustment account by origin — deficit cover, price differences, production
 *                            true-ups, credit-note differences, the cutover true-up
 *   payments register        supplier payments of a period, with what they settled
 */
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { businessToday, getFinanceContext } from "./finance-context";
import { businessDateOf, toMajorNumber, toMinor } from "./finance-values";
import { resolveMappedAccount } from "./chart.service";
import { docNumber } from "./purchase-orders.service";
import { invoiceNumber } from "./supplier-invoices.service";

export interface Period { from?: string; to?: string }
const dateRange = (p: Period) => ({ ...(p.from ? { gte: new Date(`${p.from}T00:00:00Z`) } : {}), ...(p.to ? { lte: new Date(`${p.to}T00:00:00Z`) } : {}) });
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Receipts and bills of a period, per supplier: received value, billed (net of credits), and the lines. */
export async function purchaseRegister(p: Period & { supplierId?: string }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const receipts = await prisma.goodsReceipt.findMany({
    where: { businessId: business.id, status: "POSTED", receiptDate: dateRange(p), supplierId: p.supplierId },
    include: { supplier: { select: { id: true, displayName: true } }, purchaseOrder: { select: { number: true } }, lines: { select: { value: true, qtyAccepted: true } } },
    orderBy: [{ receiptDate: "asc" }, { number: "asc" }],
  });
  const bills = await prisma.supplierInvoice.findMany({
    where: { businessId: business.id, status: "POSTED", invoiceDate: dateRange(p), supplierId: p.supplierId },
    include: { supplier: { select: { id: true, displayName: true } } },
    orderBy: [{ invoiceDate: "asc" }, { number: "asc" }],
  });
  const by = new Map<string, { supplier: { id: string; displayName: string }; received: number; billed: number; credited: number }>();
  const row = (s: { id: string; displayName: string }) => by.get(s.id) ?? { supplier: s, received: 0, billed: 0, credited: 0 };
  for (const r of receipts) {
    const x = row(r.supplier);
    x.received += r.lines.reduce((s, l) => s + toMinor(l.value, cur), 0);
    by.set(r.supplier.id, x);
  }
  for (const b of bills) {
    const x = row(b.supplier);
    if (b.kind === "INVOICE") x.billed += toMinor(b.total!, cur);
    else x.credited += toMinor(b.total!, cur);
    by.set(b.supplier.id, x);
  }
  const m = (n: number) => toMajorNumber(n, cur);
  const suppliers = [...by.values()].map((x) => ({ supplier: x.supplier, received: m(x.received), billed: m(x.billed), credited: m(x.credited), netBilled: m(x.billed - x.credited) })).sort((a, b) => b.netBilled - a.netBilled);
  return {
    period: p,
    suppliers,
    totals: { received: m([...by.values()].reduce((s, x) => s + x.received, 0)), billed: m([...by.values()].reduce((s, x) => s + x.billed, 0)), credited: m([...by.values()].reduce((s, x) => s + x.credited, 0)) },
    receipts: receipts.map((r) => ({ id: r.id, number: docNumber("GRN", r.number), date: businessDateOf(r.receiptDate), supplier: r.supplier.displayName, purchaseOrder: r.purchaseOrder ? docNumber("PO", r.purchaseOrder.number) : null, units: r.lines.reduce((n, l) => n + l.qtyAccepted, 0), value: m(r.lines.reduce((s, l) => s + toMinor(l.value, cur), 0)) })),
    bills: bills.map((b) => ({ id: b.id, number: invoiceNumber(b.kind, b.number), kind: b.kind, date: businessDateOf(b.invoiceDate), supplier: b.supplier.displayName, supplierRef: b.supplierRef, net: m(toMinor(b.netTotal!, cur)), tax: m(toMinor(b.taxTotal!, cur)), total: m(toMinor(b.total!, cur)) })),
  };
}

/** Goods received and not yet billed, by age, plus goods returned and not yet credited. The total = the GRNI check. */
export async function grniAgeing() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const lines = await prisma.goodsReceiptLine.findMany({
    where: { goodsReceipt: { businessId: business.id, status: "POSTED" } },
    include: { goodsReceipt: { select: { id: true, number: true, receiptDate: true, supplier: { select: { id: true, displayName: true } } } }, variant: { select: { sku: true } }, invoiceLines: { where: { invoice: { status: "POSTED" } }, select: { quantity: true, clearedAmount: true } } },
  });
  const BUCKETS = ["d0_30", "d31_60", "d61_90", "d90_plus"] as const;
  const totals: Record<(typeof BUCKETS)[number], number> = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const open = [];
  for (const l of lines) {
    const left = toMinor(l.value, cur) - l.invoiceLines.reduce((s, x) => s + (x.clearedAmount ? toMinor(x.clearedAmount, cur) : 0), 0);
    if (left === 0) continue;
    const date = businessDateOf(l.goodsReceipt.receiptDate);
    const age = days(date, today);
    const bucket = age <= 30 ? "d0_30" : age <= 60 ? "d31_60" : age <= 90 ? "d61_90" : "d90_plus";
    totals[bucket] += left;
    open.push({ goodsReceiptId: l.goodsReceipt.id, number: docNumber("GRN", l.goodsReceipt.number), date, ageDays: age, supplier: l.goodsReceipt.supplier.displayName, sku: l.variant.sku, unbilledQty: l.qtyAccepted - l.invoiceLines.reduce((n, x) => n + x.quantity, 0), unbilled: toMajorNumber(left, cur) });
  }
  const returnLines = await prisma.purchaseReturnLine.findMany({
    where: { purchaseReturn: { businessId: business.id, status: "SHIPPED" } },
    include: { purchaseReturn: { select: { number: true, shippedAt: true, supplier: { select: { displayName: true } } } }, variant: { select: { sku: true } }, invoiceLines: { where: { invoice: { status: "POSTED" } }, select: { clearedAmount: true } } },
  });
  const returns = returnLines
    .map((l) => ({ number: docNumber("RTN", l.purchaseReturn.number), supplier: l.purchaseReturn.supplier.displayName, sku: l.variant.sku, notCredited: toMinor(l.value ?? 0, cur) - l.invoiceLines.reduce((s, x) => s + (x.clearedAmount ? toMinor(x.clearedAmount, cur) : 0), 0) }))
    .filter((r) => r.notCredited !== 0);
  const received = BUCKETS.reduce((s, b) => s + totals[b], 0);
  const credits = returns.reduce((s, r) => s + r.notCredited, 0);
  return {
    asOf: today,
    buckets: Object.fromEntries(BUCKETS.map((b) => [b, toMajorNumber(totals[b], cur)])) as Record<(typeof BUCKETS)[number], number>,
    receivedNotBilled: toMajorNumber(received, cur),
    returnedNotCredited: toMajorNumber(credits, cur),
    /** = the GRNI account (purchasing.grni) when returns share it (the default mapping). */
    grni: toMajorNumber(received - credits, cur),
    open: open.sort((a, b) => b.ageDays - a.ageDays),
    returns: returns.map((r) => ({ ...r, notCredited: toMajorNumber(r.notCredited, cur) })),
  };
}

/** Billed against ordered unit prices on received goods, and the price differences booked (stock revalued / 5150). */
export async function priceVariance(p: Period & { supplierId?: string }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const lines = await prisma.supplierInvoiceLine.findMany({
    where: { lineType: "STOCK", invoice: { businessId: business.id, status: "POSTED", invoiceDate: dateRange(p), supplierId: p.supplierId } },
    include: { invoice: { select: { kind: true, number: true, invoiceDate: true, supplier: { select: { displayName: true } } } }, variant: { select: { sku: true } }, goodsReceiptLine: { select: { unitCost: true, purchaseOrderLine: { select: { unitPrice: true } } } } },
    orderBy: { invoice: { invoiceDate: "asc" } },
  });
  const rows = lines.map((l) => {
    const billed = toMinor(l.unitPrice, cur);
    const ordered = l.goodsReceiptLine?.purchaseOrderLine ? toMinor(l.goodsReceiptLine.purchaseOrderLine.unitPrice, cur) : null;
    return {
      bill: invoiceNumber(l.invoice.kind, l.invoice.number), date: businessDateOf(l.invoice.invoiceDate), supplier: l.invoice.supplier.displayName, sku: l.variant?.sku ?? "", quantity: l.quantity,
      orderedUnitPrice: ordered === null ? null : toMajorNumber(ordered, cur), billedUnitPrice: toMajorNumber(billed, cur),
      variancePct: ordered ? Math.round(((billed - ordered) / ordered) * 10_000) / 100 : null,
      variance: ordered === null ? null : toMajorNumber((billed - ordered) * l.quantity, cur),
      booked: l.priceDifference === null ? 0 : toMajorNumber(toMinor(l.priceDifference, cur), cur),
    };
  });
  const sum = (k: "variance" | "booked") => toMajorNumber(rows.reduce((s, r) => s + toMinor(r[k] ?? 0, cur), 0), cur);
  return { period: p, rows, totals: { variance: sum("variance"), booked: sum("booked") } };
}

/** The valuation per variant (the costing engine's positions). The total = the valuation side of the inventory check. */
export async function inventoryValuation(q: { q?: string } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const rows = await prisma.inventoryCostState.findMany({
    where: { businessId: business.id, ...(q.q ? { variant: { OR: [{ sku: { contains: q.q, mode: "insensitive" } }, { product: { name: { contains: q.q, mode: "insensitive" } } }] } } : {}) },
    include: { variant: { select: { sku: true, size: true, color: true, stock: true, product: { select: { name: true, kind: true } } } } },
  });
  const items = rows
    .map((r) => ({
      variantId: r.variantId, sku: r.variant.sku, name: `${r.variant.product.name} — ${r.variant.size}${r.variant.color ? ` / ${r.variant.color}` : ""}`, kind: r.variant.product.kind,
      stock: r.variant.stock, valuedQty: r.valuedQty, unvaluedQty: r.unvaluedQty, deficitQty: r.deficitQty,
      value: toMajorNumber(toMinor(r.value, cur), cur), avgUnitCost: r.avgUnitCost === null ? null : Number(r.avgUnitCost),
      status: r.unvaluedQty > 0 || r.deficitQty > 0 ? ("INCOMPLETE" as const) : ("KNOWN" as const),
    }))
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + toMinor(r.value, cur), 0);
  return { asOf: businessToday(business), items, totals: { value: toMajorNumber(total, cur), variants: items.length, incomplete: items.filter((i) => i.status === "INCOMPLETE").length, finishedGoods: toMajorNumber(rows.filter((r) => r.variant.product.kind !== "MATERIAL").reduce((s, r) => s + toMinor(r.value, cur), 0), cur), materials: toMajorNumber(rows.filter((r) => r.variant.product.kind === "MATERIAL").reduce((s, r) => s + toMinor(r.value, cur), 0), cur) } };
}

const ORIGIN_LABEL: Record<string, string> = {
  STOCK: "Stock movements — deficit cover, rounding, stale snapshots",
  PRICE: "Supplier price differences — share already sold",
  PRODUCTION: "Production final cost and late costs — share already sold",
  CREDIT: "Credit notes vs the value returned goods left at",
  CUTOVER: "Valuation cutover true-up",
  OTHER: "Other",
};

/** The cost-adjustment account (5150 by default) for a period, by origin. The total = the account's movement. */
export async function costAdjustments(p: Period) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const account = await resolveMappedAccount(prisma as unknown as AppTransactionClient, business.id, "cogs.cost_adjustments");
  const lines = await prisma.journalLine.findMany({
    where: { accountId: account.id, entry: { businessId: business.id, status: "POSTED", entryDate: dateRange(p) } },
    select: { debit: true, credit: true, entry: { select: { sourceType: true, sourceId: true, entryDate: true, description: true } } },
  });
  // A reversal (sourceType "JournalEntry") counts under the origin of the entry it reverses.
  const reversedIds = lines.filter((l) => l.entry.sourceType === "JournalEntry" && l.entry.sourceId).map((l) => l.entry.sourceId!);
  const reversed = reversedIds.length ? await prisma.journalEntry.findMany({ where: { id: { in: reversedIds } }, select: { id: true, sourceType: true, sourceId: true } }) : [];
  const originalOf = new Map(reversed.map((e) => [e.id, e]));
  for (const l of lines) {
    const o = l.entry.sourceType === "JournalEntry" ? originalOf.get(l.entry.sourceId ?? "") : undefined;
    if (o) l.entry = { ...l.entry, sourceType: o.sourceType, sourceId: o.sourceId };
  }
  const veIds = lines.filter((l) => l.entry.sourceType === "InventoryValuationEntry" && l.entry.sourceId).map((l) => l.entry.sourceId!);
  const ves = veIds.length ? await prisma.inventoryValuationEntry.findMany({ where: { id: { in: veIds } }, select: { id: true, sourceType: true } }) : [];
  const veSource = new Map(ves.map((v) => [v.id, v.sourceType]));
  const origin = (l: (typeof lines)[number]): keyof typeof ORIGIN_LABEL => {
    const t = l.entry.sourceType;
    if (t === "InventoryValuationEntry") {
      const s = veSource.get(l.entry.sourceId ?? "");
      return s === "SupplierInvoice" ? "PRICE" : s === "ProductionSettlement" ? "PRODUCTION" : "STOCK";
    }
    if (t === "SupplierInvoice") return "CREDIT";
    if (t === "InventoryCutoverBatch") return "CUTOVER";
    return "OTHER";
  };
  const by = new Map<string, { debit: number; credit: number; entries: number }>();
  for (const l of lines) {
    const o = origin(l);
    const x = by.get(o) ?? { debit: 0, credit: 0, entries: 0 };
    x.debit += toMinor(l.debit, cur);
    x.credit += toMinor(l.credit, cur);
    x.entries += 1;
    by.set(o, x);
  }
  const m = (n: number) => toMajorNumber(n, cur);
  const rows = [...by.entries()].map(([o, x]) => ({ origin: o, label: ORIGIN_LABEL[o]!, entries: x.entries, debit: m(x.debit), credit: m(x.credit), net: m(x.debit - x.credit) })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const debit = [...by.values()].reduce((s, x) => s + x.debit, 0);
  const credit = [...by.values()].reduce((s, x) => s + x.credit, 0);
  return { period: p, account: { code: account.code, name: account.name }, rows, totals: { debit: m(debit), credit: m(credit), net: m(debit - credit) } };
}

/** Supplier payments of a period: amount, status, account, what they settled and what is left as an advance. */
export async function paymentsRegister(p: Period & { supplierId?: string }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const rows = await prisma.treasuryMovement.findMany({
    where: { businessId: business.id, kind: "SUPPLIER_PAYMENT", movementDate: dateRange(p), supplierId: p.supplierId },
    include: { supplier: { select: { displayName: true } }, fromAccount: { select: { name: true } }, supplierAllocations: { where: { status: "ACTIVE" }, select: { amount: true } } },
    orderBy: [{ movementDate: "asc" }, { createdAt: "asc" }],
  });
  const items = rows.map((r) => {
    const amount = toMinor(r.amount, cur);
    const allocated = r.supplierAllocations.reduce((s, a) => s + toMinor(a.amount, cur), 0);
    return { id: r.id, date: businessDateOf(r.movementDate), supplier: r.supplier?.displayName ?? "", from: r.fromAccount?.name ?? "", reference: r.reference, status: r.status, amount: toMajorNumber(amount, cur), allocated: toMajorNumber(allocated, cur), advance: toMajorNumber(r.status === "POSTED" ? amount - allocated : 0, cur) };
  });
  const posted = rows.filter((r) => r.status === "POSTED").reduce((s, r) => s + toMinor(r.amount, cur), 0);
  return { period: p, items, totals: { paid: toMajorNumber(posted, cur), count: items.filter((i) => i.status === "POSTED").length } };
}
