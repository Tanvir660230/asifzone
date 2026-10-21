import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";
import { impliedMaterialUse, totalOut, unitsOut } from "./stock-check.service";

// Stock check (docs/FINANCE_CENTER.md §7): units through the site = units still out on orders + stock; materials bought at
// least = what the recipes used + stock; a count is recorded beside the stock (never into it, never edited); a roll's yield
// is the parcels booked between opening and finishing it, and only a finished roll has a cost per parcel.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin: string;
const api = () => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}) => auth(request(app).post(`/api/v1/finance${url}`)).send(body),
  };
};
let attar = "";
let oil = "";
let bottle = "";
let bubble = "";
const orders: string[] = [];

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureCommerceAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  oil = (await createMaterial({ name: "Vitest SC oil", stockUnit: "ml", variants: [{ sku: `SC-OIL-${RUN}`, spec: "Oud" }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
  bottle = (await createMaterial({ name: "Vitest SC bottle", stockUnit: "pcs", variants: [{ sku: `SC-BTL-${RUN}`, spec: "6 ml" }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
  bubble = (await createMaterial({ name: "Vitest SC bubble poly", stockUnit: "roll", variants: [{ sku: `SC-BUB-${RUN}`, spec: "roll" }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
  // reported stock, typed in (no document) — what the owner counted
  await prisma.productVariant.update({ where: { id: oil }, data: { stock: 100 } });
  await prisma.productVariant.update({ where: { id: bottle }, data: { stock: 7 } });
  await prisma.productVariant.update({ where: { id: bubble }, data: { stock: 1, costPrice: 2000 } });
  const p = await createStockedProduct({ stocks: [10], basePrice: 599 });
  attar = p.variants[0]!.id;
  const bom = await createBom({ productId: p.product.id, lines: [{ materialVariantId: oil, qtyPerUnit: "6", wastagePct: "0" }, { materialVariantId: bottle, qtyPerUnit: "1", wastagePct: "0" }] } as never, OWNER);
  await approveBom(bom.id, OWNER);

  const a = await placeOrder([{ variantId: attar, quantity: 3 }]); // stays PENDING
  const b = await placeOrder([{ variantId: attar, quantity: 2 }]);
  await prisma.order.update({ where: { id: b.id }, data: { status: "DELIVERED", courierBookedAt: new Date("2020-01-01T08:00:00Z") } });
  await prisma.order.update({ where: { id: a.id }, data: { courierBookedAt: new Date("2020-01-02T08:00:00Z") } });
  const c = await placeOrder([{ variantId: attar, quantity: 1 }]); // cancelled, put back
  await prisma.order.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
  await prisma.orderItem.updateMany({ where: { orderId: c.id }, data: { restockedQuantity: 1 } });
  await prisma.productVariant.update({ where: { id: attar }, data: { stock: { increment: 1 } } });
  orders.push(a.id, b.id, c.id);
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "variantId" IN (SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.kind = 'MATERIAL' AND p.name LIKE 'Vitest SC %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest SC %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest SC %'`);
  });
  await cleanupFixtures();
});

describe("stock check — the rules", () => {
  it("a cancelled unit put back is not out; a returned one not put back still is", () => {
    const b = unitsOut([
      { status: "DELIVERED", quantity: 2, restocked: 0 },
      { status: "CANCELLED", quantity: 3, restocked: 3 },
      { status: "RETURNED", quantity: 1, restocked: 0 },
      { status: "PACKED", quantity: 4, restocked: 0 },
    ]);
    expect(b).toMatchObject({ delivered: 2, cancelled: 0, returned: 1, onTheWay: 4 });
    expect(totalOut(b)).toBe(7);
  });
  it("materials used = recipe × finished units, per material", () => {
    const m = impliedMaterialUse(
      [{ materialVariantId: "oil", finishedVariantIds: ["a6", "a12"], qtyPerUnit: 6 }, { materialVariantId: "oil", finishedVariantIds: ["a12"], qtyPerUnit: 6 }],
      new Map([["a6", 10], ["a12", 5]]),
    );
    expect(m.get("oil")).toEqual({ used: 120, finishedUnits: 20 });
  });
});

describe("stock check — the report", () => {
  it("units through the site, and materials bought at least", async () => {
    const r = await api().get("/center/stock-check");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const f = r.body.finished.find((x: { variantId: string }) => x.variantId === attar);
    expect(f).toMatchObject({ stock: 5, throughSite: 10, cameInOnDocument: 0, typedIn: 10, count: null });
    expect(f.out).toMatchObject({ waiting: 3, delivered: 2, cancelled: 0 });
    const o = r.body.materials.find((x: { variantId: string }) => x.variantId === oil);
    expect(o).toMatchObject({ unit: "ml", stock: 100, usedByRecipes: 60, finishedUnits: 10, boughtAtLeast: 160, boughtBasis: "stock" });
    const btl = r.body.materials.find((x: { variantId: string }) => x.variantId === bottle);
    expect(btl).toMatchObject({ usedByRecipes: 10, boughtAtLeast: 17 });
    expect(r.body.materials.find((x: { variantId: string }) => x.variantId === bubble)).toMatchObject({ usedByRecipes: null, boughtAtLeast: null });
  });

  it("a count sits beside the stock — the stock is unchanged and the count can't be edited", async () => {
    const c = await api().post("/center/stock-counts", { variantId: attar, counted: 4, note: "shelf" });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.difference).toBe(-1);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: attar } })).stock).toBe(5);
    const f = (await api().get("/center/stock-check")).body.finished.find((x: { variantId: string }) => x.variantId === attar);
    expect(f.count).toMatchObject({ counted: 4, siteStockThen: 5, difference: -1 });
    await expect(prisma.stockCount.update({ where: { id: c.body.id }, data: { counted: 5 } })).rejects.toThrow(/never changed/);
    expect((await api().post("/center/stock-counts", { variantId: attar, counted: 1, countDate: "2999-01-01" })).status).toBe(400);
  });

  it("a counted material is bought at least used + counted", async () => {
    expect((await api().post("/center/stock-counts", { variantId: oil, counted: 90 })).status).toBe(201);
    const o = (await api().get("/center/stock-check")).body.materials.find((x: { variantId: string }) => x.variantId === oil);
    expect(o).toMatchObject({ stock: 100, boughtAtLeast: 150, boughtBasis: "count", count: { counted: 90, difference: -10 } });
  });
});

describe("rolls", () => {
  it("an open roll has no cost per parcel; finished, its yield is the parcels booked in between", async () => {
    const o = await api().post("/center/rolls", { materialVariantId: bubble, openedOn: "2020-01-01" });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    let roll = (await api().get("/center/rolls")).body.rolls.find((r: { id: string }) => r.id === o.body.id);
    expect(roll.perParcel).toBeNull();
    expect((await api().post(`/center/rolls/${o.body.id}/finish`, { finishedOn: "2019-12-31" })).status).toBe(400);
    expect((await api().post(`/center/rolls/${o.body.id}/finish`, { finishedOn: "2020-01-02" })).status).toBe(200);
    roll = (await api().get("/center/rolls")).body.rolls.find((r: { id: string }) => r.id === o.body.id);
    expect(roll).toMatchObject({ parcelsBooked: 2, parcels: 2, rollCost: 2000, perParcel: 1000 });
    // the parcels were counted by hand: that wins over the bookings
    await api().post(`/center/rolls/${o.body.id}/finish`, { finishedOn: "2020-01-02", parcelsCounted: 400 });
    roll = (await api().get("/center/rolls")).body.rolls.find((r: { id: string }) => r.id === o.body.id);
    expect(roll).toMatchObject({ parcels: 400, perParcel: 5 });
    expect((await api().post("/center/rolls", { materialVariantId: attar, openedOn: "2020-01-01" })).status).toBe(400);
  });
});
