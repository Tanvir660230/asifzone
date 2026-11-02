/**
 * Ordered, not yet arrived (docs/MATERIALS_PURCHASING.md §4) — composed of the purchase documents that already exist:
 *
 *   order     a purchase order (no stock, no money), approved at once when the person may approve purchases, otherwise
 *             submitted for an approver; its lines carry what was bought (purchase unit, discount) like a Bought receipt
 *   delivery  a goods receipt against the order, posted: good units into stock at the order's price, damaged ones rejected;
 *             several deliveries per order, the order's received / remaining kept by the existing triggers
 *   bill      made with the delivery (and paid from an account, or left to pay), or later from Finance › Bills when the
 *             supplier's invoice comes — until then the receipt waits in goods received not invoiced
 *   extras    transport and the like paid with a delivery: a landed cost over that receipt
 *
 * Idempotent: every document carries `stock-order:<key>` / `stock-delivery:<key>:<step>` as its evidence (unique among live
 * documents) and a request holds a transaction-scoped advisory lock on its key, so a double tap or a retry finds what the
 * first made instead of making it again; a retry after a mid-way failure carries on from the step that failed.
 */
import { goodsReceiptCreateSchema, purchaseOrderCreateSchema, stockDeliverySchema, stockOrderSchema, supplierCreateSchema, supplierInvoiceCreateSchema, type StockDeliveryInput, type StockOrderInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { actorCan, type FinanceActor } from "../finance/finance-audit";
import { businessToday, getFinanceContext } from "../finance/finance-context";
import { businessDateOf, financeError, toMajorNumber, toMinor } from "../finance/finance-values";
import { createSupplier } from "../finance/suppliers.service";
import { approvePurchaseOrder, createPurchaseOrder, docNumber, setPurchaseOrderLineBought, submitPurchaseOrder } from "../finance/purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt } from "../finance/goods-receipts.service";
import { createSupplierInvoice, postSupplierInvoice } from "../finance/supplier-invoices.service";
import { paySupplier } from "../finance/supplier-payments.service";
import { createLandedCost } from "../finance/landed-costs.service";
import { assertBooksOpen, assertMoneyFor, checkedLines, costingLive, exactLines, resolvePaidFrom, spreadByWeight, supplierByName } from "./purchase.service";
import { unitOf, variantLabel } from "./hub-entry";

const ORDERING = new Set(["SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED"]);
const RECEIVABLE = new Set(["APPROVED", "PARTIALLY_RECEIVED"]);
const DEFAULT_SUPPLIER = "Local market";
const orderTag = (key: string) => `stock-order:${key}`;
const deliveryTag = (key: string, step: string) => `stock-delivery:${key}:${step}`;

/** Runs \`fn\` while holding a transaction-scoped advisory lock on \`name\`: a second request with the same key waits, then finds
 * what the first made. The documents themselves are written in their own transactions. */
async function underKey<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${name}))`;
    return fn();
  }, { timeout: 120_000, maxWait: 30_000 });
}

function needKey(key: string | null): string {
  if (!key) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header");
  return key;
}

/** Records an order (see the file header). Returns it as the Expected list shows it; \`replayed\` when the key made it already. */
export async function orderStockPurchase(raw: StockOrderInput, actor: FinanceActor, rawKey: string | null) {
  const key = needKey(rawKey);
  const input = stockOrderSchema.parse(raw);
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (!(await costingLive(business.id))) throw financeError(409, "COSTING_NOT_ACTIVE", "Orders are recorded once stock costing has started — record what arrived on Received goods");
  const date = input.date ?? businessToday(business);
  const { lines } = await checkedLines(input, cur);
  await assertBooksOpen(business, date, actor);
  return underKey(orderTag(key), async () => {
    const found = await prisma.purchaseOrder.findFirst({ where: { businessId: business.id, deliveryTerms: orderTag(key), status: { not: "CANCELLED" } }, select: { id: true } });
    if (found) return { replayed: true, order: await expectedOrder(found.id) };
    const supplierName = input.supplierName ?? DEFAULT_SUPPLIER;
    const supplierId = (await supplierByName(business.id, supplierName))
      ?? (await createSupplier(supplierCreateSchema.parse({ legalName: supplierName, displayName: supplierName, notes: "Created from the stock hub (Ordered)" }), actor)).id;
    const rows = lines.flatMap((l) => exactLines(l.quantity, toMinor(l.amount, cur)).map((x) => ({ l, x })));
    const po = await createPurchaseOrder(purchaseOrderCreateSchema.parse({
      supplierId, orderDate: date, expectedDate: input.expectedDate ?? null,
      // the key rides in delivery terms (never shown as terms on a stock-hub order) so a retry finds the order
      deliveryTerms: orderTag(key),
      notes: [input.reference ? `Supplier's ref. ${input.reference}` : null, input.note, "Ordered on Stock"].filter(Boolean).join(" · "),
      lines: rows.map(({ l, x }) => ({ lineType: "STOCK", variantId: l.variantId, qtyOrdered: x.qty, unitPrice: toMajorNumber(x.unitMinor, cur) })),
    }), actor);
    // what was bought, per order line (informational, like a Bought receipt): its share in the purchase unit and the discount
    const discounts = new Map(lines.map((l) => [l.variantId, spreadByWeight(l.discount ? toMinor(l.discount, cur) : 0, exactLines(l.quantity, toMinor(l.amount, cur)).map((r) => r.qty))]));
    const seen = new Map<string, number>();
    for (const [i, pol] of po.lines.entries()) {
      const l = rows[i]!.l;
      const k = seen.get(l.variantId) ?? 0;
      seen.set(l.variantId, k + 1);
      if (!l.buy && l.discount == null) continue;
      await setPurchaseOrderLineBought(pol.id, {
          ...(l.buy ? { purchaseUnitId: l.buy.unitId, purchaseUnitLabel: l.buy.label, purchaseUnitFactor: l.buy.factor, purchaseQty: Math.round((pol.qtyOrdered / l.buy.factor) * 10_000) / 10_000 } : {}),
          ...(l.discount != null ? { grossUnitPrice: (toMinor(l.amount, cur) + toMinor(l.discount, cur)) / l.quantity / toMinor(1, cur), discountAmount: toMajorNumber(discounts.get(l.variantId)![k]!, cur) } : {}),
      });
    }
    await submitPurchaseOrder(po.id, actor);
    if (actorCan(actor, "purchasing.approve")) await approvePurchaseOrder(po.id, actor);
    return { replayed: false, order: await expectedOrder(po.id) };
  });
}

export interface ExpectedOrder {
  id: string;
  number: string;
  status: string;
  supplier: { id: string; name: string };
  orderDate: string;
  expectedDate: string | null;
  note: string | null;
  total: number;
  /** Per item (the order's lines for one item together): ordered, received and still to come, in stock units. */
  lines: Array<{ variantId: string; name: string; unit: string; ordered: number; received: number; rejected: number; remaining: number; boughtAs: { label: string; factor: number } | null }>;
  remaining: number;
}

const ORDER_SELECT = {
  id: true, number: true, status: true, orderDate: true, expectedDate: true, notes: true, deliveryTerms: true,
  supplier: { select: { id: true, displayName: true } },
  lines: {
    where: { lineType: "STOCK" as const },
    orderBy: { lineNo: "asc" as const },
    select: {
      variantId: true, qtyOrdered: true, qtyReceived: true, unitPrice: true, purchaseUnitLabel: true, purchaseUnitFactor: true,
      receiptLines: { where: { goodsReceipt: { status: "POSTED" as const } }, select: { qtyRejected: true } },
      variant: { select: { id: true, size: true, color: true, product: { select: { name: true, stockUnit: true, kind: true } } } },
    },
  },
};

type OrderRow = Awaited<ReturnType<typeof loadOrders>>[number];
const loadOrders = (where: object) => prisma.purchaseOrder.findMany({ where, select: ORDER_SELECT, orderBy: [{ orderDate: "asc" }, { number: "asc" }], take: 200 });

function orderDto(o: OrderRow, cur: string): ExpectedOrder {
  const items = new Map<string, ExpectedOrder["lines"][number]>();
  let totalMinor = 0;
  for (const l of o.lines) {
    totalMinor += toMinor(l.unitPrice, cur) * l.qtyOrdered;
    const v = l.variant!;
    const it = items.get(v.id) ?? { variantId: v.id, name: variantLabel(v), unit: unitOf(v.product), ordered: 0, received: 0, rejected: 0, remaining: 0, boughtAs: l.purchaseUnitLabel ? { label: l.purchaseUnitLabel, factor: Number(l.purchaseUnitFactor) } : null };
    it.ordered += l.qtyOrdered;
    it.received += l.qtyReceived;
    it.rejected += l.receiptLines.reduce((s, r) => s + r.qtyRejected, 0);
    it.remaining = Math.max(0, it.ordered - it.received);
    items.set(v.id, it);
  }
  const lines = [...items.values()];
  return {
    id: o.id, number: docNumber("PO", o.number), status: o.status, supplier: { id: o.supplier.id, name: o.supplier.displayName },
    orderDate: businessDateOf(o.orderDate), expectedDate: o.expectedDate ? businessDateOf(o.expectedDate) : null, note: o.notes,
    total: toMajorNumber(totalMinor, cur), lines, remaining: lines.reduce((s, l) => s + l.remaining, 0),
  };
}

async function expectedOrder(id: string): Promise<ExpectedOrder> {
  const { business } = await getFinanceContext();
  const [o] = await loadOrders({ id, businessId: business.id });
  if (!o) throw financeError(404, "PO_NOT_FOUND", "Purchase order not found");
  return orderDto(o, business.baseCurrency);
}

/** Orders still to arrive (submitted, approved or part received), oldest first — the Expected tab. */
export async function listExpected(): Promise<{ orders: ExpectedOrder[] }> {
  const { business } = await getFinanceContext();
  const rows = await loadOrders({ businessId: business.id, status: { in: [...ORDERING] } });
  return { orders: rows.map((o) => orderDto(o, business.baseCurrency)).filter((o) => o.lines.length > 0) };
}

/**
 * Receives one delivery of an order (see the file header). Good units are spread over the item's order lines by what each
 * still waits for (the last takes any extra — receiving beyond the order's tolerance needs an approver, as on Finance ›
 * Purchase orders); damaged units are rejected on the first.
 */
export async function receiveDelivery(orderId: string, raw: StockDeliveryInput, actor: FinanceActor, rawKey: string | null) {
  const key = needKey(rawKey);
  const input = stockDeliverySchema.parse(raw);
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const date = input.date ?? businessToday(business);
  if (date > businessToday(business)) throw financeError(400, "PURCHASE_IN_FUTURE", "A delivery records goods already received");
  await assertBooksOpen(business, date, actor);
  const extrasMinor = input.extras.reduce((s, e) => s + toMinor(e.amount, cur), 0);
  const paidFrom = input.paidFromAccountId ? await resolvePaidFrom(business.id, { financialAccountId: input.paidFromAccountId }) : null;
  if (paidFrom && paidFrom.kind !== "ACCOUNT") throw financeError(400, "PAYMENT_SOURCE_KIND", "Pay a delivery from a cash box, bank or wallet");

  return underKey(deliveryTag(key, "lock"), async () => {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: orderId, businessId: business.id },
      select: { id: true, number: true, status: true, supplierId: true, lines: { where: { lineType: "STOCK" }, orderBy: { lineNo: "asc" }, select: { id: true, variantId: true, qtyOrdered: true, qtyReceived: true } } },
    });
    if (!po) throw financeError(404, "PO_NOT_FOUND", "Purchase order not found");
    let receipt = await prisma.goodsReceipt.findFirst({ where: { businessId: business.id, evidence: deliveryTag(key, "receipt"), status: { not: "REVERSED" } }, select: { id: true } });
    const replayed = Boolean(receipt);
    if (!receipt) {
      if (!RECEIVABLE.has(po.status)) throw financeError(409, "PO_NOT_RECEIVABLE", po.status === "SUBMITTED" ? "This order waits for approval — an approver approves it on Finance › Purchase orders" : `This order is ${po.status.toLowerCase().replace("_", " ")} — nothing more is received on it`);
      const rows: Array<{ purchaseOrderLineId: string; qtyAccepted: number; qtyRejected: number }> = [];
      for (const [i, d] of input.lines.entries()) {
        const mine = po.lines.filter((l) => l.variantId === d.variantId);
        if (!mine.length) throw financeError(400, "RECEIPT_LINE_NOT_ON_ORDER", `Line ${i + 1}: that item isn't on ${docNumber("PO", po.number)}`);
        if (!d.good && !d.damaged) continue;
        let left = d.good;
        for (const [k, l] of mine.entries()) {
          const take = k === mine.length - 1 ? left : Math.min(left, Math.max(0, l.qtyOrdered - l.qtyReceived));
          left -= take;
          const rejected = k === 0 ? d.damaged : 0;
          if (take || rejected) rows.push({ purchaseOrderLineId: l.id, qtyAccepted: take, qtyRejected: rejected });
        }
      }
      if (input.extras.length && paidFrom) await assertMoneyFor(business, paidFrom, extrasMinor);
      const created = await createGoodsReceipt(goodsReceiptCreateSchema.parse({ purchaseOrderId: po.id, receiptDate: date, supplierRef: input.supplierRef, evidence: deliveryTag(key, "receipt"), lines: rows }), actor);
      receipt = { id: created.id };
    }
    const posted = await postGoodsReceipt(receipt.id, {}, actor);
    const goodsMinor = posted.receipt.lines.reduce((s, l) => s + toMinor(l.value, cur), 0);

    let invoiceId: string | null = null;
    let paymentId: string | null = null;
    if (input.bill === "NOW" && goodsMinor > 0) {
      invoiceId = (await prisma.supplierInvoice.findFirst({ where: { businessId: business.id, evidence: deliveryTag(key, "invoice"), status: { not: "VOID" } }, select: { id: true } }))?.id ?? null;
      if (!invoiceId) {
        invoiceId = (await createSupplierInvoice(supplierInvoiceCreateSchema.parse({
          kind: "INVOICE", supplierId: po.supplierId, supplierRef: input.supplierRef ?? posted.receipt.number, invoiceDate: date, dueDate: date, evidence: deliveryTag(key, "invoice"),
          lines: posted.receipt.lines.filter((l) => l.qtyAccepted > 0).map((l) => ({ lineType: "STOCK", goodsReceiptLineId: l.id, quantity: l.qtyAccepted, unitPrice: l.unitCost })),
        }), actor)).id;
      }
      const bill = await postSupplierInvoice(invoiceId, {}, actor);
      if (paidFrom?.financialAccountId) {
        const { payment } = await paySupplier({
          supplierId: po.supplierId, fromFinancialAccountId: paidFrom.financialAccountId, movementDate: date, amount: bill.invoice.total!, reference: bill.invoice.number ?? null,
          allocations: [{ invoiceId, amount: bill.invoice.total! }],
        }, actor, deliveryTag(key, "payment"));
        paymentId = payment.id;
      }
    }
    let landedCostId: string | null = null;
    if (input.extras.length && paidFrom?.financialAccountId) {
      landedCostId = (await createLandedCost({
        costDate: date, description: input.extras.map((e) => e.description).join(", ").slice(0, 300), payee: null, amount: toMajorNumber(extrasMinor, cur), method: input.extrasMethod,
        goodsReceiptIds: [receipt.id], fromFinancialAccountId: paidFrom.financialAccountId, reference: posted.receipt.number ?? null,
      }, actor, deliveryTag(key, "extras"))).landedCost.id;
    }
    return { replayed, receiptId: receipt.id, receiptNumber: posted.receipt.number, invoiceId, paymentId, landedCostId, order: await expectedOrder(po.id) };
  });
}
