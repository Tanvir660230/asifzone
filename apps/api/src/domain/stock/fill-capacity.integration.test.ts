import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MAX_LINE_QUANTITY, PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import { recordInitialStock } from "../../modules/inventory/inventory.service";
import type { FinanceActor } from "../finance/finance-audit";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";
import { FILL_MEMO_TTL_MS, fillCapacity, fillCapacityChanged, fillShortfall, fillToOrderFloors, withFillToOrder } from "./fill-capacity.service";

// Stock hub Task 3 (docs/STOCK_HUB.md §3): makeable units from the latest approved recipe and the materials' stock.

let OWNER: FinanceActor;
const material = async (name: string, unit: string, qty: number) => {
  const id = (await createMaterial({ name: `Vitest ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `FC-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
  await prisma.$transaction((tx) => recordInitialStock(tx, id, qty, "RESTOCK", { note: "test material" }));
  return id;
};
const attar = async (stocks: number[] = [0, 0]) => {
  const p = await createStockedProduct({ stocks, basePrice: 350 });
  await prisma.product.update({ where: { id: p.product.id }, data: { fillToOrder: true } });
  return p;
};
const approvedBom = async (productId: string, lines: object[]) => {
  const bom = await createBom({ productId, lines } as never, OWNER);
  await approveBom(bom.id, OWNER);
  return bom.id;
};

let oil = "";
let bottle6 = "";
let bottle12 = "";
let sticker = "";
let cap = "";

beforeAll(async () => {
  await purgeFinanceTables();
  OWNER = { type: "ADMIN", adminId: await ownerId(), label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  oil = await material("Azhaar oil", "ml", 650);
  bottle6 = await material("Bottle 6ml", "pcs", 166);
  bottle12 = await material("Bottle 12ml", "pcs", 10);
  sticker = await material("Sticker", "pcs", 1000);
  cap = await material("Cap", "pcs", 0);
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

describe("fill capacity", () => {
  it("capacity from the approved recipe: per-size lines, a line for every size, PRODUCER lines ignored", async () => {
    const a = await attar([0, 3]);
    const [v6, v12] = a.variants;
    await approvedBom(a.product.id, [
      { materialVariantId: oil, finishedVariantId: v6!.id, qtyPerUnit: "6", wastagePct: "0" },
      { materialVariantId: bottle6, finishedVariantId: v6!.id, qtyPerUnit: "1", wastagePct: "0" },
      { materialVariantId: oil, finishedVariantId: v12!.id, qtyPerUnit: "12", wastagePct: "0" },
      { materialVariantId: bottle12, finishedVariantId: v12!.id, qtyPerUnit: "1", wastagePct: "0" },
      { materialVariantId: sticker, qtyPerUnit: "1", wastagePct: "0" },
      { materialVariantId: cap, qtyPerUnit: "1", wastagePct: "0", suppliedBy: "PRODUCER" },
    ]);
    const made = await fillCapacity(prisma, { variantIds: [v6!.id, v12!.id] });
    expect(made.get(v6!.id)).toBe(108); // 650 ml / 6
    expect(made.get(v12!.id)).toBe(10); // 10 bottles of 12 ml
    const sold = await withFillToOrder(prisma, { fillToOrder: true }, [{ id: v6!.id, stock: 0 }, { id: v12!.id, stock: 3 }]);
    expect(sold.map((v) => v.stock)).toEqual([108, 13]); // filled bottles on hand + makeable
    // Locked inside a transaction (the checkout path) the answer is the same.
    const locked = await prisma.$transaction((tx) => fillCapacity(tx, { variantIds: [v6!.id], lockMaterials: true }));
    expect([...locked]).toEqual([[v6!.id, 108]]);
  });

  it("draft recipe ignored: only the latest APPROVED version counts", async () => {
    const a = await attar([0]);
    const v = a.variants[0]!;
    await createBom({ productId: a.product.id, lines: [{ materialVariantId: oil, qtyPerUnit: "6", wastagePct: "0" }] } as never, OWNER);
    expect((await fillCapacity(prisma, { variantIds: [v.id] })).get(v.id)).toBe(0);
    await approvedBom(a.product.id, [{ materialVariantId: bottle12, qtyPerUnit: "1", wastagePct: "0" }]);
    await createBom({ productId: a.product.id, lines: [{ materialVariantId: sticker, qtyPerUnit: "1", wastagePct: "0" }] } as never, OWNER);
    expect((await fillCapacity(prisma, { variantIds: [v.id] })).get(v.id)).toBe(10);
  });

  it("no recipe means no capacity: only filled bottles sell, never unlimited", async () => {
    const a = await attar([2]);
    const v = a.variants[0]!;
    expect((await fillCapacity(prisma, { variantIds: [v.id] })).get(v.id)).toBe(0);
    expect((await withFillToOrder(prisma, { fillToOrder: true }, [{ id: v.id, stock: 2 }]))[0]!.stock).toBe(2);
    expect((await withFillToOrder(prisma, { fillToOrder: true }, [{ id: v.id, stock: -3 }]))[0]!.stock).toBe(0);
  });

  it("untouched for non fill-to-order products", async () => {
    const p = await createStockedProduct({ stocks: [4] });
    await approvedBom(p.product.id, [{ materialVariantId: oil, qtyPerUnit: "6", wastagePct: "0" }]);
    const v = p.variants[0]!;
    expect((await fillCapacity(prisma)).has(v.id)).toBe(false);
    const variants = [{ id: v.id, stock: 4 }];
    expect(await withFillToOrder(prisma, { fillToOrder: false }, variants)).toBe(variants);
    // An untracked fill-to-order product is already unlimited.
    expect(await withFillToOrder(prisma, { fillToOrder: true, trackInventory: false }, variants)).toBe(variants);
  });

  it("checkout floors: two fragrances in one cart can't both take the last shared bottle", async () => {
    const a = await attar([0]);
    const b = await attar([0]);
    const shared = await material("Bottle shared", "pcs", 1);
    await approvedBom(a.product.id, [{ materialVariantId: oil, qtyPerUnit: "12", wastagePct: "0" }, { materialVariantId: shared, qtyPerUnit: "1", wastagePct: "0" }]);
    await approvedBom(b.product.id, [{ materialVariantId: sticker, qtyPerUnit: "1", wastagePct: "0" }, { materialVariantId: shared, qtyPerUnit: "1", wastagePct: "0" }]);
    const { floors, materialIds } = await prisma.$transaction((tx) => fillToOrderFloors(tx, [{ variantId: a.variants[0]!.id, quantity: 1 }, { variantId: b.variants[0]!.id, quantity: 1 }]));
    expect(floors.get(a.variants[0]!.id)).toBe(1);
    expect(floors.get(b.variants[0]!.id)).toBe(0);
    expect(new Set(materialIds)).toEqual(new Set([oil, shared, sticker]));
  });

  it("wastage counts in the floors: 66 ml at 6 ml + 10 % makes exactly 10", async () => {
    const a = await attar([0]);
    const lean = await material("Lean oil", "ml", 66);
    await approvedBom(a.product.id, [{ materialVariantId: lean, qtyPerUnit: "6", wastagePct: "10" }]);
    const v = a.variants[0]!.id;
    expect((await fillCapacity(prisma, { variantIds: [v] })).get(v)).toBe(10);
    const { floors, available } = await prisma.$transaction((tx) => fillToOrderFloors(tx, [{ variantId: v, quantity: 11 }]));
    expect(floors.get(v)).toBe(10);
    expect(available.get(v)).toBe(10);
  });

  it("public reads share a short-lived memo; a stock move in this process drops it, and an unknown variant is read live", async () => {
    const a = await attar([0]);
    const drops = await material("Memo oil", "ml", 12);
    await approvedBom(a.product.id, [{ materialVariantId: drops, qtyPerUnit: "6", wastagePct: "0" }]);
    const v = a.variants[0]!.id;
    expect((await fillCapacity(prisma, { variantIds: [v], cached: true })).get(v)).toBe(2); // not in the memo yet: live
    await prisma.$transaction((tx) => recordInitialStock(tx, drops, 12, "RESTOCK", { note: "no notify" }));
    expect((await fillCapacity(prisma, { variantIds: [v], cached: true })).get(v)).toBe(2); // the memo (≤ FILL_MEMO_TTL_MS old)
    expect((await fillCapacity(prisma, { variantIds: [v] })).get(v)).toBe(4); // uncached callers always read live
    fillCapacityChanged();
    expect((await fillCapacity(prisma, { variantIds: [v], cached: true })).get(v)).toBe(4);
    expect(FILL_MEMO_TTL_MS).toBeLessThanOrEqual(5_000);
    // A variant that became fill-to-order after the memo was taken is not answered from it.
    const b = await attar([0]);
    await approvedBom(b.product.id, [{ materialVariantId: drops, qtyPerUnit: "12", wastagePct: "0" }]);
    expect((await fillCapacity(prisma, { variantIds: [b.variants[0]!.id], cached: true })).get(b.variants[0]!.id)).toBe(2);
  });
});

describe("fill shortfall message", () => {
  const fill = (n: number) => ({ floors: new Map([["v", n]]), materialIds: [], available: new Map([["v", n]]) });
  it("names how many more can be made only below the line maximum", () => {
    expect(fillShortfall(fill(3), [{ variantId: "v", quantity: 5, label: "Azhaar 6 ml" }])?.message).toBe("Only 3 more Azhaar 6 ml can be made right now — please update the quantity");
    const big = fillShortfall(fill(MAX_LINE_QUANTITY), [{ variantId: "v", quantity: MAX_LINE_QUANTITY + 5, label: "Azhaar 6 ml" }]);
    expect(big?.statusCode).toBe(409);
    expect(big?.message).toBe("Not that many Azhaar 6 ml can be made right now — please update the quantity"); // no count
    expect(fillShortfall(fill(0), [{ variantId: "v", quantity: 1, label: "Azhaar 6 ml" }])?.message).toBe("Azhaar 6 ml has just sold out — please review your cart");
  });
});
