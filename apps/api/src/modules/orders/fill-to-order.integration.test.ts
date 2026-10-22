import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS, productListQuerySchema } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN, stockOf, trackOrder } from "../../test-fixtures";
import type { FinanceActor } from "../../domain/finance/finance-audit";
import { getFinanceContext } from "../../domain/finance/finance-context";
import { ensureCommerceAccounting } from "../../domain/finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../../domain/finance/purchasing-setup.service";
import { updateBusinessSettings } from "../../domain/finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../../domain/finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../../domain/finance/inventory-cutover.service";
import { approvePurchaseOrder, createPurchaseOrder, submitPurchaseOrder } from "../../domain/finance/purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt } from "../../domain/finance/goods-receipts.service";
import { createSupplier } from "../../domain/finance/suppliers.service";
import { ensureManufacturingSetup } from "../../domain/manufacturing/manufacturing-setup.service";
import { createMaterial } from "../../domain/manufacturing/materials.service";
import { approveBom, createBom } from "../../domain/manufacturing/boms.service";
import { fillToOrderFloors, fillToOrderFloorsFor } from "../../domain/stock/fill-capacity.service";
import { recordSale, stockShortfalls } from "../inventory/inventory.service";
import { getProductBySlug, listProducts } from "../products/product.service";
import { getCategoryStockMap, getCategoryStockOverview } from "../categories/category.service";
import { createReturnRequest, previewExchange, reviewReturnRequest } from "../return-requests/return-request.service";
import { applyOrderModification } from "./order-modification.service";
import { quoteCart } from "../../domain/pricing/pricing.service";
import { deleteOrder, restoreOrder, updateOrderStatus } from "./order.service";

// Stock hub Task 4 (docs/STOCK_HUB.md §3): a fill-to-order variant sells max(0, stock) + makeable on the website, in the
// quote and at checkout; its stock goes negative for unfilled orders (the costing deficit), and the checkout locks the
// materials so the last shared bottle is sold exactly once. After a real valuation cutover, so the sales are costed.

let OWNER: FinanceActor;
let admin = "";
let supplierId = "";
let oil = "";
let bottle6 = "";
let bottle12 = "";
let azhaar: { id: string; slug: string; variant: string };
let royal: { id: string; slug: string; variant: string };
let sweet: { id: string; slug: string; variant: string };
let categoryId = "";

async function buy(variantId: string, qty: number, unitPrice: number) {
  const po = await createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId, qtyOrdered: qty, unitPrice }] } as never, OWNER);
  await submitPurchaseOrder(po.id, OWNER);
  const approved = await approvePurchaseOrder(po.id, OWNER);
  const grn = await createGoodsReceipt({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: approved.lines[0]!.id, qtyAccepted: qty }] } as never, OWNER);
  await postGoodsReceipt(grn.id, {}, OWNER);
}
const material = async (name: string, unit: string) =>
  (await createMaterial({ name: `Vitest ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `FTO-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
async function attar(lines: Array<{ material: () => string; qty: string }>) {
  const p = await createStockedProduct({ stocks: [0], basePrice: 350 });
  await prisma.product.update({ where: { id: p.product.id }, data: { fillToOrder: true } });
  const bom = await createBom({ productId: p.product.id, lines: lines.map((l) => ({ materialVariantId: l.material(), qtyPerUnit: l.qty, wastagePct: "0" })) } as never, OWNER);
  await approveBom(bom.id, OWNER);
  return { id: p.product.id, slug: p.product.slug, variant: p.variants[0]!.id };
}
/** What the website shows for a product's first variant. */
const shown = async (slug: string) => (await getProductBySlug(slug))!.variants[0]!.stock;
const computedAt = async (productId: string) => (await prisma.productReadModel.findUnique({ where: { productId }, select: { computedAt: true } }))?.computedAt;
/** Waits for a fire-and-forget refresh: true once the product's projection row was recomputed after `before`. */
async function refreshedSince(productId: string, before: Date | undefined) {
  let at = before;
  for (let i = 0; i < 50 && at?.getTime() === before?.getTime(); i++) {
    await new Promise((r) => setTimeout(r, 100));
    at = await computedAt(productId);
  }
  return at !== undefined && at.getTime() !== before?.getTime();
}
const status = async (run: Promise<unknown>) => {
  try {
    await run;
    return 201;
  } catch (err) {
    if (err instanceof AppError) return err.statusCode;
    throw err;
  }
};

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
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "FTO-SEED", name: "seed", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  supplierId = (await createSupplier({ legalName: "Vitest Attar House" } as never, OWNER)).id;
  oil = await material("Azhaar oil", "ml");
  bottle6 = await material("Bottle 6ml", "pcs");
  bottle12 = await material("Bottle 12ml", "pcs");
  await buy(oil, 650, 38);
  await buy(bottle6, 166, 50);
  await buy(bottle12, 1, 52);
  azhaar = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
  // Two 12 ml fragrances sharing the one 12 ml bottle left (their oil is plentiful: the bottle is the limit).
  royal = await attar([{ material: () => oil, qty: "12" }, { material: () => bottle12, qty: "1" }]);
  sweet = await attar([{ material: () => oil, qty: "12" }, { material: () => bottle12, qty: "1" }]);
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
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
});

describe("fill to order", () => {
  let firstOrder = "";

  it("orders beyond filled stock within capacity: 0 filled, 108 makeable → order of 2 → stock −2, costing deficit 2", async () => {
    expect(await shown(azhaar.slug)).toBe(108); // 650 ml / 6
    const quote = await quoteCart({ items: [{ variantId: azhaar.variant, quantity: 2 }] });
    expect(quote.quote.warnings.filter((w) => w.code === "INSUFFICIENT_STOCK")).toEqual([]);
    const order = await placeOrder([{ variantId: azhaar.variant, quantity: 2 }]);
    firstOrder = order.id;
    expect(await stockOf(azhaar.variant)).toBe(-2);
    const state = await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: azhaar.variant } });
    expect(state.deficitQty).toBe(2); // the costing deficit, settled when the bottles are filled
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id }, select: { costMovementId: true, unitCostSource: true } });
    expect(line).toMatchObject({ costMovementId: expect.any(String), unitCostSource: "NONE" }); // costed like any exit (no average yet → no unit cost)
    expect(await shown(azhaar.slug)).toBe(106); // 12 ml of oil reserved: 638 / 6
    await assertInventoryInvariants(azhaar.variant);
  });

  it("refused beyond capacity", async () => {
    // The quote refuses what the website wouldn't sell…
    await expect(placeOrder([{ variantId: azhaar.variant, quantity: 107 }])).rejects.toMatchObject({ statusCode: 409 });
    // …and the checkout's own guard (materials locked) refuses a line that got past a stale quote.
    const err = await prisma
      .$transaction(async (tx) => {
        const { floors } = await fillToOrderFloors(tx, [{ variantId: azhaar.variant, quantity: 107 }]);
        expect(floors.get(azhaar.variant)).toBe(106 + 2); // makeable + the units already ordered unfilled
        await recordSale(tx, "no-order", [{ variantId: azhaar.variant, quantity: 107 }], { floors });
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(409);
    expect((err as AppError).message).toMatch(/^Stock changed/);
    expect(await stockOf(azhaar.variant)).toBe(-2);
  });

  it("cancel restores capacity", async () => {
    await updateOrderStatus(firstOrder, { status: "CANCELLED" }, admin);
    expect(await stockOf(azhaar.variant)).toBe(0);
    expect(await shown(azhaar.slug)).toBe(108);
    await assertInventoryInvariants(azhaar.variant);
  });

  it("concurrent orders share one bottle: two fragrances, 1 bottle left → one 201, one 409", async () => {
    expect(await shown(royal.slug)).toBe(1);
    expect(await shown(sweet.slug)).toBe(1); // each reads the shared bottle in full on the website
    const results = await Promise.all([
      status(placeOrder([{ variantId: royal.variant, quantity: 1 }], { customerPhone: "01712000001" })),
      status(placeOrder([{ variantId: sweet.variant, quantity: 1 }], { customerPhone: "01712000002" })),
    ]);
    expect(results.sort()).toEqual([201, 409]);
    expect((await stockOf(royal.variant)) + (await stockOf(sweet.variant))).toBe(-1);
    expect(await shown(royal.slug)).toBe(0);
    expect(await shown(sweet.slug)).toBe(0);
    await assertInventoryInvariants(royal.variant);
    await assertInventoryInvariants(sweet.variant);
  });

  it("read model follows materials: a receipt of oil raises what the product sells and refreshes its read model", async () => {
    const before = await prisma.productReadModel.findUnique({ where: { productId: azhaar.id }, select: { computedAt: true } });
    // 12 ml of oil is reserved by the unfilled 12 ml order above: (650 − 12) / 6 = 106.
    expect(await shown(azhaar.slug)).toBe(106);
    await buy(oil, 600, 38);
    expect(await shown(azhaar.slug)).toBe(166); // (1,250 − 12) / 6 = 206, but only 166 bottles of 6 ml
    // The refresh after the movement is fire-and-forget: wait for the product's projection row to be recomputed.
    let after = before;
    for (let i = 0; i < 50 && after?.computedAt.getTime() === before?.computedAt.getTime(); i++) {
      await new Promise((r) => setTimeout(r, 100));
      after = await prisma.productReadModel.findUnique({ where: { productId: azhaar.id }, select: { computedAt: true } });
    }
    expect(after).not.toBeNull();
    expect(after!.computedAt.getTime()).not.toBe(before?.computedAt.getTime());
  });

  it("ordinary product unchanged: the stock cap still refuses at 0", async () => {
    const p = await createStockedProduct({ stocks: [1] });
    const v = p.variants[0]!.id;
    expect(await shown(p.product.slug)).toBe(1);
    await expect(placeOrder([{ variantId: v, quantity: 2 }])).rejects.toMatchObject({ statusCode: 409 });
    await placeOrder([{ variantId: v, quantity: 1 }]);
    expect(await stockOf(v)).toBe(0);
    await expect(placeOrder([{ variantId: v, quantity: 1 }])).rejects.toMatchObject({ statusCode: 409 });
    expect(await stockOf(v)).toBe(0);
    expect(await shown(p.product.slug)).toBe(0);
    // Its read model row is never touched by a material movement.
    await assertInventoryInvariants(v);
  });
});

// Stock hub follow-ups: every other way a fill-to-order unit is sold (modification, paid modification, exchange) uses the
// checkout's floors; stock moves of such orders refresh the products sharing the materials; in-stock counts and filters
// count what can be made; a cart whose lines together exceed a shared material gets a specific 409.
describe("fill to order beyond the checkout", () => {
  const staff = () => ({ type: "ADMIN" as const, adminId: admin });

  it("an order modification adds fill-to-order units beyond filled stock, within capacity", async () => {
    const start = await stockOf(azhaar.variant);
    expect(start).toBeLessThanOrEqual(0);
    const order = await placeOrder([{ variantId: azhaar.variant, quantity: 1 }], { customerPhone: "01712000011" });
    await applyOrderModification(order.id, { items: [{ variantId: azhaar.variant, quantity: 3 }] }, staff());
    expect(await stockOf(azhaar.variant)).toBe(start - 3);
    // Beyond what can be made (the last 12 ml bottle is reserved): refused, nothing changes.
    expect(await shown(royal.slug)).toBe(0);
    const royalBefore = await stockOf(royal.variant);
    await expect(
      applyOrderModification(order.id, { items: [{ variantId: azhaar.variant, quantity: 3 }, { variantId: royal.variant, quantity: 1 }] }, staff()),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await stockOf(azhaar.variant)).toBe(start - 3);
    expect(await stockOf(royal.variant)).toBe(royalBefore);
    await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
    expect(await stockOf(azhaar.variant)).toBe(start);
    await assertInventoryInvariants(azhaar.variant);
  });

  it("a paid change's stock check counts what can still be made", async () => {
    expect(await stockOf(azhaar.variant)).toBeLessThanOrEqual(0);
    await prisma.$transaction(async (tx) => {
      const units = [{ variantId: azhaar.variant, quantity: 2 }];
      expect(await stockShortfalls(tx, units, new Set())).toEqual([azhaar.variant]); // filled bottles alone: none
      const fill = await fillToOrderFloorsFor(tx, units);
      expect(fill?.floors.get(azhaar.variant)).toBeGreaterThan(2);
      expect(await stockShortfalls(tx, units, new Set(), fill?.floors)).toEqual([]);
      expect(await stockShortfalls(tx, [{ variantId: azhaar.variant, quantity: 100_000 }], new Set(), fill?.floors)).toEqual([azhaar.variant]);
    });
    // An ordinary variant gets no floor (one lookup, no capacity query).
    const plain = await createStockedProduct({ stocks: [1] });
    expect(await prisma.$transaction((tx) => fillToOrderFloorsFor(tx, [{ variantId: plain.variants[0]!.id, quantity: 1 }]))).toBeNull();
  });

  it("an exchange to a fill-to-order variant ships from capacity", async () => {
    const shirt = await createStockedProduct({ stocks: [3], basePrice: 350 });
    const order = await placeOrder([{ variantId: shirt.variants[0]!.id, quantity: 1 }], { customerPhone: "01712000012" });
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
    const placed = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { customerId: true, items: { select: { id: true } } } });
    const req = await createReturnRequest(placed.customerId!, { orderId: order.id, type: "EXCHANGE", reason: "Changed mind", note: null, orderItemId: placed.items[0]!.id, requestedVariantId: azhaar.variant });
    const start = await stockOf(azhaar.variant);
    expect(start).toBeLessThanOrEqual(0);
    expect((await previewExchange(req.id)).replacement.inStock).toBe(true);
    await reviewReturnRequest(req.id, { status: "APPROVED", adminNote: null }, admin);
    const rr = await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } });
    trackOrder(rr.exchangeOrderId!);
    expect(await stockOf(azhaar.variant)).toBe(start - 1);
    await assertInventoryInvariants(azhaar.variant);
  });

  it("restoring a trashed fill-to-order order takes its units back below zero, within capacity", async () => {
    const start = await stockOf(azhaar.variant);
    expect(start).toBeLessThanOrEqual(0);
    const order = await placeOrder([{ variantId: azhaar.variant, quantity: 2 }], { customerPhone: "01712000015" });
    await deleteOrder(order.id, admin);
    expect(await stockOf(azhaar.variant)).toBe(start);
    await restoreOrder(order.id, admin);
    expect(await stockOf(azhaar.variant)).toBe(start - 2);
    await assertInventoryInvariants(azhaar.variant);
    await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
  });

  it("a cancellation refreshes every product that shares the freed material", async () => {
    const zayan = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    const t0 = await computedAt(zayan.id);
    const order = await placeOrder([{ variantId: azhaar.variant, quantity: 1 }], { customerPhone: "01712000013" });
    expect(await refreshedSince(zayan.id, t0)).toBe(true); // the checkout's own refresh (it reserved shared oil + bottle)
    const t1 = await computedAt(zayan.id);
    await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
    expect(await refreshedSince(zayan.id, t1)).toBe(true);
  });

  it("in-stock counts and filters: fill-to-order at stock 0 counts when it can be made, not otherwise", async () => {
    categoryId = (await prisma.category.create({ data: { name: `Vitest FTO ${RUN}`, slug: `vitest-fto-${RUN}` } })).id;
    const makeable = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    const none = await createStockedProduct({ stocks: [0] });
    await prisma.product.update({ where: { id: none.product.id }, data: { fillToOrder: true } }); // no recipe: nothing can be made
    await prisma.product.updateMany({ where: { id: { in: [makeable.id, none.product.id] } }, data: { categoryId } });
    expect(await stockOf(makeable.variant)).toBe(0);
    expect((await getCategoryStockOverview(categoryId)).total).toEqual({ totalProducts: 2, inStockProducts: 1 });
    expect((await getCategoryStockMap())[categoryId]).toMatchObject({ totalProducts: 2, inStockProducts: 1 });
    const q = (extra: Record<string, unknown>) => productListQuerySchema.parse({ page: 1, pageSize: 100, categoryId, ...extra });
    expect((await listProducts(q({ stock: "out" }))).items.map((p) => p.id)).toEqual([none.product.id]);
    const states = new Map((await listProducts(q({}))).items.map((p) => [p.id, p.stockState]));
    expect(states.get(makeable.id)).not.toBe("OUT_OF_STOCK");
    expect(states.get(none.product.id)).toBe("OUT_OF_STOCK");
  });

  it("one cart, two fragrances short of a shared bottle together: a specific 409", async () => {
    await buy(bottle12, 2, 52); // 3 bottles, 1 reserved by the unfilled 12 ml order above → each fragrance reads 2
    expect(await shown(royal.slug)).toBe(2);
    expect(await shown(sweet.slug)).toBe(2);
    const err = await placeOrder([{ variantId: royal.variant, quantity: 1 }, { variantId: sweet.variant, quantity: 2 }], { customerPhone: "01712000014" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(409);
    expect((err as AppError).message).toMatch(/^Only 1 more .+ can be made right now — please update the quantity$/);
    expect((err as AppError).details).toBeUndefined(); // same shape as the generic stock 409 the cart already shows
  });
});
