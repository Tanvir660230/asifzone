import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN, stockOf } from "../../test-fixtures";
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
import { fillToOrderFloors } from "../../domain/stock/fill-capacity.service";
import { recordSale } from "../inventory/inventory.service";
import { getProductBySlug } from "../products/product.service";
import { quoteCart } from "../../domain/pricing/pricing.service";
import { updateOrderStatus } from "./order.service";

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
