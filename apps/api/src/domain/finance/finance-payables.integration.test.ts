import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables } from "../../test-fixtures";
import { adjustVariantStock } from "../../modules/inventory/inventory.service";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { ensurePurchasingAccounting } from "./purchasing-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { businessToday, getFinanceContext } from "./finance-context";
import { processFinancialEvent } from "./events.service";
import { runReconciliation } from "./reconciliation.service";
import { createSupplier } from "./suppliers.service";
import { createTaxCode } from "./tax-codes.service";
import { approveCutover, draftCutover, postCutover } from "./inventory-cutover.service";
import { approvePurchaseOrder, createPurchaseOrder, submitPurchaseOrder } from "./purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt, reverseGoodsReceipt } from "./goods-receipts.service";
import { approvePurchaseReturn, createPurchaseReturn, shipPurchaseReturn } from "./purchase-returns.service";
import { createSupplierInvoice, deleteDraftSupplierInvoice, payablesAgeing, postSupplierInvoice, supplierOpenItems, taxOf, updateSupplierInvoice, voidSupplierInvoice } from "./supplier-invoices.service";
import { allocateToBill, paySupplier, releaseAllocation, supplierAccount } from "./supplier-payments.service";
import { createFinancialAccount } from "./financial-accounts.service";
import { balanceSheet, cashFlow, incomeStatement } from "./statements.service";
import { getTrialBalance } from "./ledger.service";
import { createCommitment, dueDates, expenseSummary, listCommitments, recordExpense } from "./expenses.service";
import { financeAlerts, monthEndChecklist } from "./finance-alerts.service";
import { createPartner, equityOverview, updatePartner } from "./equity.service";
import { createComponent, createEmployee, createPayRun, deleteDraftPayRun, payPayslips, payrollOverview, postPayRun, remitDeductions, reversePayRun, setPayslipPresence, standardLines, updateComponent, updatePayslip } from "./payroll.service";
import { changePeriodStatus } from "./periods.service";
import { budgetVsActual, cashForecast, createBudget, setBudgetLines } from "./budgets.service";
import { moneyBalanceAt } from "./ledger.service";
import { drawLoan, interestFor, listLoans, plannedSchedule, repayLoan, reverseLatestAccrual, runInterestAccrual } from "./loans.service";
import { assetRegister, createAsset, disposeAsset, monthlyCharge, reverseLatestRun, runDepreciation, updateAsset } from "./fixed-assets.service";
import { costAdjustments, grniAgeing, inventoryValuation, paymentsRegister, priceVariance, purchaseRegister } from "./purchasing-reports.service";
import { rejectMovement, requestMovement, reverseMovement } from "./treasury.service";
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

describe("supplier payments (Phase 4F)", () => {
  let cashId = "";
  let bill1 = "";
  let bill2 = "";
  let firstPayment = "";
  const bill = async (ref: string, amount: number) => {
    const b = await createSupplierInvoice({ kind: "INVOICE", supplierId, supplierRef: ref, invoiceDate: "2026-10-01", lines: [{ lineType: "EXPENSE", expenseAccountId, description: `Service ${ref}`, quantity: 1, unitPrice: amount }] } as never, OWNER);
    return (await postSupplierInvoice(b.id, {}, OWNER)).invoice.id;
  };
  const outstanding = async (id: string) => (await prisma.supplierInvoice.findUniqueOrThrow({ where: { id }, include: { allocations: { where: { status: "ACTIVE" }, include: { paymentMovement: true } } } })).allocations
    .filter((a) => a.creditNoteId || a.paymentMovement?.status === "POSTED").reduce((s, a) => s - Number(a.amount), 0);

  it("a payment settles the bills it names, from a money account, exactly once", async () => {
    cashId = (await createFinancialAccount({ kind: "CASH", name: `AP cash ${Date.now() % 100000}`, openingBalance: { amount: 5000, date: "2026-10-01" } } as never, OWNER)).id;
    bill1 = await bill("PF-2001", 1000);
    bill2 = await bill("PF-2002", 500);
    const body = { supplierId, fromFinancialAccountId: cashId, movementDate: "2026-10-05", amount: 1200, reference: "CHQ-1", allocations: [{ invoiceId: bill1, amount: 1000 }, { invoiceId: bill2, amount: 200 }] };
    const r = await paySupplier(body, OWNER, "pay-1");
    expect(r).toMatchObject({ replayed: false, payment: { kind: "SUPPLIER_PAYMENT", status: "POSTED", amount: 1200, supplierId } });
    firstPayment = r.payment.id;
    expect((await paySupplier(body, OWNER, "pay-1")).replayed).toBe(true);
    expect(await outstanding(bill1)).toBe(-1000);
    allMatched(await checks());
    const acct = await supplierAccount(supplierId);
    expect(acct.balance).toBe(300);
    expect(acct.openBills).toEqual([expect.objectContaining({ id: bill2, total: 500, settled: 200, outstanding: 300 })]);
    expect(acct.statement.filter((l) => l.owedLess === 1200)).toHaveLength(1);
    expect(acct.statement.at(-1)!.balance).toBe(300);
  });

  it("refuses paying more than a bill owes, or more than a cash box holds", async () => {
    await expect(paySupplier({ supplierId, fromFinancialAccountId: cashId, amount: 400, allocations: [{ invoiceId: bill2, amount: 400 }] }, OWNER, "pay-over")).rejects.toMatchObject({ statusCode: 409 });
    await expect(paySupplier({ supplierId, fromFinancialAccountId: cashId, amount: 10_000 }, OWNER, "pay-big")).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.treasuryMovement.count({ where: { idempotencyKey: { in: ["supplier-payment:pay-over", "supplier-payment:pay-big"] } } })).toBe(0);
  });

  it("an unallocated payment is an advance until allocated; allocations are released, never edited", async () => {
    const adv = await paySupplier({ supplierId, fromFinancialAccountId: cashId, amount: 500, reference: "ADV" }, OWNER, "pay-adv");
    let acct = await supplierAccount(supplierId);
    expect(acct.balance).toBe(-200);
    expect(acct.advances).toEqual([expect.objectContaining({ paymentMovementId: adv.payment.id, unallocated: 500 })]);
    expect((await payablesAgeing()).suppliers.find((s) => s.supplier.id === supplierId)).toMatchObject({ advances: 500, balance: -200 });
    const a = await allocateToBill({ invoiceId: bill2, amount: 300, paymentMovementId: adv.payment.id }, OWNER);
    acct = await supplierAccount(supplierId);
    expect(acct.openBills).toEqual([]);
    expect(acct.advances[0]).toMatchObject({ unallocated: 200 });
    await expect(allocateToBill({ invoiceId: bill1, amount: 1, paymentMovementId: adv.payment.id }, OWNER)).rejects.toMatchObject({ statusCode: 409 }); // bill1 is settled
    await expect(voidSupplierInvoice(bill2, "wrong", OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await expect(prisma.supplierAllocation.update({ where: { id: a.id }, data: { amount: 1 } })).rejects.toThrow(/immutable/);
    await releaseAllocation(a.id, "Allocated to the wrong bill", OWNER);
    expect((await supplierAccount(supplierId)).openBills).toEqual([expect.objectContaining({ id: bill2, outstanding: 300 })]);
    allMatched(await checks());
  });

  it("a credit note settles a bill without a journal; a payment awaiting approval reserves but settles nothing; reject and reverse release", async () => {
    const cn = await createSupplierInvoice({ kind: "CREDIT_NOTE", supplierId, supplierRef: "PF-CN-20", lines: [{ lineType: "EXPENSE", expenseAccountId, description: "Discount", quantity: 1, unitPrice: 100 }] } as never, OWNER);
    await postSupplierInvoice(cn.id, {}, OWNER);
    const entries = await prisma.journalEntry.count();
    await allocateToBill({ invoiceId: bill2, amount: 100, creditNoteId: cn.id }, OWNER);
    expect(await prisma.journalEntry.count()).toBe(entries);
    expect((await supplierAccount(supplierId)).openBills).toEqual([expect.objectContaining({ id: bill2, outstanding: 200 })]);

    const CLERK: FinanceActor = { type: "ADMIN", adminId: OWNER.type === "ADMIN" ? OWNER.adminId : "", label: "clerk@test", permissions: PERMISSIONS.filter((p) => p !== "finance.post" && p !== "purchasing.approve") };
    const pending = await paySupplier({ supplierId, fromFinancialAccountId: cashId, amount: 150, allocations: [{ invoiceId: bill2, amount: 150 }] }, CLERK, "pay-pending");
    expect(pending.payment.status).toBe("PENDING_APPROVAL");
    let open = (await supplierAccount(supplierId)).openBills[0]!;
    expect(open).toMatchObject({ outstanding: 200, awaitingApproval: 150, allocatable: 50 });
    await expect(paySupplier({ supplierId, fromFinancialAccountId: cashId, amount: 100, allocations: [{ invoiceId: bill2, amount: 100 }] }, OWNER, "pay-race")).rejects.toMatchObject({ statusCode: 409 });
    await rejectMovement(pending.payment.id, "Pay by bank instead", OWNER);
    open = (await supplierAccount(supplierId)).openBills[0]!;
    expect(open).toMatchObject({ outstanding: 200, awaitingApproval: 0, allocatable: 200 });

    await reverseMovement(firstPayment, { reason: "Cheque bounced" }, OWNER);
    await postPending(); // the credit note's journal posts through the event inbox
    const acct = await supplierAccount(supplierId);
    expect(acct.openBills.map((b) => [b.id, b.outstanding])).toEqual([[bill1, 1000], [bill2, 400]]);
    expect(acct.balance).toBe(1500 - 100 - 500);
    allMatched(await checks());
  });
});

describe("reports (Phase 4G) — every total ties to its account", () => {
  it("GRNI ageing, valuation, cost adjustments, payments and the purchase register agree with the books", async () => {
    await postPending();
    const g = await grniAgeing();
    expect(g.grni).toBe(-(await balance("liability.grni")));
    expect(g.receivedNotBilled).toBe(2616);
    expect(g.open).toEqual([expect.objectContaining({ unbilledQty: 20, unbilled: 2616 })]);

    const v = await inventoryValuation();
    const states = await prisma.inventoryCostState.aggregate({ _sum: { value: true } });
    expect(v.totals.value).toBe(Math.round(Number(states._sum.value) * 100) / 100);
    expect(v.items.find((i) => i.variantId === A)).toMatchObject({ valuedQty: 2 });

    const c = await costAdjustments({});
    expect(c.totals.net).toBe(await balance("cogs.cost_adjustments"));
    expect(c.rows.map((r) => r.origin).sort()).toEqual(["CREDIT", "PRICE"]); // reversals count under what they reverse

    const pay = await paymentsRegister({ supplierId });
    const posted = await prisma.treasuryMovement.aggregate({ where: { kind: "SUPPLIER_PAYMENT", status: "POSTED", supplierId }, _sum: { amount: true } });
    expect(pay.totals.paid).toBe(Number(posted._sum.amount));
    expect(pay.items.map((i) => i.status).sort()).toEqual(["POSTED", "REJECTED", "REVERSED"]);

    const reg = await purchaseRegister({ supplierId });
    expect(reg.totals).toMatchObject({ received: 2616, billed: 1500, credited: 100 });
    const pv = await priceVariance({});
    expect(pv.totals.booked).toBe(0); // the only priced bill was voided
  });
});

describe("financial statements (E6) — tie to the trial balance", () => {
  it("balance sheet balances, the income statement equals the P&L accounts, cash flow explains the money accounts", async () => {
    await postPending();
    const today = businessToday((await getFinanceContext()).business); // the business date, not UTC (they differ after midnight in Dhaka)
    const bs = await balanceSheet({ asOf: today });
    expect(bs.balanced).toBe(true);
    const tb = await getTrialBalance({ to: today });
    const assets = tb.rows.filter((r) => r.type === "ASSET").reduce((s, r) => s + Math.round((r.closingDebit - r.closingCredit) * 100), 0);
    expect(Math.round(bs.totalAssets * 100)).toBe(assets);

    const is = await incomeStatement({ from: "2026-01-01", to: today });
    const pl = tb.rows.filter((r) => ["REVENUE", "COGS", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"].includes(r.type)).reduce((s, r) => s + Math.round((r.closingCredit - r.closingDebit) * 100), 0);
    expect(Math.round(is.current.netProfit * 100)).toBe(pl);
    expect(is.prior.to < is.period.from).toBe(true);
    // the profit not yet closed appears in equity
    expect(bs.sections.find((x) => x.key === "equity")!.lines.some((l) => l.group === "Current earnings")).toBe(pl !== 0);

    const cf = await cashFlow({ from: "2026-10-01", to: today });
    expect(cf.reconciles).toBe(true);
    expect(cf.netChange).toBe(cf.money.change);
    expect(cf.money.change).toBe(4500); // the cash box: 5,000 opening funding − the 500 advance (the 1,200 payment was reversed)

    // without finance.sensitive the same totals, nothing attributed
    const restricted = await balanceSheet({ asOf: today }, { sensitive: false });
    expect(restricted.totalAssets).toBe(bs.totalAssets);
    expect(restricted.totalLiabilitiesAndEquity).toBe(bs.totalLiabilitiesAndEquity);
  });
});

describe("expenses and recurring commitments (E7)", () => {
  it("schedules monthly / quarterly periods inside a window", () => {
    expect(dueDates({ frequency: "MONTHLY", dayOfMonth: 5, startDate: "2026-07-15", endDate: null }, "2026-08-01", "2026-10-31").map((d) => d.dueDate)).toEqual(["2026-08-05", "2026-09-05", "2026-10-05"]);
    expect(dueDates({ frequency: "QUARTERLY", dayOfMonth: 10, startDate: "2026-01-10", endDate: "2026-09-30" }, "2026-01-01", "2026-12-31").map((d) => d.periodKey)).toEqual(["2026-01", "2026-04", "2026-07"]);
  });

  it("a commitment period is paid once through a money movement; reversing the payment reopens it", async () => {
    const { business } = await getFinanceContext();
    const rent = await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: business.id, code: "6100" } });
    const packaging = await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: business.id, code: "6800" } });
    const bankId = (await createFinancialAccount({ kind: "BANK", name: `Expense bank ${Date.now() % 100000}` } as never, OWNER)).id;
    const c = await createCommitment({ name: "Shop rent", expenseAccountId: rent.id, amount: 2000, frequency: "MONTHLY", dayOfMonth: 1, startDate: "2026-08-01", financialAccountId: bankId, payee: "Landlord" }, OWNER);
    expect(c.schedule.map((x) => [x.periodKey, x.status])).toEqual(expect.arrayContaining([["2026-08", "OVERDUE"], ["2026-09", "OVERDUE"]]));

    const paid = await recordExpense({ commitmentId: c.id, periodKey: "2026-09", expenseDate: "2026-09-02" }, OWNER, "rent-sep");
    expect(paid.expense).toMatchObject({ status: "POSTED", amount: 2000, costBehaviour: "FIXED", payee: "Landlord", periodKey: "2026-09" });
    expect((await recordExpense({ commitmentId: c.id, periodKey: "2026-09", expenseDate: "2026-09-02" }, OWNER, "rent-sep")).replayed).toBe(true);
    await expect(recordExpense({ commitmentId: c.id, periodKey: "2026-09" }, OWNER, "rent-sep-again")).rejects.toMatchObject({ statusCode: 409 });
    await expect(recordExpense({ commitmentId: c.id, periodKey: "2026-11" }, OWNER, "rent-not-due-yet-bad")).resolves.toBeTruthy(); // paying ahead is allowed
    await expect(recordExpense({ commitmentId: c.id, periodKey: "2026-07" }, OWNER, "rent-before-start")).rejects.toMatchObject({ statusCode: 400 });
    const box = await recordExpense({ expenseAccountId: packaging.id, amount: 300, fromFinancialAccountId: bankId, description: "Mailer boxes", payee: "Box Co" }, OWNER, "boxes-1");
    expect(box.expense).toMatchObject({ costBehaviour: "VARIABLE", status: "POSTED" });
    await expect(prisma.expense.update({ where: { id: box.expense.id }, data: { payee: "x" } })).rejects.toThrow(/immutable/);

    const list = await listCommitments();
    const rentRow = list.commitments.find((x) => x.id === c.id)!;
    expect(rentRow.schedule.find((x) => x.periodKey === "2026-09")).toMatchObject({ status: "PAID" });
    expect(list.totals.fixedMonthly).toBe(2000);
    const sum = await expenseSummary({ from: "2026-09-01", to: "2026-12-31" });
    expect(sum.totals).toMatchObject({ fixed: 4000, variable: 300, total: 4300 });

    await reverseMovement(paid.expense.movementId, { reason: "Paid twice by mistake" }, OWNER);
    expect((await listCommitments()).commitments.find((x) => x.id === c.id)!.schedule.find((x) => x.periodKey === "2026-09")).toMatchObject({ status: "OVERDUE" });
    const r = await runReconciliation({ checks: ["ledger.integrity", "events.unposted"] }, OWNER);
    expect(r.results.every((x) => x.status === "MATCHED")).toBe(true);
  });
});

describe("fixed assets and depreciation (E9)", () => {
  const FA_CHECKS = ["fixed_assets.register", "ledger.integrity", "events.unposted"];
  const faChecks = async () => {
    await postPending();
    const r = await runReconciliation({ checks: FA_CHECKS }, OWNER);
    return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
  };

  it("charges straight-line and declining balance exactly, never below the residual", () => {
    const sl = { cost: 1_200_000, residual: 0, openingAccumulated: 0, lifeMonths: 12, method: "STRAIGHT_LINE" as const, ratePct: null, start: "2026-01" };
    expect(monthlyCharge(sl, 0, "2025-12")).toBe(0);
    expect(monthlyCharge(sl, 0, "2026-01")).toBe(100_000);
    expect(monthlyCharge(sl, 1_100_001, "2026-12")).toBe(99_999); // the last month takes the rest
    const db = { cost: 10_000_000, residual: 1_000_000, openingAccumulated: 0, lifeMonths: 60, method: "DECLINING_BALANCE" as const, ratePct: 20, start: "2026-01" };
    expect(monthlyCharge(db, 0, "2026-01")).toBe(166_667); // 100,000 × 20% ÷ 12
    expect(monthlyCharge(db, 8_990_000, "2026-06")).toBe(10_000); // 16,833 by rate, capped at the 10,000 left above the residual
  });

  it("registers an asset billed by a supplier, depreciates it month by month, and disposes of it at a loss", async () => {
    const { business } = await getFinanceContext();
    const computers = await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: business.id, code: "1830" } });
    const other = await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: business.id, code: "6900" } });
    const bankId = (await createFinancialAccount({ kind: "BANK", name: `Asset bank ${Date.now() % 100000}` } as never, OWNER)).id;
    const bill = await createSupplierInvoice({ kind: "INVOICE", supplierId, supplierRef: "LAPTOP-1", invoiceDate: "2026-08-03", lines: [{ lineType: "EXPENSE", expenseAccountId: computers.id, description: "Laptop", quantity: 1, unitPrice: 60_000 }] } as never, OWNER);
    await postSupplierInvoice(bill.id, {}, OWNER);
    const laptop = await createAsset({ name: "Design laptop", category: "Computers", assetAccountId: computers.id, acquisitionDate: "2026-08-03", cost: 60_000, usefulLifeMonths: 24, sourceType: "SUPPLIER_INVOICE", sourceRef: bill.number }, OWNER);
    expect(laptop).toMatchObject({ number: expect.stringMatching(/^FA-\d{4}$/), depreciationStart: "2026-08", bookValue: 60_000, nextCharge: { periodKey: "2026-08", amount: 2500 }, monthsLeft: 24 });
    expect(await faChecks()).toEqual({ "fixed_assets.register": "MATCHED", "ledger.integrity": "MATCHED", "events.unposted": "MATCHED" });

    expect((await runDepreciation("2026-08", OWNER)).run).toMatchObject({ total: 2500, assets: 1 });
    await expect(runDepreciation("2026-10", OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await runDepreciation("2026-09", OWNER);
    expect((await runDepreciation("2026-09", OWNER)).replayed).toBe(true);
    await expect(updateAsset(laptop.id, { usefulLifeMonths: 36 }, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    expect(await faChecks()).toEqual({ "fixed_assets.register": "MATCHED", "ledger.integrity": "MATCHED", "events.unposted": "MATCHED" });

    // an asset first booked to an expense account is moved onto its asset account; it starts after the last run
    await expect(createAsset({ name: "Shelving", assetAccountId: computers.id, acquisitionDate: "2026-09-10", cost: 12_000, usefulLifeMonths: 60, reclassifyFromAccountId: other.id }, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    const shelving = await createAsset({ name: "Shelving", assetAccountId: computers.id, acquisitionDate: "2026-09-10", cost: 12_000, usefulLifeMonths: 60, depreciationStart: "2026-10", reclassifyFromAccountId: other.id }, OWNER);
    expect(shelving.sourceType).toBe("OTHER");
    expect(await faChecks()).toEqual({ "fixed_assets.register": "MATCHED", "ledger.integrity": "MATCHED", "events.unposted": "MATCHED" });

    await reverseLatestRun("Ran before the laptop's invoice was checked", OWNER);
    expect((await assetRegister()).assets.find((a) => a.id === laptop.id)).toMatchObject({ accumulatedDepreciation: 2500, lastDepreciatedMonth: "2026-08" });
    await runDepreciation("2026-09", OWNER);
    const reg = await assetRegister();
    expect(reg.totals).toMatchObject({ cost: 72_000, accumulatedDepreciation: 5000, bookValue: 67_000, assets: 2 });
    expect(reg.nextRun).toBe("2026-10");

    await expect(disposeAsset(laptop.id, { disposalDate: "2099-01-02", proceeds: 50_000, financialAccountId: bankId, reason: "Sold" }, OWNER)).rejects.toMatchObject({ statusCode: 400 }); // not yet happened
    await expect(disposeAsset(laptop.id, { disposalDate: "2026-10-05", proceeds: 50_000, reason: "Sold" }, OWNER)).rejects.toMatchObject({ statusCode: 400 }); // proceeds need an account
    const sold = await disposeAsset(laptop.id, { disposalDate: "2026-10-05", proceeds: 50_000, financialAccountId: bankId, reason: "Sold to a staff member" }, OWNER);
    expect(sold).toMatchObject({ status: "DISPOSED", disposalProceeds: 50_000, disposalGainLoss: -5000, bookValue: 0 }); // book value 55,000 − 50,000
    expect(await balance("expense.asset_disposal_loss")).toBe(5000);
    expect(await faChecks()).toEqual({ "fixed_assets.register": "MATCHED", "ledger.integrity": "MATCHED", "events.unposted": "MATCHED" });
    await expect(reverseLatestRun("undo", OWNER)).rejects.toMatchObject({ statusCode: 409 }); // the laptop is gone
  });
});

describe("loans (E10)", () => {
  const LOAN_CHECKS = ["loans.subledger", "ledger.integrity", "treasury.integrity", "events.unposted"];
  const loanChecks = async () => {
    await postPending();
    const r = await runReconciliation({ checks: LOAN_CHECKS }, OWNER);
    return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
  };
  const allLoanMatched = async () => expect(await loanChecks()).toEqual(Object.fromEntries(LOAN_CHECKS.map((k) => [k, "MATCHED"])));

  it("interest is actual/365 on each day's balance; the plan repays the principal exactly", () => {
    expect(interestFor(12_000_000, 12, "2026-08-01", "2026-08-31", [])).toBe(122_301); // 120,000 × 12% × 31 / 365
    // 60,000 repaid on the 15th: 15 days on 120,000, 16 on 60,000
    expect(interestFor(12_000_000, 12, "2026-08-01", "2026-08-31", [{ date: "2026-08-15", principal: 6_000_000 }])).toBe(Math.round((12_000_000 * 15 + 6_000_000 * 16) * 0.12 / 365));
    for (const type of ["ANNUITY", "EQUAL_PRINCIPAL"] as const) {
      const plan = plannedSchedule({ principal: 12_000_000, ratePct: 12, termMonths: 12, type, firstDueDate: "2026-09-01" });
      expect(plan.reduce((s, x) => s + x.principal, 0)).toBe(12_000_000);
      expect(plan.at(-1)!.balance).toBe(0);
    }
    expect(plannedSchedule({ principal: 12_000_000, ratePct: 12, termMonths: 12, type: "ANNUITY", firstDueDate: "2026-01-31" })[1]!.dueDate).toBe("2026-02-28");
  });

  it("draws, accrues interest month by month, repays interest first then principal, and ties to the ledger", async () => {
    const bankId = (await createFinancialAccount({ kind: "BANK", name: `Loan bank ${Date.now() % 100000}` } as never, OWNER)).id;
    const body = { lender: "City Bank SME desk", principal: 120_000, annualRatePct: 12, termMonths: 12, drawdownDate: "2026-08-01", firstDueDate: "2026-09-01", financialAccountId: bankId };
    const { loan } = await drawLoan(body, OWNER, "loan-1");
    expect(loan).toMatchObject({ number: "LN-001", status: "ACTIVE", drawn: 120_000, outstanding: 120_000 });
    expect((await drawLoan(body, OWNER, "loan-1")).replayed).toBe(true);
    await allLoanMatched();

    await expect(runInterestAccrual("2099-01", OWNER)).rejects.toMatchObject({ statusCode: 409 });
    expect((await runInterestAccrual("2026-08", OWNER)).run).toMatchObject({ total: 1223.01, loans: 1 });
    await expect(runInterestAccrual("2026-08", OWNER)).resolves.toMatchObject({ replayed: true });
    await allLoanMatched();

    const paid = await repayLoan(loan.id, { paymentDate: "2026-09-01", amount: 11_000, fromFinancialAccountId: bankId, reference: "EMI-1" }, OWNER, "emi-1");
    expect(paid.loan.repayments[0]).toMatchObject({ interestPart: 1223.01, principalPart: 9776.99 });
    expect(paid.loan).toMatchObject({ interestDue: 0, outstanding: 110_223.01 });
    expect((await repayLoan(loan.id, { paymentDate: "2026-09-01", amount: 11_000, fromFinancialAccountId: bankId }, OWNER, "emi-1")).replayed).toBe(true);
    await expect(repayLoan(loan.id, { amount: 200_000, fromFinancialAccountId: bankId }, OWNER, "emi-too-big")).rejects.toMatchObject({ statusCode: 409 });
    await allLoanMatched();

    await expect(runInterestAccrual("2026-10", OWNER)).rejects.toMatchObject({ statusCode: 409 }); // September first
    const sep = await runInterestAccrual("2026-09", OWNER);
    // 1 Sep on 120,000, then 29 days on 110,223.01
    expect(sep.run.total).toBe(Math.round((12_000_000 * 1 + 11_022_301 * 29) * 0.12 / 365) / 100);
    await allLoanMatched();
    await reverseLatestAccrual("Rate changed — re-run", OWNER);
    expect((await listLoans()).loans[0]).toMatchObject({ interestAccrued: 1223.01, lastAccruedMonth: "2026-08" });
    await runInterestAccrual("2026-09", OWNER);
    await allLoanMatched();
  });
});

describe("budgets, cash forecast and runway (E12)", () => {
  it("budget vs actual uses the books' own figures; a budget copies last year's actuals ± a percentage", async () => {
    const { business } = await getFinanceContext();
    const rent = await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: business.id, code: "6100" } });
    const cash = await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: business.id, code: "1610" } });
    const b = await createBudget({ name: "FY 2026-27", startMonth: "2026-08" }, OWNER);
    await setBudgetLines(b.id, ["2026-08", "2026-09", "2026-10"].map((periodKey) => ({ accountId: rent.id, periodKey, amount: 1500 })), OWNER);
    await expect(setBudgetLines(b.id, [{ accountId: cash.id, periodKey: "2026-08", amount: 1 }], OWNER)).rejects.toMatchObject({ statusCode: 400 });
    await expect(setBudgetLines(b.id, [{ accountId: rent.id, periodKey: "2028-01", amount: 1 }], OWNER)).rejects.toMatchObject({ statusCode: 400 });
    await expect(createBudget({ name: "FY 2026-27", startMonth: "2026-08" }, OWNER)).rejects.toMatchObject({ statusCode: 409 });

    await postPending();
    const v = await budgetVsActual(b.id, { through: "2026-10" });
    const row = v.rows.find((r) => r.account.id === rent.id)!;
    const ledger = await prisma.journalLine.aggregate({ where: { accountId: rent.id, entry: { status: "POSTED", entryDate: { gte: new Date("2026-08-01T00:00:00Z"), lte: new Date("2026-10-31T00:00:00Z") } } }, _sum: { debit: true, credit: true } });
    expect(row.actualYtd).toBe(Math.round((Number(ledger._sum.debit ?? 0) - Number(ledger._sum.credit ?? 0)) * 100) / 100);
    expect(row).toMatchObject({ budgetYtd: 4500, budgetYear: 4500, favourable: row.actualYtd < 4500 });
    const is = await incomeStatement({ from: "2026-08-01", to: "2026-10-31" });
    expect(v.totals.netProfit.actualYtd).toBe(is.current.netProfit);

    const next = await createBudget({ name: "FY 2027-28", startMonth: "2027-08", copyFrom: "LAST_YEAR", adjustPct: 10 }, OWNER);
    const nv = await budgetVsActual(next.id);
    const rentAug = nv.rows.find((r) => r.account.id === rent.id)?.months.find((m) => m.periodKey === "2027-10")?.budget ?? 0;
    const octActual = row.months.find((m) => m.periodKey === "2026-10")!.actual;
    expect(rentAug).toBe(Math.max(0, Math.round(octActual * 1.1 * 100) / 100));
  });

  it("the cash forecast starts from cash, bank and wallets, names every line's source and adds up", async () => {
    const { business } = await getFinanceContext();
    const f = await cashForecast({ weeks: 13 });
    const paying = await prisma.financialAccount.findMany({ where: { businessId: business.id, isActive: true, kind: { in: ["CASH", "BANK", "MOBILE_WALLET"] } } });
    let opening = 0;
    for (const a of paying) opening += await moneyBalanceAt(prisma, business.id, a.ledgerAccountId, business.baseCurrency, f.asOf);
    expect(Math.round(f.opening * 100)).toBe(opening);
    expect(f.byWeek).toHaveLength(13);
    expect(f.lines.some((l) => l.source === "COMMITMENT")).toBe(true); // the shop rent
    expect(f.lines.some((l) => l.source === "LOAN")).toBe(true); // the loan's planned instalments
    const flow = f.lines.filter((l) => l.week <= 13).reduce((s, l) => s + Math.round(l.amount * 100), 0);
    expect(Math.round(f.closing * 100)).toBe(Math.round(f.opening * 100) + flow);
    expect(f.lowest.balance).toBeLessThanOrEqual(f.opening);
  });
});

describe("alerts and month-end close (E14)", () => {
  it("every alert links to its fix, is ordered by severity, and clears once its cause is fixed", async () => {
    const order = { critical: 0, warning: 1, info: 2 } as const;
    const before = await financeAlerts();
    for (const a of before.alerts) expect(a).toMatchObject({ href: expect.stringMatching(/^\/admin\//), count: expect.any(Number), action: expect.any(String) });
    expect(before.alerts.every((a) => a.count > 0)).toBe(true);
    expect(before.alerts.map((a) => order[a.severity])).toEqual([...before.alerts.map((a) => order[a.severity])].sort((x, y) => x - y));
    expect(before.counts.critical + before.counts.warning + before.counts.info).toBe(before.alerts.length);
    const approvalsBefore = before.alerts.find((a) => a.key === "treasury.approvals")?.count ?? 0;

    // a payment waiting for approval raises the alert; rejecting it clears it
    const { business } = await getFinanceContext();
    const cash = await prisma.financialAccount.findFirstOrThrow({ where: { businessId: business.id, kind: "CASH", isActive: true } });
    const CLERK: FinanceActor = { type: "ADMIN", adminId: OWNER.type === "ADMIN" ? OWNER.adminId : "", label: "clerk@test", permissions: PERMISSIONS.filter((x) => x !== "finance.post" && x !== "purchasing.approve") };
    const pending = await paySupplier({ supplierId, fromFinancialAccountId: cash.id, amount: 25, allocations: [] }, CLERK, "alert-pending");
    expect(pending.payment.status).toBe("PENDING_APPROVAL");
    expect((await financeAlerts()).alerts.find((a) => a.key === "treasury.approvals")).toMatchObject({ severity: "warning", count: approvalsBefore + 1, href: "/admin/finance/accounts" });
    await rejectMovement(pending.payment.id, "Raised by mistake", OWNER);
    expect((await financeAlerts()).alerts.find((a) => a.key === "treasury.approvals")?.count ?? 0).toBe(approvalsBefore);

    // money figures agree with the cash forecast
    const f = await cashForecast({ weeks: 13 });
    const overdueBills = f.lines.filter((l) => l.source === "SUPPLIER_BILL" && l.date < f.asOf);
    const alert = (await financeAlerts()).alerts.find((a) => a.key === "payables.overdue");
    expect(alert?.count ?? 0).toBe(overdueBills.length);
    if (alert) expect(alert.amount).toBe(Math.round(-overdueBills.reduce((t, l) => t + l.amount, 0) * 100) / 100);
  });

  it("the month-end checklist reflects the books; closing the month clears its alert; reopening restores it", async () => {
    await postPending();
    await runReconciliation({}, OWNER);
    const c = await monthEndChecklist({ month: "2026-09" });
    expect(c).toMatchObject({ month: "2026-09", from: "2026-09-01", to: "2026-09-30", ended: true, period: { status: "OPEN" } });
    expect(c.steps.map((x) => x.key)).toEqual(["events", "approvals", "expenses", "payroll", "bills", "bank", "depreciation", "interest", "exceptions", "checks"]);
    const step = (k: string) => c.steps.find((x) => x.key === k)!;
    expect(step("events").status).toBe("DONE");
    expect(step("depreciation").status).toBe("DONE"); // September was run
    expect(step("interest").status).toBe("DONE"); // and accrued
    const latest = await prisma.$queryRaw<Array<{ status: string }>>`SELECT DISTINCT ON ("checkKey") "status"::text AS status FROM "ReconciliationRun" ORDER BY "checkKey", "createdAt" DESC`;
    expect(step("checks").status).toBe(latest.some((r) => r.status === "DIFFERENCE" || r.status === "ERROR") ? "TODO" : "DONE");
    const unpaidSep = (await listCommitments({ from: "2026-09-01", to: "2026-09-30" })).commitments.flatMap((x) => x.schedule).filter((x) => x.periodKey === "2026-09" && (x.status === "OVERDUE" || x.status === "DUE"));
    expect(step("expenses").status).toBe(unpaidSep.length ? "TODO" : "DONE");
    expect(c.open).toBe(c.steps.filter((x) => x.status === "TODO").length);
    expect(c.ready).toBe(c.open === 0);
    for (const x of c.steps) expect(x.href).toMatch(/^\/admin\//);
    expect((await monthEndChecklist({ month: "2026-10" })).ended).toBe(false);

    const openMonths = async () => (await financeAlerts()).alerts.find((a) => a.key === "periods.open")?.count ?? 0;
    const before = await openMonths();
    expect(before).toBeGreaterThan(0);
    await changePeriodStatus(c.period!.id, "close", "September books reviewed", OWNER);
    expect((await monthEndChecklist({ month: "2026-09" })).period).toMatchObject({ status: "CLOSED" });
    expect(await openMonths()).toBe(before - 1);
    await changePeriodStatus(c.period!.id, "reopen", "Test complete", OWNER);
    expect(await openMonths()).toBe(before);
  });
});

describe("payroll (E8) — a configurable structure, posted as one journal, paid through treasury", () => {
  it("prorates fixed amounts by days and takes percentages of the (prorated) basic, half-even", () => {
    const comp = (id: string, kind: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION", calculation: "FIXED" | "PERCENT_OF_BASIC", isBasic = false, ratePct: number | null = null) => ({ id, name: id, kind, calculation, isBasic, ratePct, isActive: true });
    const items = [
      { amount: 3_000_000, ratePct: null, component: comp("basic", "EARNING", "FIXED", true) },
      { amount: null, ratePct: null, component: comp("rent", "EARNING", "PERCENT_OF_BASIC", false, 50) },
      { amount: null, ratePct: 12.5, component: comp("pf", "DEDUCTION", "PERCENT_OF_BASIC", false, 10) },
    ];
    expect(standardLines(items, 30, 30).map((l) => [l.componentId, l.amount])).toEqual([["basic", 3_000_000], ["rent", 1_500_000], ["pf", 375_000]]);
    expect(standardLines(items, 15, 30).map((l) => [l.componentId, l.amount])).toEqual([["basic", 1_500_000], ["rent", 750_000], ["pf", 187_500]]);
    expect(standardLines(items, 0, 31)).toEqual([]);
  });

  it("drafts, edits, posts, pays, remits and reverses; salaries payable always equals the unpaid payslips", async () => {
    const { business } = await getFinanceContext();
    const basic = await createComponent({ name: "Basic salary", kind: "EARNING", isBasic: true }, OWNER);
    const rent = await createComponent({ name: "House rent", kind: "EARNING", calculation: "PERCENT_OF_BASIC", ratePct: 50 }, OWNER);
    const tax = await createComponent({ name: "Income tax withheld", kind: "DEDUCTION" }, OWNER);
    const pf = await createComponent({ name: "Provident fund (employee)", kind: "DEDUCTION", calculation: "PERCENT_OF_BASIC", ratePct: 10 }, OWNER);
    const pfEr = await createComponent({ name: "Provident fund (employer)", kind: "EMPLOYER_CONTRIBUTION", calculation: "PERCENT_OF_BASIC", ratePct: 10 }, OWNER);
    const bonus = await createComponent({ name: "Festival bonus", kind: "EARNING" }, OWNER);
    expect(basic.expenseAccount?.code).toBe("6200");
    expect(tax.liabilityAccount?.code).toBe("2420");
    expect(pfEr).toMatchObject({ expenseAccount: { code: "6210" }, liabilityAccount: { code: "2420" } });
    await expect(createComponent({ name: "Overtime", kind: "EARNING", calculation: "PERCENT_OF_BASIC" }, OWNER)).rejects.toMatchObject({ statusCode: 400 });
    await expect(createComponent({ name: "Second basic", kind: "EARNING", isBasic: true }, OWNER)).rejects.toMatchObject({ statusCode: 409 });

    const a = await createEmployee({ name: "Rahima Akter", designation: "Tailor", joinDate: "2026-01-01", payItems: [{ componentId: basic.id, amount: 20_000 }, { componentId: rent.id }, { componentId: tax.id, amount: 500 }, { componentId: pf.id }, { componentId: pfEr.id }] }, OWNER);
    const b = await createEmployee({ name: "Karim Uddin", designation: "Store manager", joinDate: "2026-09-16", payItems: [{ componentId: basic.id, amount: 30_000 }, { componentId: rent.id }, { componentId: pf.id }, { componentId: pfEr.id }] }, OWNER);
    expect(a).toMatchObject({ number: "EMP-001", standard: { gross: 30_000, deductions: 2_500, net: 27_500, employerCost: 2_000 } });
    await expect(createEmployee({ name: "No amount", joinDate: "2026-01-01", payItems: [{ componentId: basic.id }] }, OWNER)).rejects.toMatchObject({ statusCode: 400 });

    // payroll starts when the owner adopts it: with no run yet, the next month to run is last month, not every month back to
    // the opening of the books (Rahima joined in January)
    const lastMonth = (() => { const t = businessToday(business); const i = Number(t.slice(0, 4)) * 12 + Number(t.slice(5, 7)) - 2; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; })();
    expect((await payrollOverview()).nextRunMonth).toBe(lastMonth);

    // September: Rahima a full month; Karim joined on the 16th — 15 of 30 days
    let run = await createPayRun({ periodKey: "2026-09" }, OWNER);
    expect(run).toMatchObject({ number: "PR-001", status: "DRAFT", payDate: "2026-09-30", gross: 52_500, deductions: 4_000, net: 48_500, employerCost: 3_500 });
    const slipB = run.payslips.find((x) => x.employee.id === b.id)!;
    expect(slipB).toMatchObject({ daysPayable: 15, daysInPeriod: 30, gross: 22_500, deductions: 1_500, net: 21_000, employerCost: 1_500 });
    await expect(createPayRun({ periodKey: "2026-09" }, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await expect(createPayRun({ periodKey: "2099-01" }, OWNER)).rejects.toMatchObject({ statusCode: 409 }); // a month that hasn't started

    // a one-off festival bonus on Rahima's payslip; deductions above earnings are refused
    const slipA = run.payslips.find((x) => x.employee.id === a.id)!;
    const linesA = slipA.lines.map((l) => ({ componentId: l.componentId, amount: l.amount }));
    run = await updatePayslip(run.id, slipA.id, { lines: [...linesA, { componentId: bonus.id, amount: 5_000 }] }, OWNER);
    expect(run).toMatchObject({ gross: 57_500, net: 53_500 });
    await expect(updatePayslip(run.id, slipA.id, { lines: [{ componentId: tax.id, amount: 99_999 }] }, OWNER)).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateComponent(bonus.id, { kind: "DEDUCTION" }, OWNER)).rejects.toMatchObject({ statusCode: 409 }); // on a payslip

    // posting: ONE journal at the month end
    run = await postPayRun(run.id, OWNER);
    expect(run.status).toBe("POSTED");
    const lines = await prisma.journalLine.findMany({ where: { entryId: run.journalEntryId! }, include: { account: { select: { code: true } } } });
    const net = (code: string) => lines.filter((l) => l.account.code === code).reduce((t, l) => t + Number(l.debit) - Number(l.credit), 0);
    expect([net("6200"), net("6210"), net("2420"), net("2410")]).toEqual([57_500, 3_500, -7_500, -53_500]);
    expect(lines.filter((l) => l.account.code === "2410").map((l) => l.partyType)).toEqual(["Employee", "Employee"]);
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: run.journalEntryId! } })).entryDate.toISOString().slice(0, 10)).toBe("2026-09-30");
    await expect(prisma.payslip.update({ where: { id: slipA.id }, data: { daysPayable: 1 } })).rejects.toThrow(/FINANCE_INVARIANT/);
    const sub = async () => (await runReconciliation({ checks: ["payroll.subledger"] }, OWNER)).results[0]!;
    expect(await sub()).toMatchObject({ status: "MATCHED", expected: 53_500 });

    // pay Rahima, then a replay; a paid run can't be reversed; then pay the rest
    const cash = await prisma.financialAccount.findUniqueOrThrow({ where: { id: (await createFinancialAccount({ kind: "BANK", name: `Payroll bank ${Date.now() % 100000}` } as never, OWNER)).id } }); // a bank may run an overdraft; a cash box may not
    const paidA = await payPayslips(run.id, { payslipIds: [slipA.id], fromFinancialAccountId: cash.id, paymentDate: "2026-10-01" }, OWNER, "salary-sep-a");
    expect(paidA.run.payslips.find((x) => x.id === slipA.id)!.payment.status).toBe("PAID");
    expect((await payPayslips(run.id, { payslipIds: [slipA.id], fromFinancialAccountId: cash.id }, OWNER, "salary-sep-a")).replayed).toBe(true);
    await expect(payPayslips(run.id, { payslipIds: [slipA.id], fromFinancialAccountId: cash.id }, OWNER, "salary-sep-a2")).rejects.toMatchObject({ statusCode: 409 });
    await expect(reversePayRun(run.id, "Wrong month", OWNER)).rejects.toMatchObject({ statusCode: 409 });
    expect(await sub()).toMatchObject({ status: "MATCHED", expected: 21_000 });
    const rest = await payPayslips(run.id, { fromFinancialAccountId: cash.id, paymentDate: "2026-10-02" }, OWNER, "salary-sep-rest");
    expect(rest.run.unpaid).toEqual({ count: 0, amount: 0 });
    expect(await sub()).toMatchObject({ status: "MATCHED", expected: 0 });

    // deductions and contributions withheld (2420: 7,500) are remitted — never more than is owed
    const l2420 = await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: business.id, code: "2420" } });
    await expect(remitDeductions({ liabilityAccountId: l2420.id, amount: 8_000, fromFinancialAccountId: cash.id }, OWNER, "remit-1")).rejects.toMatchObject({ statusCode: 409 });
    const cashGl = await prisma.ledgerAccount.findFirstOrThrow({ where: { id: cash.ledgerAccountId } });
    await expect(remitDeductions({ liabilityAccountId: cashGl.id, amount: 1, fromFinancialAccountId: cash.id }, OWNER, "remit-x")).rejects.toMatchObject({ statusCode: 400 });
    await remitDeductions({ liabilityAccountId: l2420.id, amount: 7_500, fromFinancialAccountId: cash.id, periodKey: "2026-09", paymentDate: "2026-10-05" }, OWNER, "remit-1");
    const overview = await payrollOverview();
    expect(overview.withheld.find((w) => w.account.code === "2420")!.owed).toBe(0);
    expect(overview.remittances[0]).toMatchObject({ amount: 7_500, periodKey: "2026-09", status: "POSTED" });

    // October: drafted, posted, reversed while unpaid; a fresh draft is then possible (and deleted)
    const oct = await postPayRun((await createPayRun({ periodKey: "2026-10", payDate: "2026-10-31" }, OWNER)).id, OWNER);
    expect(oct.net).toBe(27_500 + 42_000);
    const f = await cashForecast({ weeks: 13 });
    expect(f.lines.filter((l) => l.source === "PAYROLL" && l.label.startsWith("Salaries 2026-10"))).toEqual([expect.objectContaining({ amount: -69_500, date: "2026-10-31" })]);
    expect(f.lines.filter((l) => l.source === "PAYROLL" && l.label.endsWith("(estimate)")).every((l) => l.amount === -69_500)).toBe(true);
    const reversed = await reversePayRun(oct.id, "Posted early", OWNER);
    expect(reversed.status).toBe("REVERSED");
    const redo = await createPayRun({ periodKey: "2026-10" }, OWNER);
    const unpaidStaff = await createEmployee({ name: "No pay yet", joinDate: "2026-01-01" }, OWNER);
    const leaver = await createEmployee({ name: "Left in August", joinDate: "2026-01-01", leaveDate: "2026-08-31", payItems: [{ componentId: basic.id, amount: 10_000 }] }, OWNER);
    await expect(setPayslipPresence(redo.id, unpaidStaff.id, true, OWNER)).rejects.toMatchObject({ statusCode: 409 }); // no pay structure
    await expect(setPayslipPresence(redo.id, leaver.id, true, OWNER)).rejects.toMatchObject({ statusCode: 409 }); // not employed in October
    await deleteDraftPayRun(redo.id, OWNER);
    expect(await sub()).toMatchObject({ status: "MATCHED", expected: 0 });
    expect((await monthEndChecklist({ month: "2026-09" })).steps.find((x) => x.key === "payroll")).toMatchObject({ status: "DONE" });
    expect((await monthEndChecklist({ month: "2026-08" })).steps.find((x) => x.key === "payroll")).toMatchObject({ status: "NOT_APPLICABLE" }); // before payroll started
    allMatched(await checks());
  });
});

describe("partners & equity, foundation (E11) — balances come from the ledger; the summary is the balance sheet's", () => {
  it("creates each partner's capital and current accounts, reads their balances, and agrees with the balance sheet", async () => {
    const { business } = await getFinanceContext();
    const asif = await createPartner({ name: "Asif Rahman", joinedOn: "2026-01-01", agreedSharePct: 60 }, OWNER);
    const nadia = await createPartner({ name: "Nadia Islam", joinedOn: "2026-03-01", agreedSharePct: 40, agreementReference: "Draft v2 (unsigned)" }, OWNER);
    expect(asif).toMatchObject({ number: "PT-01", shareConfirmed: false, capitalAccount: { code: "3101", name: "Partner capital — Asif Rahman" }, currentAccount: { code: "3201" } });
    expect(nadia).toMatchObject({ number: "PT-02", capitalAccount: { code: "3102" }, currentAccount: { code: "3202" } });
    const accounts = await prisma.ledgerAccount.findMany({ where: { id: { in: [asif.capitalAccount.id, asif.currentAccount.id] } }, include: { parent: { select: { code: true } } } });
    expect(accounts.every((a) => a.type === "EQUITY" && a.isSensitive && a.isSystem && a.isPostable && a.parent?.code === "3000")).toBe(true);
    await expect(createPartner({ name: "asif rahman", joinedOn: "2026-01-01" }, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await expect(createPartner({ name: "Late", joinedOn: "2026-05-01", leftOn: "2026-04-01" }, OWNER)).rejects.toMatchObject({ statusCode: 400 });

    // money a partner puts in / takes out is an ordinary money movement against their accounts
    const bank = (await createFinancialAccount({ kind: "BANK", name: `Equity bank ${Date.now() % 100000}` } as never, OWNER)).id;
    await requestMovement({ kind: "DEPOSIT", movementDate: "2026-10-01", amount: 100_000, toFinancialAccountId: bank, counterAccountId: asif.capitalAccount.id, description: "Capital — Asif" }, OWNER, "equity-asif-in");
    await requestMovement({ kind: "DEPOSIT", movementDate: "2026-10-01", amount: 50_000, toFinancialAccountId: bank, counterAccountId: nadia.capitalAccount.id, description: "Capital — Nadia" }, OWNER, "equity-nadia-in");
    await requestMovement({ kind: "WITHDRAWAL", movementDate: "2026-10-05", amount: 8_000, fromFinancialAccountId: bank, counterAccountId: asif.currentAccount.id, description: "Drawing — Asif" }, OWNER, "equity-asif-out");

    const today = businessToday(business);
    const e = await equityOverview({ asOf: today });
    expect(e.partners.map((p) => [p.number, p.balances.capital, p.balances.current, p.balances.total])).toEqual([["PT-01", 100_000, -8_000, 92_000], ["PT-02", 50_000, 0, 50_000]]);
    expect(e.totals).toMatchObject({ capital: 150_000, current: -8_000, total: 142_000, agreedSharesPct: 100 });
    const bs = await balanceSheet({ asOf: today });
    expect(e.equity.total).toBe(bs.sections.find((x) => x.key === "equity")!.total);
    const line = (id: string) => e.equity.lines.find((l) => l.accountId === id)?.amount;
    expect([line(asif.capitalAccount.id), line(asif.currentAccount.id)]).toEqual([100_000, -8_000]);

    // a rename renames both accounts; a partner keeps their accounts and is never deleted
    const renamed = await updatePartner(nadia.id, { name: "Nadia Islam Chowdhury" }, OWNER);
    expect(renamed.currentAccount.name).toBe("Partner current — Nadia Islam Chowdhury");
    await expect(prisma.partner.delete({ where: { id: nadia.id } })).rejects.toThrow(/FINANCE_INVARIANT/);
    allMatched(await checks());
  });
});
