import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { approvePurchaseOrder, createPurchaseOrder, submitPurchaseOrder } from "../finance/purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt } from "../finance/goods-receipts.service";
import { createSupplier } from "../finance/suppliers.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";
import { fillCapacityChanged } from "./fill-capacity.service";
import { recordCounts } from "./count.service";
import { stockToday } from "./stock-today.service";

// Smart stock page, task 4: Today lists the bottles to fill (and a material that can't cover them), and count losses
// waiting for the owner. Other rows in the test database may add lines of their own, so each check looks for this run's.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
let staffAdmin = "";
let supplierId = "";
let oil = "";
let dryOil = "";
let bottle = "";
let attar = "";
let dry = "";
let cap = "";

async function buy(variantId: string, qty: number, unitPrice: number) {
  const po = await createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId, qtyOrdered: qty, unitPrice }] } as never, OWNER);
  await submitPurchaseOrder(po.id, OWNER);
  const approved = await approvePurchaseOrder(po.id, OWNER);
  const grn = await createGoodsReceipt({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: approved.lines[0]!.id, qtyAccepted: qty }] } as never, OWNER);
  await postGoodsReceipt(grn.id, {}, OWNER);
}
const material = async (name: string, unit: string) =>
  (await createMaterial({ name: `Vitest ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `TOD-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
async function makeAttar(oilId: string) {
  const p = await createStockedProduct({ stocks: [0], basePrice: 350 });
  await prisma.product.update({ where: { id: p.product.id }, data: { fillToOrder: true } });
  const bom = await createBom({ productId: p.product.id, lines: [{ materialVariantId: oilId, qtyPerUnit: "6", wastagePct: "0" }, { materialVariantId: bottle, qtyPerUnit: "1", wastagePct: "0" }] } as never, OWNER);
  await approveBom(bom.id, OWNER);
  return { productId: p.product.id, variant: p.variants[0]!.id };
}

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  staffAdmin = (await prisma.adminUser.create({ data: { name: "Vitest today counter", email: `today-staff-${RUN}@example.com`, passwordHash: "x", role: "STAFF" } })).id;
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const c = await createStockedProduct({ stocks: [10], basePrice: 900 });
  cap = c.variants[0]!.id;
  await saveOpeningInventory([{ variantId: cap, sku: c.variants[0]!.sku, name: "cap", quantity: 10, unitCost: 460, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: (await getFinanceContext()).brand.id }] as never, OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  supplierId = (await createSupplier({ legalName: "Vitest Today Attar House" } as never, OWNER)).id;
  oil = await material("Today oil", "ml");
  dryOil = await material("Today dry oil", "ml");
  bottle = await material("Today bottle", "pcs");
  await buy(oil, 60, 38);
  await buy(bottle, 100, 50);
  attar = (await makeAttar(oil)).variant;
  const d = await makeAttar(dryOil);
  dry = d.variant;
  // its oil is not in stock: it can only sell on UNLIMITED, so the bottle it sells can't be filled yet
  await prisma.product.update({ where: { id: d.productId }, data: { stockPolicy: "UNLIMITED" } });
  fillCapacityChanged();
  await placeOrder([{ variantId: attar, quantity: 2 }]);
  await placeOrder([{ variantId: dry, quantity: 1 }]);
  await recordCounts({ lines: [{ variantId: cap, counted: 6, reason: "DAMAGED", note: null }] } as never, { type: "ADMIN", adminId: staffAdmin, label: "staff", permissions: [...ROLE_PERMISSIONS.STAFF] }, `today-count-${RUN}`);
}, 300_000);

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
  await prisma.adminUser.deleteMany({ where: { id: staffAdmin } });
});

describe("Today", () => {
  it("T-1: the bottles owed are listed, with the orders they wait on", async () => {
    const t = await stockToday({ canSeeCost: true });
    expect(t.fill).not.toBeNull();
    expect(t.fill!.lines).toEqual(expect.arrayContaining([expect.objectContaining({ variantId: attar, owed: 2 }), expect.objectContaining({ variantId: dry, owed: 1 })]));
    expect(t.fill!.bottles).toBeGreaterThanOrEqual(3);
    expect(t.fill!.orders).toBeGreaterThanOrEqual(2);
  });

  it("T-2: a material that can't cover the owed bottles is named; one that can isn't", async () => {
    const t = await stockToday({ canSeeCost: true });
    expect(t.fill!.short).toEqual(expect.arrayContaining([expect.objectContaining({ variantId: dryOil, need: 6, have: 0 })]));
    expect(t.fill!.short.find((s) => s.variantId === oil || s.variantId === bottle)).toBeUndefined();
  });

  it("T-3: a staff count loss over the limit waits on Today", async () => {
    const t = await stockToday({ canSeeCost: true });
    expect(t.approvals).toEqual(expect.arrayContaining([expect.objectContaining({ variantId: cap, difference: -4, value: 1840 })]));
    const blind = await stockToday({ canSeeCost: false });
    expect(blind.approvals.find((a) => a.variantId === cap)!.value).toBeNull();
  });

  it("T-4: GET /stock/today answers for staff", async () => {
    const res = await request(app).get("/api/v1/finance/stock/today").set("Cookie", [`access_token=${signAccessToken({ adminId: staffAdmin, role: "STAFF" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["approvals", "count", "fill", "fillProblems", "reorder", "today"]);
  });
});
