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
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { recordStockCount, stockCheck } from "../finance/stock-check.service";
import { listRoutes, routePermission } from "../../test-routes";
import { expectedOnShelf, recordCounts, reservedNotDispatched } from "./count.service";

// Stock hub Task 6 (docs/STOCK_HUB.md §2 "Counted"): expected on the shelf = stock + units on orders not yet booked with
// the courier; a difference is booked at the running average as DAMAGED / LOST (loss) or ADJUSTMENT (found, count fix).

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
const post = (body: object, key?: string) => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const r = request(app).post("/api/v1/finance/stock/counts").set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return (key ? r.set("Idempotency-Key", key) : r).send(body);
};
const stock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
const movements = (variantId: string) => prisma.stockMovement.findMany({ where: { variantId, reason: { in: ["ADJUSTMENT", "DAMAGED", "LOST"] } }, orderBy: { createdAt: "asc" } });

let cap = "";
let shirt = "";
let oil = "";

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  cap = (await createStockedProduct({ stocks: [10], basePrice: 900 })).variants[0]!.id;
  shirt = (await createStockedProduct({ stocks: [5], basePrice: 500 })).variants[0]!.id;
  oil = (await createMaterial({ name: `Vitest Count oil ${RUN}`, stockUnit: "ml", variants: [{ sku: `CNT-OIL-${RUN}`, spec: "Azhaar" }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
  await prisma.$transaction((tx) => recordInitialStock(tx, oil, 650, "RESTOCK", { note: "test material" }));
  await saveOpeningInventory([
    { variantId: cap, sku: "CNT-CAP", name: "cap", quantity: 10, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id },
    { variantId: oil, sku: "CNT-OIL", name: "oil", quantity: 650, unitCost: 38, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id },
  ], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
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
});

describe("Counted", () => {
  it("expected on the shelf is stock plus what waits unpacked", () => {
    expect(expectedOnShelf(3, 2)).toBe(5);
    expect(expectedOnShelf(-2, 2)).toBe(0); // fill to order: two ordered, none filled
  });

  it("count with unpacked orders: stock 3, 2 reserved, 5 counted → no movement, no false loss", async () => {
    await placeOrder([{ variantId: shirt, quantity: 2 }]);
    // an order already booked with the courier has left the shelf: it isn't reserved
    const booked = await placeOrder([{ variantId: shirt, quantity: 1 }]);
    await prisma.order.update({ where: { id: booked.id }, data: { courierConsignmentId: `CNT-${RUN}`, status: "SHIPPED" } });
    expect(await stock(shirt)).toBe(2);
    expect((await reservedNotDispatched(prisma, [shirt])).get(shirt)).toBe(2);
    const r = await post({ lines: [{ variantId: shirt, counted: 4 }] }, `cnt-shirt-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.lines).toEqual([{ variantId: shirt, expected: 4, counted: 4, difference: 0, movementId: null, pendingApprovalId: null }]);
    expect(await stock(shirt)).toBe(2);
    expect(await movements(shirt)).toHaveLength(0);
    expect(await prisma.stockCount.count({ where: { variantId: shirt } })).toBe(1);
  });

  it("loss needs a reason; a gain can't be called damaged; nothing is written", async () => {
    const short = await post({ lines: [{ variantId: cap, counted: 8 }] }, `cnt-noreason-${RUN}`);
    expect(short.status).toBe(400);
    expect(short.body.details?.code).toBe("COUNT_REASON");
    const gain = await post({ lines: [{ variantId: cap, counted: 12, reason: "DAMAGED" }] }, `cnt-gain-${RUN}`);
    expect(gain.status).toBe(400);
    expect(gain.body.details?.code).toBe("COUNT_REASON");
    expect(await stock(cap)).toBe(10);
    expect(await prisma.stockCount.count({ where: { variantId: cap } })).toBe(0);
  });

  it("damaged lowers stock at average cost; the same request again writes nothing", async () => {
    const r = await post({ lines: [{ variantId: cap, counted: 8, reason: "DAMAGED", note: "crushed in the box" }] }, `cnt-cap-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.lines[0]).toMatchObject({ expected: 10, counted: 8, difference: -2, movementId: expect.any(String) });
    expect(await stock(cap)).toBe(8);
    const [m] = await movements(cap);
    expect(m).toMatchObject({ reason: "DAMAGED", change: -2 });
    const state = await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: cap } });
    expect(Number(state.value)).toBe(800);
    expect(Number(state.avgUnitCost)).toBe(100);
    const again = await post({ lines: [{ variantId: cap, counted: 8, reason: "DAMAGED", note: "crushed in the box" }] }, `cnt-cap-${RUN}`);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ replayed: true, lines: r.body.lines });
    expect(await stock(cap)).toBe(8);
    expect(await movements(cap)).toHaveLength(1);
  });

  it("found and samples are adjustments: a sample is noted as one", async () => {
    const r = await recordCounts({ lines: [{ variantId: cap, counted: 9, reason: "FOUND" }] }, OWNER, `cnt-found-${RUN}`);
    expect(r.lines[0]).toMatchObject({ difference: 1 });
    const s = await recordCounts({ lines: [{ variantId: cap, counted: 8, reason: "SAMPLE", note: "for the photographer" }] }, OWNER, `cnt-sample-${RUN}`);
    expect(s.lines[0]).toMatchObject({ difference: -1 });
    const [, found, sample] = await movements(cap);
    expect(found).toMatchObject({ reason: "ADJUSTMENT", change: 1 });
    expect(sample).toMatchObject({ reason: "ADJUSTMENT", change: -1 });
    expect(sample!.note).toMatch(/sample/);
    expect(await stock(cap)).toBe(8);
  });

  it("material count: oil counted 640 ml vs 650 → −10 ml, damaged, 'spilled'", async () => {
    const r = await recordCounts({ lines: [{ variantId: oil, counted: 640, reason: "DAMAGED", note: "spilled" }] }, OWNER, `cnt-oil-${RUN}`);
    expect(r.lines[0]).toMatchObject({ expected: 650, counted: 640, difference: -10 });
    expect(await stock(oil)).toBe(640);
    const [m] = await movements(oil);
    expect(m).toMatchObject({ reason: "DAMAGED", change: -10 });
    expect(m!.note).toMatch(/spilled/);
    expect(Number((await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: oil } })).value)).toBe(640 * 38);
  });

  it("fill to order: a filled bottle waiting for its order is lost → the order waits unfilled (stock −1)", async () => {
    const attar = await createStockedProduct({ stocks: [1], basePrice: 350 });
    await prisma.product.update({ where: { id: attar.product.id }, data: { fillToOrder: true } });
    const bottle = attar.variants[0]!.id;
    await placeOrder([{ variantId: bottle, quantity: 1 }]);
    expect(await stock(bottle)).toBe(0);
    const r = await recordCounts({ lines: [{ variantId: bottle, counted: 0, reason: "LOST" }] }, OWNER, `cnt-attar-${RUN}`);
    expect(r.lines[0]).toMatchObject({ expected: 1, counted: 0, difference: -1 });
    expect(await stock(bottle)).toBe(-1);
    // an ordinary product never goes below zero this way
    const plain = (await createStockedProduct({ stocks: [1] })).variants[0]!.id;
    await placeOrder([{ variantId: plain, quantity: 1 }]);
    await expect(recordCounts({ lines: [{ variantId: plain, counted: 0, reason: "LOST" }] }, OWNER, `cnt-plain-${RUN}`)).rejects.toMatchObject({ statusCode: 409, details: { code: "COUNT_BELOW_ORDERS" } });
    expect(await prisma.stockCount.count({ where: { variantId: plain } })).toBe(0);
  });

  it("needs an Idempotency-Key", async () => {
    expect((await post({ lines: [{ variantId: cap, counted: 8 }] })).status).toBe(400);
  });
});

describe("Counted — review fixes", () => {
  it("is gated by inventory.adjust (who counts the shelf), not finance.custody", () => {
    const route = listRoutes().find((r) => r.method === "POST" && r.path === "/api/v1/finance/stock/counts");
    expect(route && routePermission(route)).toBe("inventory.adjust");
  });

  it("a hub count with orders waiting stores what should have been on the shelf: stock check shows the true difference", async () => {
    const p = (await createStockedProduct({ stocks: [6], basePrice: 400 })).variants[0]!.id;
    await placeOrder([{ variantId: p, quantity: 2 }]); // stock 4, 2 waiting unpacked → 6 should be on the shelf
    const r = await recordCounts({ lines: [{ variantId: p, counted: 5, reason: "LOST" }] }, OWNER, `cnt-true-${RUN}`);
    expect(r.lines[0]).toMatchObject({ expected: 6, counted: 5, difference: -1 });
    const [row] = await prisma.stockCount.findMany({ where: { variantId: p } });
    expect(row).toMatchObject({ counted: 5, siteStock: 6, sourceId: `${r.id}:0` });
    const check = await stockCheck();
    expect(check.finished.find((f: { variantId: string }) => f.variantId === p)?.count).toMatchObject({ counted: 5, siteStockThen: 6, difference: -1 });
    // stock check's own counts are unchanged: against the site's stock
    const own = await recordStockCount({ variantId: p, counted: 3 }, OWNER);
    expect(own.difference).toBe(0);
  });

  it("a retry after a crash between the count and its bookkeeping records the count once", async () => {
    const p = (await createStockedProduct({ stocks: [4], basePrice: 400 })).variants[0]!.id;
    const body = { lines: [{ variantId: p, counted: 5, reason: "FOUND" as const }] };
    const first = await recordCounts(body, OWNER, `cnt-crash-${RUN}`);
    // as if the process died after the StockCount was written but before the entry remembered it
    const entry = await prisma.stockHubEntry.findUniqueOrThrow({ where: { id: first.id } });
    const steps = entry.steps as { lines: Array<Record<string, unknown>> };
    await prisma.stockHubEntry.update({ where: { id: entry.id }, data: { completedAt: null, leaseUntil: null, leaseToken: null, steps: { lines: steps.lines.map((l) => ({ ...l, stockCountId: undefined, done: undefined, expected: undefined, difference: undefined })) } as never } });
    const again = await recordCounts(body, OWNER, `cnt-crash-${RUN}`);
    expect(again.lines[0]).toMatchObject({ expected: 4, counted: 5, difference: 1 });
    expect(await prisma.stockCount.count({ where: { variantId: p } })).toBe(1);
    expect(await stock(p)).toBe(5); // the adjustment is booked once too (its source is the line)
  });
});
