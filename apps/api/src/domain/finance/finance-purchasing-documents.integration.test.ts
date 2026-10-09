import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables } from "../../test-fixtures";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { ensurePurchasingAccounting, updatePurchasingSettings } from "./purchasing-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { getFinanceContext } from "./finance-context";
import { processFinancialEvent } from "./events.service";
import { runReconciliation } from "./reconciliation.service";
import { createSupplier, setSupplierStatus } from "./suppliers.service";
import { createTaxCode } from "./tax-codes.service";
import { approveCutover, draftCutover, postCutover } from "./inventory-cutover.service";
import { approvePurchaseOrder, cancelPurchaseOrder, closePurchaseOrder, createPurchaseOrder, submitPurchaseOrder, updatePurchaseOrder } from "./purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt, reverseGoodsReceipt } from "./goods-receipts.service";
import { approvePurchaseReturn, createPurchaseReturn, shipPurchaseReturn } from "./purchase-returns.service";
import type { FinanceActor } from "./finance-audit";

// Financial Core Phase 4D (docs/FINANCE_PHASE_4D.md): purchase orders, goods receipts and supplier returns against the real
// database, after a real valuation cutover — so every check proves the books against the valuation:
//   inventory account = valuation (+ in-transit), GRNI = receipts − returns, one valuation entry per movement.

let OWNER: FinanceActor;
let OTHER_OWNER: FinanceActor;
let STAFF: FinanceActor;
const v: Record<string, string> = {};
let supplierId = "";
let taxId = "";
let expenseAccountId = "";

async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
const stock = async (name: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id: v[name]! } })).stock;
const position = async (name: string) => prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: v[name]! } });
async function checks(keys: string[]) {
  await postPending();
  const r = await runReconciliation({ checks: keys }, OWNER);
  return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
}
const ALL_CHECKS = ["purchasing.grni", "inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity", "events.unposted"];
const matched = (r: Record<string, string>) => expect(r).toEqual(Object.fromEntries(Object.keys(r).map((k) => [k, "MATCHED"])));

beforeAll(async () => {
  await purgeFinanceTables();
  const owner = await ownerId();
  OWNER = { type: "ADMIN", adminId: owner, label: "owner@test", permissions: [...PERMISSIONS] };
  const other = await prisma.adminUser.findFirst({ where: { role: "OWNER", isActive: true, id: { not: owner } } });
  OTHER_OWNER = { type: "ADMIN", adminId: other?.id ?? "second-owner", label: "owner2@test", permissions: [...PERMISSIONS] };
  STAFF = { type: "ADMIN", adminId: owner, label: "staff@test", permissions: PERMISSIONS.filter((p) => p !== "purchasing.approve") };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-01-01", reason: "books start" }, OWNER);
  for (const [name, qty] of [["A", 10], ["B", 0], ["C", 5]] as const) {
    const p = await createStockedProduct({ stocks: [qty], basePrice: 1000 });
    v[name] = p.variants[0]!.id;
  }
  const u = await createStockedProduct({ stocks: [0], basePrice: 1000 });
  await prisma.product.update({ where: { id: u.product.id }, data: { trackInventory: false } });
  v.U = u.variants[0]!.id;
  await saveOpeningInventory([
    { variantId: v.A, sku: "PD-A", name: "A", quantity: 10, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV-1", valuationDate: "2026-01-01", brandId: ctx.brand.id },
    { variantId: v.C, sku: "PD-C", name: "C", quantity: 5, unitCost: 40, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV-2", valuationDate: "2026-01-01", brandId: ctx.brand.id },
  ], OWNER);
  await postOpeningBalances(OWNER);
  supplierId = (await createSupplier({ legalName: "Dhaka Caps Ltd", paymentTermsDays: 30 } as never, OWNER)).id;
  taxId = (await createTaxCode({ code: `VAT15-${Date.now() % 100000}`, name: "VAT 15% (40% recoverable)", rate: "15", recoverablePct: "40" } as never, OWNER)).id;
  expenseAccountId = (await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: ctx.business.id, type: "EXPENSE", isPostable: true, isActive: true } })).id;
}, 60_000);

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`UPDATE "OrderItem" SET "costMovementId" = NULL WHERE "costMovementId" IS NOT NULL`);
  });
  await cleanupFixtures();
});

let poId = "";
let lineA = "";
let lineB = "";

describe("purchase orders", () => {
  it("refuse untracked goods and suppliers on hold; a draft is editable, a submitted order frozen", async () => {
    await expect(createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId: v.U, qtyOrdered: 1, unitPrice: 10 }] } as never, OWNER)).rejects.toMatchObject({ statusCode: 400 });
    await setSupplierStatus(supplierId, { status: "ON_HOLD", reason: "quality review" }, OWNER);
    await expect(createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId: v.A, qtyOrdered: 1, unitPrice: 10 }] } as never, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await setSupplierStatus(supplierId, { status: "ACTIVE", reason: null }, OWNER);

    const po = await createPurchaseOrder({
      supplierId,
      expectedDate: "2026-12-31",
      lines: [
        { lineType: "STOCK", variantId: v.A, qtyOrdered: 20, unitPrice: 120, taxCodeId: taxId },
        { lineType: "STOCK", variantId: v.B, qtyOrdered: 10, unitPrice: 50 },
        { lineType: "NON_STOCK", expenseAccountId, description: "Embroidery setup", qtyOrdered: 1, unitPrice: 500 },
      ],
    } as never, OWNER);
    expect(po).toMatchObject({ status: "DRAFT", total: 20 * 120 + 10 * 50 + 500 });
    expect(po.number).toMatch(/^PO-\d{6}$/);
    poId = po.id;
    const edited = await updatePurchaseOrder(poId, { notes: "rush" } as never, OWNER);
    expect(edited.notes).toBe("rush");
    await submitPurchaseOrder(poId, OWNER);
    await expect(updatePurchaseOrder(poId, { notes: "late edit" } as never, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await expect(prisma.purchaseOrderLine.updateMany({ where: { purchaseOrderId: poId }, data: { qtyOrdered: 99 } })).rejects.toThrow(/frozen/);
    await expect(prisma.purchaseOrderLine.updateMany({ where: { purchaseOrderId: poId }, data: { qtyReceived: 5 } })).rejects.toThrow(/derived/);
  });

  it("approval: needs purchasing.approve; above the threshold the creator can't approve their own order", async () => {
    await expect(approvePurchaseOrder(poId, STAFF)).rejects.toMatchObject({ statusCode: 403 });
    await updatePurchasingSettings({ purchaseApprovalThreshold: 1000 }, OWNER);
    await expect(approvePurchaseOrder(poId, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    const approved = await approvePurchaseOrder(poId, OTHER_OWNER);
    expect(approved.status).toBe("APPROVED");
    lineA = approved.lines.find((l) => l.variantId === v.A)!.id;
    lineB = approved.lines.find((l) => l.variantId === v.B)!.id;
    await updatePurchasingSettings({ purchaseApprovalThreshold: null }, OWNER);
  });
});

let grnId = "";

describe("goods receipts", () => {
  it("can be drafted before the cutover but not posted (stock documents need costing)", async () => {
    const draft = await createGoodsReceipt({ purchaseOrderId: poId, lines: [{ purchaseOrderLineId: lineA, qtyAccepted: 8, qtyRejected: 2 }] } as never, OWNER);
    grnId = draft.id;
    // unit cost = 120 + 15% × (1 − 40%) of 120 = 120 + 10.80 = 130.80
    expect(draft.lines[0]).toMatchObject({ qtyAccepted: 8, qtyRejected: 2, unitCost: 130.8, value: 1046.4 });
    await expect(postGoodsReceipt(grnId, {}, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    // the valuation cutover — every tracked variant enters costing
    await draftCutover({}, OWNER);
    await approveCutover({ acknowledgeMissing: true }, OWNER);
    await postCutover(OWNER);
    matched(await checks(["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation"]));
  });

  it("posts stock and value together, exactly once under concurrency; the order follows", async () => {
    const before = await position("A"); // 10 @ 100
    const [x, y] = await Promise.all([postGoodsReceipt(grnId, {}, OWNER), postGoodsReceipt(grnId, {}, OWNER)]);
    expect([x.replayed, y.replayed].sort()).toEqual([false, true]);
    expect(await stock("A")).toBe(18);
    const after = await position("A");
    expect(after.valuedQty).toBe(before.valuedQty + 8);
    expect(Number(after.value)).toBeCloseTo(1000 + 1046.4, 2); // average (1000 + 1046.40) / 18
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    expect(po.status).toBe("PARTIALLY_RECEIVED");
    expect(po.lines.find((l) => l.id === lineA)!.qtyReceived).toBe(8);
    await postPending();
    const ev = await prisma.financialEvent.findFirstOrThrow({ where: { eventKey: `grn:${grnId}#r0` }, include: { journalEntry: { include: { lines: true } } } });
    expect(ev.status).toBe("POSTED");
    expect(ev.journalEntry!.lines.map((l) => [Number(l.debit), Number(l.credit), l.partyType, l.partyId])).toEqual([[1046.4, 0, "Supplier", supplierId], [0, 1046.4, "Supplier", supplierId]]);
    matched(await checks(ALL_CHECKS));
  });

  it("receiving beyond the order needs an approver and a reason", async () => {
    const over = await createGoodsReceipt({ purchaseOrderId: poId, lines: [{ purchaseOrderLineId: lineA, qtyAccepted: 13 }, { purchaseOrderLineId: lineB, qtyAccepted: 10 }] } as never, OWNER);
    await expect(postGoodsReceipt(over.id, {}, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await expect(postGoodsReceipt(over.id, { overReceiptReason: "supplier sent a full carton" }, STAFF)).rejects.toMatchObject({ statusCode: 409 });
    const posted = await postGoodsReceipt(over.id, { overReceiptReason: "supplier sent a full carton" }, OWNER);
    expect(posted.receipt.overReceiptReason).toBe("supplier sent a full carton");
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe("RECEIVED");
    expect(await stock("B")).toBe(10);
    expect(Number((await position("B")).avgUnitCost)).toBe(50);
    matched(await checks(ALL_CHECKS));
  });

  it("a receipt without an order: refused for untracked goods; posted only by an approver, with a reason", async () => {
    await expect(createGoodsReceipt({ supplierId, directReason: "market purchase", lines: [{ variantId: v.U, qtyAccepted: 1, unitCost: 10 }] } as never, OWNER)).rejects.toMatchObject({ statusCode: 400 });
    const d = await createGoodsReceipt({ supplierId, directReason: "Urgent market purchase", evidence: "cash memo 77", lines: [{ variantId: v.C, qtyAccepted: 5, unitCost: 60 }] } as never, OWNER);
    expect(d.direct).toBe(true);
    await expect(postGoodsReceipt(d.id, {}, STAFF)).rejects.toMatchObject({ statusCode: 403 });
    await postGoodsReceipt(d.id, {}, OWNER);
    expect(Number((await position("C")).value)).toBeCloseTo(5 * 40 + 5 * 60, 2);
    matched(await checks(ALL_CHECKS));
  });

  it("reversal takes the units out at the receipt's cost and reverses its journal; the order goes back", async () => {
    const r = await createGoodsReceipt({ supplierId, directReason: "Sample batch", lines: [{ variantId: v.C, qtyAccepted: 2, unitCost: 90 }] } as never, OWNER);
    await postGoodsReceipt(r.id, {}, OWNER);
    const before = await position("C");
    const rev = await reverseGoodsReceipt(r.id, "entered by mistake", OWNER);
    expect(rev.receipt.status).toBe("REVERSED");
    const after = await position("C");
    expect(after.valuedQty).toBe(before.valuedQty - 2);
    expect(Number(after.value)).toBeCloseTo(Number(before.value) - 180, 2);
    await expect(prisma.goodsReceipt.update({ where: { id: r.id }, data: { notes: "x" } })).rejects.toThrow(/final/);
    matched(await checks(ALL_CHECKS));
  });

  it("closing and cancelling follow the order's state", async () => {
    await expect(cancelPurchaseOrder(poId, "no longer needed", OWNER)).rejects.toMatchObject({ statusCode: 409 }); // goods received
    const closed = await closePurchaseOrder(poId, "complete", OWNER);
    expect(closed.status).toBe("CLOSED");
    const draftOnClosed = createGoodsReceipt({ purchaseOrderId: poId, lines: [{ purchaseOrderLineId: lineB, qtyAccepted: 1 }] } as never, OWNER);
    await expect(draftOnClosed).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("supplier returns", () => {
  it("can't return more than a receipt accepted; ship takes stock out at the average and books Dr GRNI / Cr inventory", async () => {
    const grl = await prisma.goodsReceiptLine.findFirstOrThrow({ where: { goodsReceiptId: grnId } });
    await expect(createPurchaseReturn({ supplierId, reason: "faulty stitching", lines: [{ goodsReceiptLineId: grl.id, quantity: 9 }] } as never, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    const ret = await createPurchaseReturn({ supplierId, reason: "faulty stitching", lines: [{ goodsReceiptLineId: grl.id, quantity: 3 }] } as never, OWNER);
    await expect(shipPurchaseReturn(ret.id, OWNER)).rejects.toMatchObject({ statusCode: 409 }); // not approved
    await approvePurchaseReturn(ret.id, OWNER);
    const before = await position("A");
    const avg = Number(before.avgUnitCost);
    const shipped = await shipPurchaseReturn(ret.id, OWNER);
    expect(shipped.purchaseReturn.status).toBe("SHIPPED");
    expect(shipped.purchaseReturn.total).toBeCloseTo(Math.round(avg * 3 * 100) / 100, 1);
    expect(await stock("A")).toBe(18 + 13 - 3);
    expect((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: lineA } })).qtyReturned).toBe(3);
    expect((await shipPurchaseReturn(ret.id, OWNER)).replayed).toBe(true);
    // a receipt with returned units can't be reversed
    await expect(reverseGoodsReceipt(grnId, "try", OWNER)).rejects.toMatchObject({ statusCode: 409 });
    matched(await checks(ALL_CHECKS));
  });
});
