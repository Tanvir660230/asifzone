import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN } from "../../test-fixtures";
import { recordInitialStock } from "../../modules/inventory/inventory.service";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { openRoll } from "../finance/stock-check.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";

// Stock hub Task 7 (docs/STOCK_HUB.md): one overview — what sells as is, what is filled to order (with what can still be
// made) and the materials, each with its value (costing.read only), use over the last 30 days and days left.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let owner = "";
let staff = "";
const get = (adminId: string, role: "OWNER" | "STAFF") =>
  request(app).get("/api/v1/finance/stock").set("Cookie", [`access_token=${signAccessToken({ adminId, role })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);

type Item = { variantId: string; name: string; unit: string; stock: number; reserved: number; expectedOnShelf: number; makeable: number | null; avgCost: number | null; value: number | null; usedPerDay: number | null; daysLeft: number | null; low: boolean };
type Hub = { totalValue: number | null; costingActive: boolean; lastCount: string | null; groups: Array<{ key: string; items: Item[] }>; rolls: Array<{ materialVariantId: string; openedOn: string }> };
const find = (hub: Hub, key: string, variantId: string) => hub.groups.find((g) => g.key === key)?.items.find((i) => i.variantId === variantId);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

let cap = "";
let oil = "";
let bottle6 = "";
let bottle12 = "";
let attar6 = "";
let attar12 = "";
let roll = "";

beforeAll(async () => {
  await purgeFinanceTables();
  owner = await ownerId();
  OWNER = { type: "ADMIN", adminId: owner, label: "owner@test", permissions: [...PERMISSIONS] };
  const s = await prisma.adminUser.create({ data: { email: `hub-staff-${RUN}@test.local`, name: "Hub staff", passwordHash: "x", role: "STAFF" } });
  staff = s.id;
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const material = async (name: string, unit: string, qty: number) => {
    const id = (await createMaterial({ name: `Vitest Hub ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `HUB-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
    await prisma.$transaction((tx) => recordInitialStock(tx, id, qty, "RESTOCK", { note: "test material" }));
    return id;
  };
  oil = await material("Azhaar oil", "ml", 650);
  bottle6 = await material("Bottle 6ml", "pcs", 166);
  bottle12 = await material("Bottle 12ml", "pcs", 8);
  roll = await material("Bubble poly roll", "pcs", 1);
  cap = (await createStockedProduct({ stocks: [10], basePrice: 900 })).variants[0]!.id;
  const attar = await createStockedProduct({ stocks: [0, 0], basePrice: 350 });
  await prisma.product.update({ where: { id: attar.product.id }, data: { fillToOrder: true } });
  [attar6, attar12] = attar.variants.map((v) => v.id) as [string, string];
  const bom = await createBom({
    productId: attar.product.id,
    lines: [
      { materialVariantId: oil, finishedVariantId: attar6, qtyPerUnit: "6", wastagePct: "0" },
      { materialVariantId: bottle6, finishedVariantId: attar6, qtyPerUnit: "1", wastagePct: "0" },
      { materialVariantId: oil, finishedVariantId: attar12, qtyPerUnit: "12", wastagePct: "0" },
      { materialVariantId: bottle12, finishedVariantId: attar12, qtyPerUnit: "1", wastagePct: "0" },
    ],
  } as never, OWNER);
  await approveBom(bom.id, OWNER);
  const opening = (variantId: string, quantity: number, unitCost: number) => ({ variantId, sku: variantId, name: variantId, quantity, unitCost, valuationStatus: "KNOWN" as const, valuationMethod: "SUPPLIER_INVOICE" as const, valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id });
  await saveOpeningInventory([opening(cap, 10, 100), opening(oil, 650, 38), opening(bottle6, 166, 50), opening(bottle12, 8, 52)], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  await openRoll({ materialVariantId: roll, openedOn: "2026-10-01" }, OWNER);
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "variantId" IN (SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.kind = 'MATERIAL' AND p.name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %'`);
  });
  await cleanupFixtures();
  await prisma.adminUser.deleteMany({ where: { id: staff } });
});

describe("stock hub overview", () => {
  it("groups and values: sells as is, filled to order with what can be made, materials in their unit", async () => {
    await placeOrder([{ variantId: cap, quantity: 2 }]); // waits unpacked: still on the shelf
    const r = await get(owner, "OWNER");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const hub = r.body as Hub;
    expect(hub.costingActive).toBe(true);
    expect(hub.groups.map((g) => g.key)).toEqual(["FINISHED", "FILL_TO_ORDER", "MATERIAL"]);
    expect(find(hub, "FINISHED", cap)).toMatchObject({ unit: "pcs", stock: 8, reserved: 2, expectedOnShelf: 10, makeable: null, avgCost: 100, value: 800 });
    expect(find(hub, "FILL_TO_ORDER", attar6)).toMatchObject({ stock: 0, reserved: 0, makeable: 108, low: false });
    expect(find(hub, "FILL_TO_ORDER", attar12)).toMatchObject({ makeable: 8, low: true }); // 8 bottles of 12 ml left
    expect(find(hub, "MATERIAL", oil)).toMatchObject({ unit: "ml", stock: 650, avgCost: 38, value: 24700, makeable: null });
    expect(find(hub, "FINISHED", oil)).toBeUndefined();
    expect(hub.totalValue).toBeGreaterThanOrEqual(800 + 24700 + 8300 + 416);
    expect(hub.rolls).toEqual(expect.arrayContaining([expect.objectContaining({ materialVariantId: roll, openedOn: "2026-10-01" })]));
  });

  it("days left from the last 30 days: units out (orders net of cancellations, production, packaging) ÷ 30", async () => {
    // test-only history rows (the shelf numbers are not what this checks)
    await prisma.stockMovement.createMany({
      data: [
        { variantId: oil, change: -120, reason: "PRODUCTION_ISSUE", createdAt: daysAgo(5) },
        { variantId: oil, change: -6, reason: "PRODUCTION_ISSUE", createdAt: daysAgo(3) },
        { variantId: oil, change: 6, reason: "PRODUCTION_RETURN", createdAt: daysAgo(3) },
        { variantId: oil, change: -500, reason: "PRODUCTION_ISSUE", createdAt: daysAgo(40) }, // too old
        { variantId: bottle6, change: 50, reason: "PURCHASE_RECEIPT", createdAt: daysAgo(2) }, // in, not use
        { variantId: roll, change: -1, reason: "PACKAGING_USE", createdAt: daysAgo(1) },
      ],
    });
    const hub = (await get(owner, "OWNER")).body as Hub;
    expect(find(hub, "MATERIAL", oil)).toMatchObject({ usedPerDay: 4, daysLeft: 162, low: false }); // 120 / 30; 650 / 4
    expect(find(hub, "MATERIAL", bottle6)).toMatchObject({ usedPerDay: null, daysLeft: null, low: false });
    // the cap: 2 sold in the order above → 2 / 30 a day; 8 left → 120 days
    expect(find(hub, "FINISHED", cap)).toMatchObject({ usedPerDay: 0.07, daysLeft: 120, low: false });
    expect(find(hub, "MATERIAL", roll)).toMatchObject({ daysLeft: 30 }); // 1 left, 1 used in 30 days
  });

  it("quantities only without costing.read", async () => {
    const r = await get(staff, "STAFF");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const hub = r.body as Hub;
    expect(hub.totalValue).toBeNull();
    expect(find(hub, "FINISHED", cap)).toMatchObject({ stock: 8, avgCost: null, value: null });
    expect(find(hub, "MATERIAL", oil)).toMatchObject({ stock: 650, avgCost: null, value: null });
    expect(hub.groups.flatMap((g) => g.items).every((i) => i.value === null && i.avgCost === null)).toBe(true);
  });
});
