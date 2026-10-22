/**
 * Stock hub — Bought (docs/STOCK_HUB.md §2): one form for a purchase, composed of the documents purchasing and payables
 * already have, never re-implemented here:
 *
 *   1. supplier       found by name, or created ("Local market" when none is given)            suppliers.service
 *   2. receipt        a direct goods receipt (no purchase order; reason "Bought — stock hub"),
 *                     posted: stock and value in at the line totals paid                        goods-receipts.service
 *   3. bill           a supplier invoice matched line by line to that receipt, posted: it
 *                     clears GRNI at exactly the receipt's value (no price difference)          supplier-invoices.service
 *   4. funding        paid from the owner's own money only: his money comes into his own-money
 *                     cash account as capital first (the quick-add pattern)                     partner-profit.service ownerMoney
 *   5. payment        the bill paid from that account                                           supplier-payments.service
 *   6. extras         transport, customs… one landed cost spread over the receipt by value,
 *                     paid from the same account                                                landed-costs.service
 *
 * A line total that isn't a whole number of the smallest currency unit per item (৳1,000 for 3) is received as two lines
 * (2 × 333.33 + 1 × 333.34), so stock, bill and payment are exactly what was paid.
 *
 * Each step is idempotent by `stock-purchase:<key>:<step>` (treasury keys; receipt and bill carry it as their evidence),
 * and the entry (hub-entry.ts) records what each step made: a retry after a mid-way failure resumes, a replay writes
 * nothing. Stock documents need costing (decision D-P1): before go-live the purchase is refused with the reason.
 */
import { goodsReceiptCreateSchema, stockPurchaseSchema, supplierCreateSchema, supplierInvoiceCreateSchema, type StockPurchaseInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { actorCan, type FinanceActor } from "../finance/finance-audit";
import { businessToday, getFinanceContext } from "../finance/finance-context";
import { businessDateOf, financeError, toMajorNumber, toMinor } from "../finance/finance-values";
import { createSupplier } from "../finance/suppliers.service";
import { createGoodsReceipt, postGoodsReceipt } from "../finance/goods-receipts.service";
import { createSupplierInvoice, postSupplierInvoice } from "../finance/supplier-invoices.service";
import { paySupplier } from "../finance/supplier-payments.service";
import { createLandedCost } from "../finance/landed-costs.service";
import { ownerMoney } from "../finance/partner-profit.service";
import { claimEntry, completeEntry, fingerprintOf, releaseEntry, saveSteps, unitOf, variantLabel } from "./hub-entry";

export type { StockPurchaseInput };

export const PURCHASE_REASON = "Bought — stock hub";
const DEFAULT_SUPPLIER = "Local market";
const PAYING_KINDS = new Set(["CASH", "BANK", "MOBILE_WALLET"]);
/** What the composition posts: the receipt (receiving and, without an order, its approval), the bill and the payments. */
const NEEDS = ["purchasing.receive", "purchasing.approve", "ap.manage", "finance.transact"] as const;

interface PurchaseSteps {
  request: {
    supplierName: string;
    reference: string | null;
    note: string | null;
    lines: Array<{ variantId: string; name: string; unit: string; quantity: number; amount: number }>;
    extras: Array<{ description: string; amount: number }>;
    paidFrom: { kind: "ACCOUNT" | "OWNER"; financialAccountId: string; name: string };
  };
  goods: number;
  extras: number;
  total: number;
  supplierId?: string;
  receiptId?: string;
  receiptNumber?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  fundingMovementId?: string;
  paymentMovementId?: string;
  paymentStatus?: string;
  landedCostId?: string | null;
}

const tag = (key: string, step: string) => `stock-purchase:${key}:${step}`;

/** Splits a line total into receipt lines whose unit costs are whole minor units and add up to exactly the total. */
export function exactLines(quantity: number, amountMinor: number): Array<{ qty: number; unitMinor: number }> {
  const base = Math.floor(amountMinor / quantity);
  const rest = amountMinor - base * quantity;
  if (!rest) return [{ qty: quantity, unitMinor: base }];
  return [{ qty: quantity - rest, unitMinor: base }, { qty: rest, unitMinor: base + 1 }];
}

/** The owner's own money: his "<name> — own money" cash account (owner's history), else the first cash box — the
 * account the quick add's "Owner's own money" passes through. */
async function ownerPocket(businessId: string) {
  const owner = await prisma.partner.findFirst({ where: { businessId, role: "OWNER" }, select: { name: true } });
  const cash = await prisma.financialAccount.findMany({ where: { businessId, kind: "CASH", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  return (owner && cash.find((a) => a.name === `${owner.name} — own money`)) || cash[0] || null;
}

async function findOrCreateSupplier(businessId: string, name: string, actor: FinanceActor) {
  const found = await prisma.supplier.findMany({ where: { businessId, displayName: { equals: name, mode: "insensitive" }, status: { not: "INACTIVE" } }, orderBy: { createdAt: "asc" }, select: { id: true, status: true } });
  const usable = found.find((s) => s.status === "ACTIVE") ?? found[0];
  if (usable) return usable.id;
  return (await createSupplier(supplierCreateSchema.parse({ legalName: name, displayName: name, notes: "Created from the stock hub (Bought)" }), actor)).id;
}

/** Records a purchase (see the file header). Returns the documents it made; `replayed` when the key had already finished. */
export async function recordPurchase(raw: StockPurchaseInput, actor: FinanceActor, key: string | null) {
  if (!key) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every purchase");
  const missing = NEEDS.filter((p) => !actorCan(actor, p));
  if (missing.length) throw financeError(403, "STOCK_PURCHASE_PERMISSION", `Recording a purchase posts its receipt, bill and payment — that needs ${missing.join(", ")}`);
  const input = stockPurchaseSchema.parse(raw);
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;

  const biz = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { inventoryCostingActivatedAt: true } });
  if (!biz.inventoryCostingActivatedAt) throw financeError(409, "COSTING_NOT_ACTIVE", "Stock costing starts at go-live — purchases are recorded here once the stock has been valued");
  const today = businessToday(business);
  if (input.date && input.date > today) throw financeError(400, "PURCHASE_IN_FUTURE", "A purchase records goods already received");

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: input.lines.map((l) => l.variantId) } },
    select: { id: true, size: true, color: true, product: { select: { name: true, kind: true, stockUnit: true, trackInventory: true, deletedAt: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  for (const [i, l] of input.lines.entries()) {
    const v = byId.get(l.variantId);
    if (!v || v.product.deletedAt) throw financeError(400, "VARIANT_NOT_FOUND", `Line ${i + 1}: item not found`);
    if (!v.product.trackInventory) throw financeError(400, "PURCHASE_UNTRACKED", `Line ${i + 1}: ${variantLabel(v)} isn't stock-tracked`);
    if (toMinor(l.amount, cur) < l.quantity) throw financeError(400, "PURCHASE_LINE_AMOUNT", `Line ${i + 1}: the total is less than the smallest coin per unit`);
  }

  let paidFrom: PurchaseSteps["request"]["paidFrom"];
  if ("ownerPocket" in input.paidFrom) {
    const pocket = await ownerPocket(business.id);
    if (!pocket) throw financeError(409, "OWNER_POCKET_MISSING", "The owner's own money passes through a cash box — add one in Money accounts first");
    paidFrom = { kind: "OWNER", financialAccountId: pocket.id, name: pocket.name };
  } else {
    const fa = await prisma.financialAccount.findFirst({ where: { id: input.paidFrom.financialAccountId, businessId: business.id }, select: { id: true, name: true, kind: true, isActive: true } });
    if (!fa) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "That money account doesn't exist");
    if (!fa.isActive || !PAYING_KINDS.has(fa.kind)) throw financeError(400, "PAYMENT_SOURCE_KIND", `${fa.name} can't pay — pay from cash, a bank or a wallet`);
    paidFrom = { kind: "ACCOUNT", financialAccountId: fa.id, name: fa.name };
  }

  const goodsMinor = input.lines.reduce((s, l) => s + toMinor(l.amount, cur), 0);
  const extrasMinor = input.extras.reduce((s, e) => s + toMinor(e.amount, cur), 0);
  const initial: PurchaseSteps = {
    request: {
      supplierName: input.supplierName ?? DEFAULT_SUPPLIER, reference: input.reference, note: input.note,
      lines: input.lines.map((l) => {
        const v = byId.get(l.variantId)!;
        return { variantId: l.variantId, name: variantLabel(v), unit: unitOf(v.product), quantity: l.quantity, amount: l.amount };
      }),
      extras: input.extras, paidFrom,
    },
    goods: toMajorNumber(goodsMinor, cur), extras: toMajorNumber(extrasMinor, cur), total: toMajorNumber(goodsMinor + extrasMinor, cur),
  };
  const { entry, done } = await claimEntry({ businessId: business.id, kind: "PURCHASE", key, fingerprint: fingerprintOf(input), entryDate: input.date ?? today, steps: initial as never, actor });
  if (done) return outcome(entry.id, entry.steps as unknown as PurchaseSteps, true, entry);

  const steps = entry.steps as unknown as PurchaseSteps;
  const date = businessDateOf(entry.entryDate);
  const req = steps.request;
  const save = () => saveSteps(entry.id, steps as never);
  try {
    // 1. supplier
    if (!steps.supplierId) {
      steps.supplierId = await findOrCreateSupplier(business.id, req.supplierName, actor);
      await save();
    }

    // 2. the goods receipt, posted
    if (!steps.receiptId) {
      const stamped = await prisma.goodsReceipt.findFirst({ where: { businessId: business.id, evidence: tag(key, "receipt"), status: { not: "REVERSED" } }, select: { id: true } });
      steps.receiptId = stamped?.id ?? (await createGoodsReceipt(goodsReceiptCreateSchema.parse({
        supplierId: steps.supplierId, receiptDate: date, supplierRef: req.reference, notes: req.note, evidence: tag(key, "receipt"), directReason: PURCHASE_REASON,
        lines: req.lines.flatMap((l) => exactLines(l.quantity, toMinor(l.amount, cur)).map((x) => ({ variantId: l.variantId, qtyAccepted: x.qty, unitCost: toMajorNumber(x.unitMinor, cur) }))),
      }), actor)).id;
      await save();
    }
    const posted = await postGoodsReceipt(steps.receiptId, {}, actor);
    if (steps.receiptNumber !== posted.receipt.number) {
      steps.receiptNumber = posted.receipt.number;
      await save();
    }

    // 3. the bill, matched line by line to the receipt, posted
    if (!steps.invoiceId) {
      const stamped = await prisma.supplierInvoice.findFirst({ where: { businessId: business.id, evidence: tag(key, "invoice"), status: { not: "VOID" } }, select: { id: true } });
      steps.invoiceId = stamped?.id ?? (await createSupplierInvoice(supplierInvoiceCreateSchema.parse({
        kind: "INVOICE", supplierId: steps.supplierId, supplierRef: steps.receiptNumber, invoiceDate: date, dueDate: date,
        notes: [req.reference ? `Supplier's ref. ${req.reference}` : null, req.note].filter(Boolean).join(" · ") || null, evidence: tag(key, "invoice"),
        lines: posted.receipt.lines.map((l) => ({ lineType: "STOCK", goodsReceiptLineId: l.id, quantity: l.qtyAccepted, unitPrice: l.unitCost })),
      }), actor)).id;
      await save();
    }
    const bill = await postSupplierInvoice(steps.invoiceId, {}, actor);
    if (steps.invoiceNumber !== bill.invoice.number) {
      steps.invoiceNumber = bill.invoice.number;
      await save();
    }

    // 4. the owner's own money comes in as capital first
    if (req.paidFrom.kind === "OWNER" && !steps.fundingMovementId) {
      const what = req.lines.map((l) => `${l.quantity} ${l.unit} ${l.name}`).join(", ");
      const { movement } = await ownerMoney({ kind: "INVEST", financialAccountId: req.paidFrom.financialAccountId, amount: steps.total, date, note: `Bought ${steps.receiptNumber}: ${what}`.slice(0, 200) }, actor, tag(key, "funding"));
      if (movement.status !== "POSTED") throw financeError(409, "FUNDING_NEEDS_APPROVAL", "The owner's money must post before the purchase can be paid from it — approve it, then save again");
      steps.fundingMovementId = movement.id;
      await save();
    }

    // 5. the bill paid
    if (!steps.paymentMovementId) {
      const { payment } = await paySupplier({
        supplierId: steps.supplierId, fromFinancialAccountId: req.paidFrom.financialAccountId, movementDate: date, amount: steps.goods, reference: steps.invoiceNumber ?? null,
        allocations: [{ invoiceId: steps.invoiceId, amount: steps.goods }],
      }, actor, tag(key, "payment"));
      steps.paymentMovementId = payment.id;
      steps.paymentStatus = payment.status;
      await save();
    }

    // 6. extras onto the goods, by value
    if (steps.landedCostId === undefined) {
      steps.landedCostId = req.extras.length
        ? (await createLandedCost({
          costDate: date, description: req.extras.map((e) => e.description).join(", ").slice(0, 300), payee: null, amount: steps.extras, method: "VALUE",
          goodsReceiptIds: [steps.receiptId], fromFinancialAccountId: req.paidFrom.financialAccountId, reference: steps.receiptNumber ?? null,
        }, actor, tag(key, "extras"))).landedCost.id
        : null;
    }
    const finished = await completeEntry(entry.id, steps as never);
    return outcome(entry.id, steps, false, finished);
  } catch (err) {
    await releaseEntry(entry.id);
    throw err;
  }
}

function outcome(id: string, steps: PurchaseSteps, replayed: boolean, entry: { entryDate: Date; createdAt: Date; completedAt: Date | null }) {
  return { receiptId: steps.receiptId!, invoiceId: steps.invoiceId!, landedCostId: steps.landedCostId ?? null, replayed, purchase: purchaseDto(id, steps, entry) };
}

function purchaseDto(id: string, s: PurchaseSteps, e: { entryDate: Date; createdAt: Date; completedAt: Date | null }) {
  return {
    id,
    date: businessDateOf(e.entryDate),
    supplier: { id: s.supplierId ?? null, name: s.request.supplierName },
    reference: s.request.reference,
    note: s.request.note,
    lines: s.request.lines.map((l) => ({ ...l, unitCost: Math.round((l.amount / l.quantity) * 100) / 100 })),
    extrasLines: s.request.extras,
    goods: s.goods,
    extras: s.extras,
    total: s.total,
    paidFrom: s.request.paidFrom,
    receipt: s.receiptId ? { id: s.receiptId, number: s.receiptNumber ?? null } : null,
    invoice: s.invoiceId ? { id: s.invoiceId, number: s.invoiceNumber ?? null } : null,
    paymentStatus: s.paymentStatus ?? null,
    landedCostId: s.landedCostId ?? null,
    /** False: a step failed (e.g. not enough money in the account) — saving the same form again finishes it. */
    complete: Boolean(e.completedAt),
    createdAt: e.createdAt,
  };
}
export type StockPurchaseDto = ReturnType<typeof purchaseDto>;

/** Recent purchases from the hub, newest first. */
export async function listPurchases(q: { limit?: number } = {}) {
  const { business } = await getFinanceContext();
  const rows = await prisma.stockHubEntry.findMany({ where: { businessId: business.id, kind: "PURCHASE" }, orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }], take: q.limit ?? 50 });
  return { purchases: rows.map((r) => purchaseDto(r.id, r.steps as unknown as PurchaseSteps, r)) };
}
