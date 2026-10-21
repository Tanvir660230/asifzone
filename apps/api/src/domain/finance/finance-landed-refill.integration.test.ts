import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { ensurePurchasingAccounting } from "./purchasing-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "./inventory-cutover.service";
import { approvePurchaseOrder, createPurchaseOrder, submitPurchaseOrder } from "./purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt } from "./goods-receipts.service";
import { createSupplier } from "./suppliers.service";
import { processFinancialEvent } from "./events.service";
import { runReconciliation } from "./reconciliation.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";

// Owner's books §7 (docs/FINANCE_OWNER_BOOKS.md): attar oil bought by the millilitre and bottles by the piece; the van that
// brought the oil is added to the oil's cost (a landed cost); then 10 bottles of 6 ml are refilled in one action — each
// bottle costs 6 ml of oil at its landed cost plus a bottle. After a real valuation cutover, so the books' checks prove it.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin: string;
const api = () => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/v1/finance${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
  };
};
let bank = "";
let oil = "";
let bottle = "";
let attar6 = "";
let oilGrn = "";
const stock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
const avg = async (id: string) => Number((await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: id } })).avgUnitCost);
async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function buy(variantId: string, qty: number, unitPrice: number, supplierId: string) {
  const po = await createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId, qtyOrdered: qty, unitPrice }] } as never, OWNER);
  await submitPurchaseOrder(po.id, OWNER);
  const approved = await approvePurchaseOrder(po.id, OWNER);
  const grn = await createGoodsReceipt({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: approved.lines[0]!.id, qtyAccepted: qty }] } as never, OWNER);
  await postGoodsReceipt(grn.id, {}, OWNER);
  return grn.id;
}

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "LR-SEED", name: "seed", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  const b = await api().post("/financial-accounts", { kind: "BANK", name: `Bank LR ${RUN}`, openingBalance: { amount: 50000, date: "2026-09-01" } });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  bank = b.body.id;
  const supplierId = (await createSupplier({ legalName: "Vitest Attar House" } as never, OWNER)).id;
  oil = (await createMaterial({ name: "Vitest Oud oil", stockUnit: "ml", variants: [{ sku: `OUD-${RUN}`, spec: "Oud" }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
  bottle = (await createMaterial({ name: "Vitest Bottle 6ml", stockUnit: "pcs", variants: [{ sku: `BTL6-${RUN}`, spec: "6 ml roll-on" }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
  oilGrn = await buy(oil, 1000, 3, supplierId);
  await buy(bottle, 100, 10, supplierId);
  const attar = await createStockedProduct({ stocks: [0], basePrice: 350 });
  attar6 = attar.variants[0]!.id;
  const bom = await createBom({ productId: attar.product.id, lines: [{ materialVariantId: oil, qtyPerUnit: "6", wastagePct: "0" }, { materialVariantId: bottle, qtyPerUnit: "1", wastagePct: "0" }] } as never, OWNER);
  await approveBom(bom.id, OWNER);
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`UPDATE "OrderItem" SET "costMovementId" = NULL WHERE "costMovementId" IS NOT NULL`);
    await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "variantId" IN (SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.kind = 'MATERIAL' AND p.name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %'`);
  });
  await cleanupFixtures();
});

describe("landed cost", () => {
  it("the van that brought the oil is added to the oil: 1,000 ml at 3 + 500 transport → 3.50 a ml", async () => {
    expect(await avg(oil)).toBe(3);
    const receipts = (await api().get("/landed-costs/receipts")).body.receipts;
    expect(receipts.map((r: { id: string }) => r.id)).toContain(oilGrn);
    const r = await api().post("/landed-costs", { description: "Van from Chawkbazar", payee: "Karim transport", amount: 500, method: "QUANTITY", goodsReceiptIds: [oilGrn], fromFinancialAccountId: bank }, `lc-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.landedCost).toMatchObject({ number: "LC-000001", amount: 500, paymentStatus: "POSTED" });
    expect(await avg(oil)).toBe(3.5);
    expect((await api().post("/landed-costs", { description: "Van from Chawkbazar", payee: "Karim transport", amount: 500, method: "QUANTITY", goodsReceiptIds: [oilGrn], fromFinancialAccountId: bank }, `lc-${RUN}`)).body.replayed).toBe(true);
    expect(await avg(oil)).toBe(3.5);
  });
});

describe("quick refill", () => {
  let moId = "";
  it("10 bottles of 6 ml in one action: oil and bottles leave stock, finished bottles arrive at 6 × 3.50 + 10 = 31 each", async () => {
    const r = await api().post("/quick-refills", { variantId: attar6, quantity: 10 }, `refill-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    moId = r.body.order.id;
    expect(r.body.order.status).toBe("CLOSED");
    expect(r.body.order.finalCost).toMatchObject({ goods: 310, perAcceptedUnit: 31 });
    expect(await stock(oil)).toBe(940);
    expect(await stock(bottle)).toBe(90);
    expect(await stock(attar6)).toBe(10);
    expect(await avg(attar6)).toBe(31);
  });

  it("the same request again changes nothing; what was really used can differ from the recipe", async () => {
    const again = await api().post("/quick-refills", { variantId: attar6, quantity: 10 }, `refill-${RUN}`);
    expect(again.body).toMatchObject({ replayed: true, order: { id: moId } });
    expect(await stock(attar6)).toBe(10);
    const r = await api().post("/quick-refills", { variantId: attar6, quantity: 5, used: [{ materialVariantId: oil, quantity: 32 }] }, `refill2-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await stock(oil)).toBe(908);
    expect(r.body.order.finalCost.goods).toBe(32 * 3.5 + 5 * 10);
    const list = (await api().get("/quick-refills")).body.refills;
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ quantity: 10, unitCost: 31 });
  });

  it("a product without a recipe says what to do", async () => {
    const other = await createStockedProduct({ stocks: [0], basePrice: 100 });
    const r = await api().post("/quick-refills", { variantId: other.variants[0]!.id, quantity: 1 }, `refill3-${RUN}`);
    expect(r.body.details?.code).toBe("NO_RECIPE");
  });

  it("the books' checks agree after both", async () => {
    await postPending();
    const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "manufacturing.wip", "ledger.integrity", "events.unposted", "purchasing.grni"] }, OWNER);
    expect(Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]))).toEqual({
      "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "manufacturing.wip": "MATCHED",
      "ledger.integrity": "MATCHED", "events.unposted": "MATCHED", "purchasing.grni": "MATCHED",
    });
    const { business } = await getFinanceContext();
    const lc = await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key: "liability.landed_cost_clearing" } } });
    const s = await prisma.journalLine.aggregate({ where: { accountId: lc.accountId, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
    expect(Number(s._sum.debit) - Number(s._sum.credit)).toBe(0);
  });
});

describe("cancelling a landed cost", () => {
  it("puts the money back, takes the value back off the goods and leaves the books as before", async () => {
    const before = await avg(oil);
    const bankBefore = (await api().get(`/financial-accounts/${bank}`)).body.currentBalance;
    const r = await api().post("/landed-costs", { description: "Wrong van bill", amount: 200, method: "QUANTITY", goodsReceiptIds: [oilGrn], fromFinancialAccountId: bank }, `lc2-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await avg(oil)).toBeGreaterThan(before);
    const c = await api().post(`/landed-costs/${r.body.landedCost.id}/cancel`, { reason: "Entered twice" });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.reversedAt).toBeTruthy();
    expect(await avg(oil)).toBe(before);
    expect((await api().get(`/financial-accounts/${bank}`)).body.currentBalance).toBe(bankBefore);
    expect((await api().post(`/landed-costs/${r.body.landedCost.id}/cancel`, { reason: "again" })).status).toBe(200); // once only — a repeat changes nothing
    await expect(prisma.landedCost.update({ where: { id: r.body.landedCost.id }, data: { description: "x" } })).rejects.toThrow(/history/);
    await postPending();
    const checks = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "ledger.integrity", "events.unposted"] }, OWNER);
    expect(checks.results.map((x) => x.status)).toEqual(["MATCHED", "MATCHED", "MATCHED"]);
  });
});
