import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables } from "../../test-fixtures";
import { updateOrderStatus } from "../../modules/orders/order.service";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { ensurePurchasingAccounting } from "./purchasing-setup.service";
import { getBusinessSettings, updateBusinessSettings } from "./chart.service";
import { getOpeningBalances, postOpeningBalances, prefillOpeningInventory, saveOpeningLines } from "./opening-balances.service";
import { businessToday, getFinanceContext } from "./finance-context";
import { syncCommerce } from "./commerce-accounting.service";
import { carriedIntoOpeningSql } from "./inventory-cutover.service";
import { createSupplier } from "./suppliers.service";
import { payablesAgeing } from "./supplier-invoices.service";
import { paySupplier, supplierAccount } from "./supplier-payments.service";
import { createFinancialAccount } from "./financial-accounts.service";
import { createSettlement, postSettlement } from "./settlements.service";
import { runReconciliation } from "./reconciliation.service";
import type { FinanceActor } from "./finance-audit";

// Starting the books on a live shop (docs/FINANCE_PHASE_1.md §8): the opening date stays open until the opening balances
// are posted; the stock count includes units out on orders not yet delivered; what suppliers were owed is kept per
// supplier; a courier payout for orders delivered before the books started comes out of clearing's opening balance.

let OWNER: FinanceActor;
let admin = "";
let today = "";
let tomorrow = "";
let variantId = "";
let pendingOrder = { id: "", orderNumber: "", total: 0 };
let deliveredOrder = { id: "", orderNumber: "", total: 0 };
let supplierId = "";
let cashId = "";
let codId = "";
let payablesAccountId = "";

async function deliver(orderId: string) {
  for (const status of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const) await updateOrderStatus(orderId, { status }, admin);
}
async function carried(orderId: string, openingDate: string) {
  const { business } = await getFinanceContext();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT o.id FROM "Order" o WHERE o.id = ${orderId} AND ${carriedIntoOpeningSql(business.timezone, openingDate)}`;
  return rows.length === 1;
}
const stockLine = async () => (await getOpeningBalances()).batch!.inventoryItems.find((i) => i.variantId === variantId);

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  const { business } = await getFinanceContext();
  today = businessToday(business);
  tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const p = await createStockedProduct({ stocks: [10], basePrice: 500 });
  variantId = p.variants[0]!.id;
  await prisma.productVariant.update({ where: { id: variantId }, data: { costPrice: 100 } });
  const pending = await placeOrder([{ variantId, quantity: 3 }]); // COD, never delivered: 3 units out, still ours
  pendingOrder = { id: pending.id, orderNumber: pending.orderNumber, total: Number(pending.total) };
  const delivered = await placeOrder([{ variantId, quantity: 1 }]); // COD, delivered today: sold before a book that starts tomorrow
  await deliver(delivered.id);
  deliveredOrder = { id: delivered.id, orderNumber: delivered.orderNumber, total: Number(delivered.total) };
  supplierId = (await createSupplier({ legalName: "Opening Fabrics Ltd", paymentTermsDays: 30 } as never, OWNER)).id;
  cashId = (await createFinancialAccount({ kind: "CASH", name: `Opening cash ${Date.now() % 100000}` } as never, OWNER)).id;
  codId = (await prisma.financialAccount.findFirstOrThrow({ where: { businessId: business.id, kind: "COURIER" } })).id;
  payablesAccountId = (await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key: "liability.payable_trade" } } })).accountId;
}, 60_000);

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("the opening date", () => {
  it("stays editable, and nothing is projected, until the opening balances are posted", async () => {
    await updateBusinessSettings({ openingDate: today, reason: "first try" }, OWNER);
    expect((await syncCommerce()).skipped).toBe("OPENING_BALANCES_NOT_POSTED");
    expect(await prisma.journalEntry.count()).toBe(0);
    expect((await getBusinessSettings()).openingDateLocked).toBe(false);
  });
});

describe("the opening stock count", () => {
  it("rolls today's stock back to the start of the opening date", async () => {
    // The 10 units were received today and both orders placed today: at the start of today there was nothing to count.
    await prefillOpeningInventory(OWNER);
    expect(await stockLine()).toBeUndefined();
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(v.stock).toBe(6);
  });

  it("counts units out on orders not yet sold on the opening date, and the in-transit bridge carries the same orders", async () => {
    await updateBusinessSettings({ openingDate: tomorrow, reason: "start tomorrow" }, OWNER);
    expect(await carried(pendingOrder.id, tomorrow)).toBe(true); // placed before, not delivered
    expect(await carried(deliveredOrder.id, tomorrow)).toBe(false); // delivered (sold) before the books start
    expect(await carried(pendingOrder.id, today)).toBe(false); // placed on the opening date: in transit the ordinary way
    await prefillOpeningInventory(OWNER);
    const line = await stockLine();
    expect(line).toMatchObject({ quantity: 9, valuationStatus: "ESTIMATED", unitCost: 100 }); // 6 on the shelf + 3 on the undelivered order
    expect(line!.notes).toBe(`includes 3 units on an order not yet delivered or paid on ${tomorrow}`);
  });
});

describe("what suppliers were owed", () => {
  it("names the supplier on the trade-payables account", async () => {
    const owed = { category: "PAYABLE" as const, accountId: payablesAccountId, side: "CREDIT" as const, amount: 3000, description: "Owed to Opening Fabrics" };
    await expect(saveOpeningLines({ lines: [owed] }, OWNER)).rejects.toMatchObject({ details: { code: "OPENING_SUPPLIER_REQUIRED" } });
    await expect(saveOpeningLines({ lines: [{ ...owed, partyType: "Supplier", partyId: "not-a-supplier" }] }, OWNER)).rejects.toMatchObject({ details: { code: "SUPPLIER_NOT_FOUND" } });
    const saved = await saveOpeningLines({
      lines: [
        { category: "CASH", financialAccountId: cashId, side: "DEBIT", amount: 5000 },
        { category: "PAYMENT_ACCOUNT", financialAccountId: codId, side: "DEBIT", amount: deliveredOrder.total, description: "COD the courier still held" },
        { ...owed, partyType: "Supplier", partyId: supplierId },
      ],
    }, OWNER);
    expect(saved.lines).toHaveLength(3);
  });

  it("posts, and the payables subledger, the supplier's account and the ageing all see the opening due", async () => {
    const { batch } = await postOpeningBalances(OWNER);
    expect(batch.status).toBe("POSTED");
    expect((await getBusinessSettings()).openingDateLocked).toBe(true);
    let checks = await runReconciliation({ checks: ["payables.subledger"] }, OWNER);
    expect(checks.results[0]).toMatchObject({ status: "MATCHED" });

    let account = await supplierAccount(supplierId);
    expect(account.openingDue).toEqual({ date: tomorrow, amount: 3000, paid: 0, outstanding: 3000 });
    expect(account.balance).toBe(3000);

    // A payment not set against a bill settles the opening due first; only the rest is an advance.
    await paySupplier({ supplierId, fromFinancialAccountId: cashId, movementDate: tomorrow, amount: 3500, allocations: [] }, OWNER, `opening-pay-${Date.now()}`);
    account = await supplierAccount(supplierId);
    expect(account.openingDue).toEqual({ date: tomorrow, amount: 3000, paid: 3000, outstanding: 0 });
    expect(account.advances.map((a) => a.unallocated)).toEqual([500]);
    expect(account.balance).toBe(-500);
    const row = (await payablesAgeing()).suppliers.find((s) => s.supplier.id === supplierId)!;
    expect(row).toMatchObject({ current: 0, advances: 500, balance: -500 });
    checks = await runReconciliation({ checks: ["payables.subledger"] }, OWNER);
    expect(checks.results[0]).toMatchObject({ status: "MATCHED" });
  });
});

describe("a courier payout for orders delivered before the books started", () => {
  it("comes out of clearing's opening balance instead of over-settling the order", async () => {
    const bank = (await createFinancialAccount({ kind: "BANK", name: `Opening bank ${Date.now() % 100000}` } as never, OWNER)).id;
    const created = await createSettlement({
      clearingFinancialAccountId: codId, destinationFinancialAccountId: bank, settlementDate: tomorrow, reference: `OPEN-STF-${Date.now()}`,
      evidence: "Steadfast payout", lines: [{ orderNumber: deliveredOrder.orderNumber, amount: deliveredOrder.total, fee: 0, adjustment: 0 }],
    } as never, OWNER, `opening-set-${Date.now()}`);
    expect(created.settlement.unmatchedLines).toBe(0);
    const posted = await postSettlement(created.settlement.id, OWNER);
    const credit = await prisma.journalLine.findFirstOrThrow({ where: { entryId: posted.settlement.journalEntryId!, credit: { gt: 0 } } });
    expect(credit.partyId).toBeNull();
    expect(credit.memo).toContain("paid in before the books started");
    const r = await runReconciliation({ checks: ["clearing.positions"] }, OWNER);
    expect(r.results[0]).toMatchObject({ status: "MATCHED" });
  });
});
