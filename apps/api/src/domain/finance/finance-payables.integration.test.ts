import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables } from "../../test-fixtures";
import { adjustVariantStock } from "../../modules/inventory/inventory.service";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { ensurePurchasingAccounting } from "./purchasing-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { getFinanceContext } from "./finance-context";
import { processFinancialEvent } from "./events.service";
import { runReconciliation } from "./reconciliation.service";
import { createSupplier } from "./suppliers.service";
import { createTaxCode } from "./tax-codes.service";
import { approveCutover, draftCutover, postCutover } from "./inventory-cutover.service";
import { approvePurchaseOrder, createPurchaseOrder, submitPurchaseOrder } from "./purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt, reverseGoodsReceipt } from "./goods-receipts.service";
import { approvePurchaseReturn, createPurchaseReturn, shipPurchaseReturn } from "./purchase-returns.service";
import { createSupplierInvoice, deleteDraftSupplierInvoice, payablesAgeing, postSupplierInvoice, supplierOpenItems, taxOf, updateSupplierInvoice, voidSupplierInvoice } from "./supplier-invoices.service";
import type { FinanceActor } from "./finance-audit";

// Financial Core Phase 4E (docs/FINANCE_PHASE_4E.md): supplier invoices and credit notes against the real database, after a
// real cutover and a real purchase — GRNI cleared into payables, a price difference split between the stock still held and
// what was already sold (5150), a credit note against a shipped return, and a void — every check MATCHED after each step.

let OWNER: FinanceActor;
let STAFF: FinanceActor;
let A = "";
let supplierId = "";
let taxId = "";
let expenseAccountId = "";
let grnLineA = "";
let serviceLine = "";

async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
const CHECKS = ["purchasing.grni", "payables.subledger", "inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity", "events.unposted"];
async function checks() {
  await postPending();
  const r = await runReconciliation({ checks: CHECKS }, OWNER);
  return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
}
const allMatched = (r: Record<string, string>) => expect(r).toEqual(Object.fromEntries(CHECKS.map((k) => [k, "MATCHED"])));
const valueOfA = async () => Number((await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: A } })).value);
async function balance(key: string) {
  const { business } = await getFinanceContext();
  const m = await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key } } });
  const s = await prisma.journalLine.aggregate({ where: { accountId: m.accountId, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100;
}

beforeAll(async () => {
  await purgeFinanceTables();
  const owner = await ownerId();
  OWNER = { type: "ADMIN", adminId: owner, label: "owner@test", permissions: [...PERMISSIONS] };
  STAFF = { type: "ADMIN", adminId: owner, label: "accountant@test", permissions: PERMISSIONS.filter((p) => p !== "purchasing.approve") };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-01-01", reason: "books start" }, OWNER);
  A = (await createStockedProduct({ stocks: [10], basePrice: 1000 })).variants[0]!.id;
  await saveOpeningInventory([{ variantId: A, sku: "AP-A", name: "A", quantity: 10, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV-0", valuationDate: "2026-01-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  supplierId = (await createSupplier({ legalName: "Payables Fabrics Ltd", paymentTermsDays: 30 } as never, OWNER)).id;
  taxId = (await createTaxCode({ code: `VAT15AP-${Date.now() % 100000}`, name: "VAT 15% (40% recoverable)", rate: "15", recoverablePct: "40" } as never, OWNER)).id;
  expenseAccountId = (await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: ctx.business.id, type: "EXPENSE", isPostable: true, isActive: true } })).id;
  // PO: 20 × A at 120 + VAT 15% (40% recoverable → the other 60% is cost: 130.80 a unit) and a service line
  const po = await createPurchaseOrder({
    supplierId,
    lines: [
      { lineType: "STOCK", variantId: A, qtyOrdered: 20, unitPrice: 120, taxCodeId: taxId },
      { lineType: "NON_STOCK", expenseAccountId, description: "Embroidery setup", qtyOrdered: 1, unitPrice: 500, taxCodeId: taxId },
    ],
  } as never, OWNER);
  await submitPurchaseOrder(po.id, OWNER);
  await approvePurchaseOrder(po.id, OWNER);
  serviceLine = po.lines[1]!.id;
  const grn = await createGoodsReceipt({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: po.lines[0]!.id, qtyAccepted: 20 }] } as never, OWNER);
  await postGoodsReceipt(grn.id, {}, OWNER);
  grnLineA = grn.lines[0]!.id;
}, 60_000);

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`UPDATE "OrderItem" SET "costMovementId" = NULL WHERE "costMovementId" IS NOT NULL`);
  });
  await cleanupFixtures();
});

describe("tax", () => {
  it("is exact and half-even, the recoverable share of it too", () => {
    expect(taxOf(250_000, { rate: "15", recoverablePct: "40" } as never)).toEqual({ tax: 37_500, recoverable: 15_000 });
    expect(taxOf(1, { rate: "15", recoverablePct: "40" } as never)).toEqual({ tax: 0, recoverable: 0 });
    expect(taxOf(10, { rate: "15", recoverablePct: "50" } as never)).toEqual({ tax: 2, recoverable: 1 }); // 1.5 → 2, 1 → 1 (half-even)
    expect(taxOf(500, null)).toEqual({ tax: 0, recoverable: 0 });
  });
});

let billId = "";
let creditId = "";

describe("supplier invoices", () => {
  it("show what the supplier can bill; a bill can't exceed what was received; drafts are editable and deletable", async () => {
    const open = await supplierOpenItems(supplierId);
    expect(open.goods).toEqual([expect.objectContaining({ goodsReceiptLineId: grnLineA, open: 20, receiptUnitCost: 130.8, orderedUnitPrice: 120 })]);
    expect(open.services).toEqual([expect.objectContaining({ purchaseOrderLineId: serviceLine, open: 1, unitPrice: 500 })]);
    await expect(createSupplierInvoice({ kind: "INVOICE", supplierId, supplierRef: "PF-1", lines: [{ lineType: "STOCK", goodsReceiptLineId: grnLineA, quantity: 21, unitPrice: 120 }] } as never, STAFF)).rejects.toMatchObject({ statusCode: 409 });
    await expect(createSupplierInvoice({ kind: "CREDIT_NOTE", supplierId, supplierRef: "PF-1", lines: [{ lineType: "STOCK", goodsReceiptLineId: grnLineA, quantity: 1, unitPrice: 120 }] } as never, STAFF)).rejects.toMatchObject({ statusCode: 400 });
    const scratch = await createSupplierInvoice({ kind: "INVOICE", supplierId, supplierRef: "PF-0", lines: [{ lineType: "STOCK", goodsReceiptLineId: grnLineA, quantity: 1, unitPrice: 120 }] } as never, STAFF);
    await deleteDraftSupplierInvoice(scratch.id, STAFF);

    const bill = await createSupplierInvoice({
      kind: "INVOICE", supplierId, supplierRef: "PF-1001", invoiceDate: "2026-10-01",
      lines: [
        { lineType: "STOCK", goodsReceiptLineId: grnLineA, quantity: 20, unitPrice: 120, taxCodeId: taxId },
        { lineType: "EXPENSE", expenseAccountId, purchaseOrderLineId: serviceLine, description: "Embroidery setup", quantity: 1, unitPrice: 500, taxCodeId: taxId },
      ],
    } as never, STAFF);
    billId = bill.id;
    expect(bill).toMatchObject({ status: "DRAFT", dueDate: "2026-10-31", net: 2900, tax: 435, total: 3335 });
    expect(bill.number).toMatch(/^BILL-\d{6}$/);
    // the supplier actually charged 125 a unit — edit the draft
    const edited = await updateSupplierInvoice(billId, { lines: [
      { lineType: "STOCK", goodsReceiptLineId: grnLineA, quantity: 20, unitPrice: 125, taxCodeId: taxId },
      { lineType: "EXPENSE", expenseAccountId, purchaseOrderLineId: serviceLine, description: "Embroidery setup", quantity: 1, unitPrice: 500, taxCodeId: taxId },
    ] } as never, STAFF);
    expect(edited).toMatchObject({ net: 3000, tax: 450, total: 3450 });
    await expect(createSupplierInvoice({ kind: "INVOICE", supplierId, supplierRef: " pf-1001 ", lines: [{ lineType: "EXPENSE", expenseAccountId, description: "x", quantity: 1, unitPrice: 1 }] } as never, STAFF)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("posting clears GRNI at the receipt value; the price difference revalues the units still held and sends the sold share to 5150", async () => {
    await adjustVariantStock(A, -25, "DAMAGED", OWNER.type === "ADMIN" ? OWNER.adminId : "", "flood"); // 30 → 5 held
    await postPending();
    const before = await valueOfA();
    // 125 is 4.2% over the order's 120 — the tolerance is 0%: an approver confirms it with a reason
    await expect(postSupplierInvoice(billId, { varianceReason: "price rise" }, STAFF)).rejects.toMatchObject({ statusCode: 409 });
    await expect(postSupplierInvoice(billId, {}, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    const [x, y] = await Promise.all([postSupplierInvoice(billId, { varianceReason: "Cotton price rise agreed by phone" }, OWNER), postSupplierInvoice(billId, { varianceReason: "Cotton price rise agreed by phone" }, OWNER)]);
    expect([x.replayed, y.replayed].sort()).toEqual([false, true]);
    const posted = x.replayed ? y.invoice : x.invoice;
    // stock line: net 2,500 + non-recoverable tax 225 = 2,725 billed cost; GRNI cleared 20 × 130.80 = 2,616; difference 109
    expect(posted.lines[0]).toMatchObject({ net: 2500, tax: 375, recoverableTax: 150, cleared: 2616, priceDifference: 109 });
    expect(posted).toMatchObject({ status: "POSTED", total: 3450, varianceReason: "Cotton price rise agreed by phone" });
    // 5 of the 20 billed units are still held → 109 × 5 / 20 = 27.25 revalues the stock; 81.75 goes to 5150
    expect(Math.round((await valueOfA() - before) * 100) / 100).toBe(27.25);
    allMatched(await checks());
    expect(await balance("liability.grni")).toBe(0);
    expect(await balance("liability.payable_trade")).toBe(-3450);
    expect(await balance("asset.vat_input")).toBe(150 + 30);
    expect(await balance("expense.non_recoverable_tax")).toBe(45);
    // the receipt is now billed: it can't be reversed, or billed again
    await expect(reverseGoodsReceipt((await prisma.goodsReceiptLine.findUniqueOrThrow({ where: { id: grnLineA } })).goodsReceiptId, "wrong", OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await expect(createSupplierInvoice({ kind: "INVOICE", supplierId, supplierRef: "PF-1002", lines: [{ lineType: "STOCK", goodsReceiptLineId: grnLineA, quantity: 1, unitPrice: 125 }] } as never, STAFF)).rejects.toMatchObject({ statusCode: 409 });
    expect((await supplierOpenItems(supplierId)).goods).toEqual([]);
    await expect(prisma.supplierInvoice.update({ where: { id: billId }, data: { supplierRef: "edited" } })).rejects.toThrow(/immutable/);
  });

  it("a credit note against a shipped return clears the returns liability; the difference to the returned value goes to 5150", async () => {
    const ret = await createPurchaseReturn({ supplierId, reason: "Faulty stitching", lines: [{ goodsReceiptLineId: grnLineA, quantity: 3 }] } as never, OWNER);
    await approvePurchaseReturn(ret.id, OWNER);
    const shipped = await shipPurchaseReturn(ret.id, OWNER);
    const returnLine = shipped.purchaseReturn.lines[0]!;
    allMatched(await checks());
    const open = await supplierOpenItems(supplierId);
    expect(open.returns).toEqual([expect.objectContaining({ purchaseReturnLineId: returnLine.id, open: 3 })]);
    const cn = await createSupplierInvoice({ kind: "CREDIT_NOTE", supplierId, supplierRef: "PF-CN-7", lines: [{ lineType: "RETURN", purchaseReturnLineId: returnLine.id, quantity: 3, unitPrice: 125, taxCodeId: taxId }] } as never, STAFF);
    expect(cn.number).toMatch(/^CN-\d{6}$/);
    const posted = (await postSupplierInvoice(cn.id, {}, STAFF)).invoice;
    creditId = cn.id;
    // credited cost 375 + 33.75 non-recoverable = 408.75 against the value the 3 units left at
    expect(posted.lines[0]!.cleared).toBe(returnLine.value);
    expect(posted.lines[0]!.priceDifference).toBe(Math.round((408.75 - returnLine.value!) * 100) / 100);
    expect(posted.total).toBe(431.25);
    allMatched(await checks());
    expect(await balance("liability.payable_trade")).toBe(-(3450 - 431.25));
  });

  it("ageing shows each supplier's balance by days past due, less unapplied credits", async () => {
    const a = await payablesAgeing();
    const row = a.suppliers.find((s) => s.supplier.id === supplierId)!;
    expect(row).toMatchObject({ invoices: 1, credits: 431.25, balance: 3018.75 });
    expect(row.current + row.d1_30 + row.d31_60 + row.d61_90 + row.d90_plus).toBe(3450);
  });

  it("voiding reverses the journal and the price-difference revaluation; the goods can be billed again", async () => {
    const valueBefore = await valueOfA();
    expect((await voidSupplierInvoice(billId, "Supplier re-issued the bill", STAFF)).status).toBe("VOID");
    // 2 units held now (5 − 3 returned) of the 20 → −109 × 2 / 20 = −10.90 comes off the stock, the rest off 5150
    expect(Math.round((await valueOfA() - valueBefore) * 100) / 100).toBe(-10.9);
    allMatched(await checks());
    expect(await balance("liability.grni")).toBe(-2616); // a liability: credit balance
    expect(await balance("liability.payable_trade")).toBe(431.25);
    expect((await supplierOpenItems(supplierId)).goods).toEqual([expect.objectContaining({ open: 20 })]);
    expect((await voidSupplierInvoice(creditId, "Entered against the wrong return", OWNER)).status).toBe("VOID");
    allMatched(await checks());
    expect(await balance("liability.payable_trade")).toBe(0);
  });
});
