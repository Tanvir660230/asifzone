import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MAX_LINE_QUANTITY, PERMISSIONS, productListQuerySchema, sellable } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { assertInventoryInvariants, checkout, cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN, stockOf, trackOrder } from "../../test-fixtures";
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
import { fillCapacity, fillToOrderFloors, fillToOrderFloorsFor } from "../../domain/stock/fill-capacity.service";
import { adjustVariantStock, adjustVariantStockInTx, afterAdjustment, recordSale, stockMovedSettled, stockShortfalls } from "../inventory/inventory.service";
import { getProductBySlug, listProducts, updateProduct } from "../products/product.service";
import { getCategoryStockMap, getCategoryStockOverview } from "../categories/category.service";
import { createReturnRequest, previewExchange, reviewReturnRequest } from "../return-requests/return-request.service";
import { applyOrderModification } from "./order-modification.service";
import { quoteCart, toQuoteDto } from "../../domain/pricing/pricing.service";
import { deleteOrder, deriveOrderPricing, insertOrderRecord, restoreOrder, updateOrderStatus } from "./order.service";
import { quickRefill } from "../../domain/manufacturing/quick-refill.service";
import { processFinancialEvent } from "../../domain/finance/events.service";
import { projectOrder } from "../../domain/finance/commerce-accounting.service";
import { runReconciliation } from "../../domain/finance/reconciliation.service";

/** A manual increase as the stock hub's count makes it (adjustVariantStockInTx): the Adjust endpoint refuses increases once
 * costing is live (inventory recovery F-a), but the valuation of an increase is still what these tests pin down. */
const internalIncrease = async (variantId: string, delta: number, reason: "RESTOCK" | "ADJUSTMENT", adminId: string, note: string) => {
  const r = await prisma.$transaction((tx) => adjustVariantStockInTx(tx, variantId, delta, reason, adminId, note));
  afterAdjustment(r);
  return r.variant;
};

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
let subCategoryId = "";

async function buy(variantId: string, qty: number, unitPrice: number) {
  const po = await createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId, qtyOrdered: qty, unitPrice }] } as never, OWNER);
  await submitPurchaseOrder(po.id, OWNER);
  const approved = await approvePurchaseOrder(po.id, OWNER);
  const grn = await createGoodsReceipt({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: approved.lines[0]!.id, qtyAccepted: qty }] } as never, OWNER);
  await postGoodsReceipt(grn.id, {}, OWNER);
}
const material = async (name: string, unit: string) =>
  (await createMaterial({ name: `Vitest ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `FTO-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
async function attar(lines: Array<{ material: () => string; qty: string; wastagePct?: string }>) {
  const p = await createStockedProduct({ stocks: [0], basePrice: 350 });
  await prisma.product.update({ where: { id: p.product.id }, data: { fillToOrder: true } });
  const bom = await createBom({ productId: p.product.id, lines: lines.map((l) => ({ materialVariantId: l.material(), qtyPerUnit: l.qty, wastagePct: l.wastagePct ?? "0" })) } as never, OWNER);
  await approveBom(bom.id, OWNER);
  return { id: p.product.id, slug: p.product.slug, variant: p.variants[0]!.id };
}
/** What the website shows for a product's first variant. */
const shown = async (slug: string) => (await getProductBySlug(slug))!.variants[0]!.stock;
const computedAt = async (productId: string) => (await prisma.productReadModel.findUnique({ where: { productId }, select: { computedAt: true } }))?.computedAt;
/** After the fire-and-forget refreshes in flight have settled: was the product's projection row recomputed after `before`? */
async function refreshedSince(productId: string, before: Date | undefined) {
  await stockMovedSettled();
  const at = await computedAt(productId);
  return at !== undefined && at.getTime() !== before?.getTime();
}
/** What the shop can sell of a fill-to-order variant right now, exactly (the website shows it capped at MAX_LINE_QUANTITY). */
const sells = async (variantId: string) => sellable(await stockOf(variantId), (await fillCapacity(prisma, { variantIds: [variantId] })).get(variantId) ?? 0);
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
  if (subCategoryId) await prisma.category.delete({ where: { id: subCategoryId } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
});

describe("fill to order", () => {
  let firstOrder = "";

  it("orders beyond filled stock within capacity: 0 filled, 108 makeable → order of 2 → stock −2, costing deficit 2", async () => {
    expect(await sells(azhaar.variant)).toBe(108); // 650 ml / 6
    expect(await shown(azhaar.slug)).toBe(MAX_LINE_QUANTITY); // the website never shows more than one line may hold (no material counts leak)
    const quote = await quoteCart({ items: [{ variantId: azhaar.variant, quantity: 2 }] });
    expect(quote.quote.warnings.filter((w) => w.code === "INSUFFICIENT_STOCK")).toEqual([]);
    // The public quote shows the same capped figure — never the exact capacity (108) the check above used internally.
    expect(quote.quote.lines[0]!.stock).toBe(108);
    expect(toQuoteDto(quote).lines[0]!.stock).toBe(MAX_LINE_QUANTITY);
    // …and no storefront product payload says the product is filled to order.
    expect(await getProductBySlug(azhaar.slug)).not.toHaveProperty("fillToOrder");
    const order = await placeOrder([{ variantId: azhaar.variant, quantity: 2 }]);
    firstOrder = order.id;
    expect(await stockOf(azhaar.variant)).toBe(-2);
    const state = await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: azhaar.variant } });
    expect(state.deficitQty).toBe(2); // the costing deficit, settled when the bottles are filled
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id }, select: { costMovementId: true, unitCostSource: true } });
    expect(line).toMatchObject({ costMovementId: expect.any(String), unitCostSource: "INVENTORY_PROVISIONAL" }); // no average yet → the recipe's standard cost, provisional
    expect(await sells(azhaar.variant)).toBe(106); // 12 ml of oil reserved: 638 / 6
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
    expect(await sells(azhaar.variant)).toBe(108);
    // Sold with no cost known and cancelled: the units come back against the no-cost deficit — nothing unvalued, no
    // phantom deficit for the next fill to "cover".
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: azhaar.variant } })).toMatchObject({ deficitQty: 0, unvaluedQty: 0, valuedQty: 0 });
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
    expect(await sells(azhaar.variant)).toBe(106);
    await buy(oil, 600, 38);
    expect(await sells(azhaar.variant)).toBe(166); // (1,250 − 12) / 6 = 206, but only 166 bottles of 6 ml
    // The refresh after the movement is fire-and-forget: await the ones in flight, then the row must be recomputed.
    await stockMovedSettled();
    const after = await prisma.productReadModel.findUnique({ where: { productId: azhaar.id }, select: { computedAt: true } });
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
    // A subcategory counts its own: the page reads fill-to-order capacity once for the parent scope, not once per child.
    subCategoryId = (await prisma.category.create({ data: { name: `Vitest FTO sub ${RUN}`, slug: `vitest-fto-sub-${RUN}`, parentId: categoryId } })).id;
    await cacheDelByPrefix("categories:"); // created directly: drop the cached category tree
    await prisma.product.update({ where: { id: makeable.id }, data: { categoryId: subCategoryId } });
    const overview = await getCategoryStockOverview(categoryId);
    expect(overview.total).toEqual({ totalProducts: 2, inStockProducts: 1 });
    expect(overview.subcategories).toEqual([expect.objectContaining({ id: subCategoryId, totalProducts: 1, inStockProducts: 1 })]);
    await prisma.product.update({ where: { id: makeable.id }, data: { categoryId } });
    const q = (extra: Record<string, unknown>) => productListQuerySchema.parse({ page: 1, pageSize: 100, categoryId, ...extra });
    expect((await listProducts(q({ stock: "out" }))).items.map((p) => p.id)).toEqual([none.product.id]);
    const states = new Map((await listProducts(q({}))).items.map((p) => [p.id, p.stockState]));
    expect(states.get(makeable.id)).not.toBe("OUT_OF_STOCK");
    expect(states.get(none.product.id)).toBe("OUT_OF_STOCK");
  });

  it("the admin product list gives each fill-to-order variant what it can sell, uncapped (the phone-order picker)", async () => {
    const p = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    const plain = await createStockedProduct({ stocks: [3] });
    const items = (await listProducts(productListQuerySchema.parse({ page: 1, pageSize: 100, search: `Vitest P1 ${RUN}` }))).items;
    const variantOf = (id: string) => items.find((i) => i.id === id)!.variants[0]! as { stock: number; sellable?: number };
    const expected = await sells(p.variant);
    expect(expected).toBeGreaterThan(0);
    expect(variantOf(p.id)).toMatchObject({ stock: 0, sellable: expected });
    expect(variantOf(plain.product.id).sellable).toBeUndefined(); // an ordinary product sells its stock
  });

  it("filled bottles crossing zero don't email shoppers waiting on a fill-to-order variant (it was for sale all along)", async () => {
    const p = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    await stockMovedSettled();
    expect(await sells(p.variant)).toBeGreaterThan(0);
    const customer = await prisma.customer.create({ data: { name: "VT attar filled", email: `vt-fto-filled-${RUN}@example.com` } });
    const alert = await prisma.stockAlert.create({ data: { customerId: customer.id, variantId: p.variant } });
    try {
      await internalIncrease(p.variant, 2, "RESTOCK", admin, "two bottles filled"); // 0 → 2: a back-in-stock crossing for an ordinary product
      await stockMovedSettled();
      await new Promise((r) => setTimeout(r, 300));
      expect((await prisma.stockAlert.findUniqueOrThrow({ where: { id: alert.id } })).notifiedAt).toBeNull();
      await adjustVariantStock(p.variant, -2, "ADJUSTMENT", admin, "test: back to 0");
      await stockMovedSettled();
    } finally {
      await prisma.stockAlert.delete({ where: { id: alert.id } });
      await prisma.customer.delete({ where: { id: customer.id } });
    }
  });

  it("one cart, two fragrances short of a shared bottle together: a specific 409", async () => {
    // Both fragrances sell nothing now (the shared 12 ml bottle went to the order above) — a shopper waits for Sweet.
    await stockMovedSettled();
    expect(await sells(sweet.variant)).toBe(0);
    const customer = await prisma.customer.create({ data: { name: "VT attar waiting", email: `vt-fto-waiting-${RUN}@example.com` } });
    const alert = await prisma.stockAlert.create({ data: { customerId: customer.id, variantId: sweet.variant } });
    const notifiedAt = async () => (await prisma.stockAlert.findUniqueOrThrow({ where: { id: alert.id } })).notifiedAt;
    await buy(bottle12, 2, 52); // 3 bottles, 1 reserved by the unfilled 12 ml order above → each fragrance reads 2
    // Bottles bought: Sweet can be made again, so the shopper is told it is back in stock.
    await stockMovedSettled();
    await expect.poll(notifiedAt, { timeout: 3000 }).not.toBeNull();
    await prisma.stockAlert.delete({ where: { id: alert.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    expect(await shown(royal.slug)).toBe(2);
    expect(await shown(sweet.slug)).toBe(2);
    const err = await placeOrder([{ variantId: royal.variant, quantity: 1 }, { variantId: sweet.variant, quantity: 2 }], { customerPhone: "01712000014" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(409);
    expect((err as AppError).message).toMatch(/^Only 1 more .+ can be made right now — please update the quantity$/);
    expect((err as AppError).details).toBeUndefined(); // same shape as the generic stock 409 the cart already shows
  });
});

// Review follow-ups: costing of unfilled sales (a cancel nets the no-cost deficit; a fill covers a real one and the books
// agree), a cart mixing ordinary and fill-to-order lines, wastage and a paid oversell through the floors, and stock edits
// from a CSV import refreshing the products that share materials.
describe("fill to order — costing and edges", () => {
  let key = 0;
  const refill = (variantId: string, quantity: number) => quickRefill({ variantId, quantity }, OWNER, `fto-refill-${RUN}-${++key}`);
  const receiptEntry = (variantId: string) =>
    prisma.inventoryValuationEntry.findFirstOrThrow({ where: { variantId, kind: "INFLOW", stockMovement: { reason: "PRODUCTION_RECEIPT" } }, orderBy: { createdAt: "desc" } });
  async function postPending() {
    for (let round = 0; round < 10; round++) {
      const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
      if (!waiting.length) return;
      for (const e of waiting) await processFinancialEvent(e.id);
    }
  }

  it("cancel an unfilled order, then fill N: no unvalued units, the fill is valued in full with no adjustment", async () => {
    const rose = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    const order = await placeOrder([{ variantId: rose.variant, quantity: 2 }], { customerPhone: "01712000021" });
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: rose.variant } })).toMatchObject({ deficitQty: 2, unvaluedQty: 0 });
    await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: rose.variant } })).toMatchObject({ deficitQty: 0, unvaluedQty: 0, valuedQty: 0 });
    await refill(rose.variant, 3);
    expect(await stockOf(rose.variant)).toBe(3);
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: rose.variant } })).toMatchObject({ valuedQty: 3, deficitQty: 0, unvaluedQty: 0 });
    const entry = await receiptEntry(rose.variant);
    expect(entry).toMatchObject({ qtyChange: 3, coveredQty: 0 });
    expect(Number(entry.costAdjustment)).toBe(0);
    await assertInventoryInvariants(rose.variant);
  });

  it("an order filled later: the fill covers the deficit, the sale's cost reaches the books, and the finance checks match", async () => {
    const musk = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    await placeOrder([{ variantId: musk.variant, quantity: 2 }], { customerPhone: "01712000022" });
    await refill(musk.variant, 2);
    expect(await stockOf(musk.variant)).toBe(0);
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: musk.variant } })).toMatchObject({ valuedQty: 0, deficitQty: 0, unvaluedQty: 0 });
    const entry = await receiptEntry(musk.variant);
    expect(entry.coveredQty).toBe(2);
    // The bottles' cost (6 ml × 38 + a 50 bottle each) never enters stock — the units are gone — so it is the sale's cost,
    // recognised through 5150 Inventory cost adjustments.
    expect(Number(entry.costAdjustment)).toBe(-2 * (6 * 38 + 50));
    await postPending();
    const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "manufacturing.wip", "ledger.integrity", "events.unposted"] }, OWNER);
    expect(Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]))).toEqual({
      "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "manufacturing.wip": "MATCHED",
      "ledger.integrity": "MATCHED", "events.unposted": "MATCHED",
    });
  });

  it("one cart, an ordinary product and a fill-to-order one: both lines sold and costed", async () => {
    const shirt = await createStockedProduct({ stocks: [3], basePrice: 500 });
    const start = await stockOf(azhaar.variant);
    const order = await placeOrder([{ variantId: shirt.variants[0]!.id, quantity: 1 }, { variantId: azhaar.variant, quantity: 2 }], { customerPhone: "01712000023" });
    expect(await stockOf(shirt.variants[0]!.id)).toBe(2);
    expect(await stockOf(azhaar.variant)).toBe(start - 2);
    const lines = await prisma.orderItem.findMany({ where: { orderId: order.id }, select: { costMovementId: true } });
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.costMovementId)).toBe(true);
    await assertInventoryInvariants(shirt.variants[0]!.id);
    await assertInventoryInvariants(azhaar.variant);
  });

  it("wastage in the floors, and a paid oversell beyond them still settles (stock below the floor)", async () => {
    const lean = await material("Lean oil", "ml");
    await buy(lean, 66, 40);
    const amber = await attar([{ material: () => lean, qty: "6", wastagePct: "10" }]);
    expect(await sells(amber.variant)).toBe(10); // 66 ml at 6.6 ml a bottle
    await expect(placeOrder([{ variantId: amber.variant, quantity: 11 }], { customerPhone: "01712000024" })).rejects.toMatchObject({ statusCode: 409 });
    // Paid against a quote of 6 while 10 could be made; then 5 more sold on the website before the payment settled.
    const input = checkout([{ variantId: amber.variant, quantity: 6 }], { customerPhone: "01712000025" });
    const pricing = await deriveOrderPricing(input, null);
    await placeOrder([{ variantId: amber.variant, quantity: 5 }], { customerPhone: "01712000026" });
    expect(await sells(amber.variant)).toBe(5);
    const paid = await insertOrderRecord(input, { ...pricing, customerId: null }, { status: "CONFIRMED" }, { allowOversell: true });
    trackOrder(paid.id);
    expect(await stockOf(amber.variant)).toBe(-11);
    expect(await sells(amber.variant)).toBe(0);
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: amber.variant } })).toMatchObject({ deficitQty: 11 });
    await assertInventoryInvariants(amber.variant);
  });

  it("a CSV stock count on a fill-to-order variant is refused once costing is live: bottles are Filled or Counted on the Stock page", async () => {
    const a = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    await expect(updateProduct(a.id, { variants: [{ id: a.variant, stock: 1 }] } as never, admin, undefined, { stockMode: "count" })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: "STOCK_VIA_HUB" },
    });
    expect(await stockOf(a.variant)).toBe(0);
  });
});

// A fill-to-order bottle sold before any was ever filled carries its recipe's standard cost (materials' averages) from the
// sale: the line is costed, the deficit is an unbooked layer at that cost, the fill posts only actual − provisional, and
// the delivery books the cost of goods once — no "missing cost", nothing costed twice.
describe("fill to order — the recipe cost at sale time", () => {
  let key = 0;
  const RECIPE = 6 * 38 + 50; // 6 ml oil at 38 + one 6 ml bottle at 50
  const refill = (variantId: string, quantity: number) => quickRefill({ variantId, quantity }, OWNER, `fto-recipe-${RUN}-${++key}`);
  async function postPending() {
    for (let round = 0; round < 10; round++) {
      const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
      if (!waiting.length) return;
      for (const e of waiting) await processFinancialEvent(e.id);
    }
  }
  async function balance(mappingKey: string, partyId?: string) {
    const { business } = await getFinanceContext();
    const accountId = (await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key: mappingKey } } })).accountId;
    const lines = await prisma.journalLine.findMany({ where: { accountId, entry: { status: "POSTED", businessId: business.id }, ...(partyId ? { partyId } : {}) } });
    return Math.round(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) * 100) / 100;
  }
  async function checks() {
    await postPending();
    const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "inventory.order_cost_links", "manufacturing.wip", "ledger.integrity", "events.unposted"] }, OWNER);
    return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
  }
  const ALL_MATCHED = {
    "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "inventory.order_cost_links": "MATCHED",
    "manufacturing.wip": "MATCHED", "ledger.integrity": "MATCHED", "events.unposted": "MATCHED",
  };
  async function deliver(orderId: string) {
    for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const) await updateOrderStatus(orderId, { status: s }, admin);
    await projectOrder(orderId);
    await postPending();
  }

  it("order 2 unfilled → costed at the recipe; fill 2 → 5150 unchanged; deliver → cost of goods once, no missing cost; checks match", async () => {
    const oud = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    await postPending();
    const adjBefore = await balance("cogs.cost_adjustments");
    const order = await placeOrder([{ variantId: oud.variant, quantity: 2 }], { customerPhone: "01712000031" });
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id }, select: { unitCostSnapshot: true, unitCostSource: true, costMovementId: true } });
    expect(line).toMatchObject({ unitCostSnapshot: RECIPE * 100, unitCostSource: "INVENTORY_PROVISIONAL", costMovementId: expect.any(String) });
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: oud.variant } })).toMatchObject({ deficitQty: 2, deficitLayers: [{ qty: 2, unitCostMinor: RECIPE * 100, unbooked: true }] });
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore); // nothing set aside at the sale

    await refill(oud.variant, 2);
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: oud.variant } })).toMatchObject({ deficitQty: 0, deficitLayers: [], valuedQty: 0 });
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore); // actual − provisional = 0 at unchanged prices

    await deliver(order.id);
    expect(-(await balance("asset.inventory", order.id))).toBe(2 * RECIPE);
    expect(await balance("cogs.goods", order.id)).toBe(2 * RECIPE); // once
    expect(await prisma.financeException.count({ where: { orderId: order.id, kind: "MISSING_COST" } })).toBe(0);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore);
    expect(await checks()).toEqual(ALL_MATCHED);
    await assertInventoryInvariants(oud.variant);
  });

  it("a fill at a different cost posts only the difference to 5150", async () => {
    const cedar = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    await postPending();
    const adjBefore = await balance("cogs.cost_adjustments");
    await placeOrder([{ variantId: cedar.variant, quantity: 1 }], { customerPhone: "01712000032" });
    // Really used 7 ml for the bottle: 1 ml of oil (38) more than the recipe.
    await quickRefill({ variantId: cedar.variant, quantity: 1, used: [{ materialVariantId: oil, quantity: 7 }, { materialVariantId: bottle6, quantity: 1 }] }, OWNER, `fto-recipe-${RUN}-${++key}`);
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore + 38);
  });

  it("cancel before the fill: the deficit nets at the same provisional cost, nothing posted, the next fill is stock", async () => {
    const teak = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    await postPending();
    const adjBefore = await balance("cogs.cost_adjustments");
    const order = await placeOrder([{ variantId: teak.variant, quantity: 2 }], { customerPhone: "01712000033" });
    await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: teak.variant } })).toMatchObject({ deficitQty: 0, deficitLayers: [], unvaluedQty: 0, valuedQty: 0 });
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore);
    await refill(teak.variant, 1);
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: teak.variant } })).toMatchObject({ valuedQty: 1, deficitQty: 0 });
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore);
  });

  it("unvalued bottles on hand (a cancelled never-costed sale came back) still sell at the recipe — no missing cost", async () => {
    // ZAYAN, 26 Oct 2026: a bottle back from a cancelled order sits unvalued; the next sale took it at no cost and raised
    // a missing cost, again and again. With no average the recipe's standard cost applies whatever is on hand.
    const amber = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    await postPending();
    const found = await prisma.$transaction((tx) => adjustVariantStockInTx(tx, amber.variant, 1, "ADJUSTMENT", admin, "back on the shelf", { unvaluedGain: true }));
    afterAdjustment(found);
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: amber.variant } })).toMatchObject({ unvaluedQty: 1, valuedQty: 0 }); // no average
    const order = await placeOrder([{ variantId: amber.variant, quantity: 1 }], { customerPhone: "01712000034" });
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id }, select: { unitCostSnapshot: true, unitCostSource: true } });
    expect(line).toMatchObject({ unitCostSnapshot: RECIPE * 100, unitCostSource: "INVENTORY_PROVISIONAL" });
    await deliver(order.id);
    expect(await prisma.financeException.count({ where: { orderId: order.id, kind: "MISSING_COST" } })).toBe(0);
    expect(await balance("cogs.goods", order.id)).toBe(RECIPE);
    expect(await checks()).toEqual(ALL_MATCHED);
    await assertInventoryInvariants(amber.variant);
  });
});

// After the first fill a fill-to-order variant has a moving average — and selling beyond its filled bottles is still the
// normal attar path. Those deficit units are the same UNBOOKED layer, at the average: nothing posts to 5150 at the sale,
// the fill posts only actual − provisional, so a month end between the sale and the fill never shifts profit.
describe("fill to order — selling beyond filled bottles once the variant has an average", () => {
  let key = 0;
  const RECIPE = 6 * 38 + 50; // 278
  const REAL = 7 * 38 + 50; // 316: bottles really filled with 7 ml
  const fill = (variantId: string, quantity: number, ml = 7) =>
    quickRefill({ variantId, quantity, used: [{ materialVariantId: oil, quantity: ml * quantity }, { materialVariantId: bottle6, quantity }] }, OWNER, `fto-avg-${RUN}-${++key}`);
  async function postPending() {
    for (let round = 0; round < 10; round++) {
      const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
      if (!waiting.length) return;
      for (const e of waiting) await processFinancialEvent(e.id);
    }
  }
  async function balance(mappingKey: string) {
    const { business } = await getFinanceContext();
    const accountId = (await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key: mappingKey } } })).accountId;
    const lines = await prisma.journalLine.findMany({ where: { accountId, entry: { status: "POSTED", businessId: business.id } } });
    return Math.round(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) * 100) / 100;
  }
  /** Net profit so far (income − costs) over every posted line: what a month end would report. */
  async function profit() {
    const { business } = await getFinanceContext();
    const lines = await prisma.journalLine.findMany({ where: { entry: { status: "POSTED", businessId: business.id }, account: { type: { in: ["REVENUE", "COGS", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"] } } } });
    return Math.round(lines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0) * 100) / 100;
  }
  async function checks() {
    await postPending();
    const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "inventory.order_cost_links", "manufacturing.wip", "ledger.integrity", "events.unposted"] }, OWNER);
    return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
  }
  const ALL_MATCHED = {
    "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "inventory.order_cost_links": "MATCHED",
    "manufacturing.wip": "MATCHED", "ledger.integrity": "MATCHED", "events.unposted": "MATCHED",
  };
  const costState = (variantId: string) => prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId } });
  /** A fresh attar that has been filled once and sold out: it has an average (REAL) and no bottles. */
  async function soldOutAfterFirstFill(phone: string) {
    const a = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    await fill(a.variant, 1);
    await placeOrder([{ variantId: a.variant, quantity: 1 }], { customerPhone: phone });
    const s = await costState(a.variant);
    expect(s).toMatchObject({ valuedQty: 0, deficitQty: 0 });
    expect(Number(s.avgUnitCost)).toBe(REAL);
    return a;
  }

  it("order 2 beyond filled stock → unbooked layer at the average, 5150 untouched; the fill at the same price leaves 5150 and profit unchanged", async () => {
    const a = await soldOutAfterFirstFill("01712000041");
    expect(await checks()).toEqual(ALL_MATCHED);
    const adjBefore = await balance("cogs.cost_adjustments");
    const profitBefore = await profit();

    const order = await placeOrder([{ variantId: a.variant, quantity: 2 }], { customerPhone: "01712000042" });
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id }, select: { unitCostSnapshot: true, unitCostSource: true } });
    expect(line).toMatchObject({ unitCostSnapshot: REAL * 100, unitCostSource: "INVENTORY_PROVISIONAL" }); // the average, not the recipe (278)
    expect(await costState(a.variant)).toMatchObject({ deficitQty: 2, deficitLayers: [{ qty: 2, unitCostMinor: REAL * 100, unbooked: true }] });
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore); // nothing set aside at the sale
    const profitAtMonthEnd = await profit(); // a month end falls here, between the sale and the fill
    expect(profitAtMonthEnd).toBe(profitBefore);

    await fill(a.variant, 2); // same 7 ml a bottle → actual = provisional
    expect(await costState(a.variant)).toMatchObject({ deficitQty: 0, deficitLayers: [], valuedQty: 0 });
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore);
    expect(await profit()).toBe(profitAtMonthEnd); // the next month sees no shift
    await assertInventoryInvariants(a.variant);
  });

  it("a fill at a different cost posts only actual − average", async () => {
    const a = await soldOutAfterFirstFill("01712000043");
    await postPending();
    const adjBefore = await balance("cogs.cost_adjustments");
    await placeOrder([{ variantId: a.variant, quantity: 1 }], { customerPhone: "01712000044" });
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore);
    await fill(a.variant, 1, 6); // 278 really, provisional 316
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore - (REAL - RECIPE));
  });

  it("cancel before the fill nets the unbooked layer at zero", async () => {
    const a = await soldOutAfterFirstFill("01712000045");
    await postPending();
    const adjBefore = await balance("cogs.cost_adjustments");
    const profitBefore = await profit();
    const order = await placeOrder([{ variantId: a.variant, quantity: 2 }], { customerPhone: "01712000046" });
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore);
    await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
    expect(await costState(a.variant)).toMatchObject({ deficitQty: 0, deficitLayers: [], unvaluedQty: 0, valuedQty: 0 });
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore);
    expect(await profit()).toBe(profitBefore);
  });

  it("mixed: 1 filled bottle + an order of 3 → 1 ordinary exit + 2 unbooked; the fill of 2 leaves 5150 unchanged", async () => {
    const a = await attar([{ material: () => oil, qty: "6" }, { material: () => bottle6, qty: "1" }]);
    await fill(a.variant, 1);
    expect(await costState(a.variant)).toMatchObject({ valuedQty: 1 });
    expect(await checks()).toEqual(ALL_MATCHED);
    const adjBefore = await balance("cogs.cost_adjustments");
    const profitBefore = await profit();

    const order = await placeOrder([{ variantId: a.variant, quantity: 3 }], { customerPhone: "01712000047" });
    expect(await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id }, select: { unitCostSnapshot: true, unitCostSource: true } }))
      .toMatchObject({ unitCostSnapshot: REAL * 100, unitCostSource: "INVENTORY_PROVISIONAL" });
    const after = await costState(a.variant);
    expect(after).toMatchObject({ valuedQty: 0, deficitQty: 2, deficitLayers: [{ qty: 2, unitCostMinor: REAL * 100, unbooked: true }] });
    expect(Number(after.value)).toBe(0); // the filled bottle left at its value: an ordinary exit
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore);
    expect(await profit()).toBe(profitBefore);

    await fill(a.variant, 2);
    expect(await costState(a.variant)).toMatchObject({ deficitQty: 0, deficitLayers: [], valuedQty: 0 });
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore);
    expect(await profit()).toBe(profitBefore);
    await assertInventoryInvariants(a.variant);
  });
});
