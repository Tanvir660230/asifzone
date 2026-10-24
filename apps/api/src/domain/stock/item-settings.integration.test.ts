import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS, STOCK_ITEM_DEFAULTS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { getFinanceContext } from "../finance/finance-context";
import { approvePurchaseOrder, createPurchaseOrder, submitPurchaseOrder } from "../finance/purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt, reverseGoodsReceipt } from "../finance/goods-receipts.service";
import { createSupplier } from "../finance/suppliers.service";
import { getItemSettings, lastPurchasePrice, setItemSettings } from "./item-settings.service";

// Smart stock page, task 1: per-item usual supplier, days to arrive and days a reorder covers, and the last price paid.

let OWNER: FinanceActor;
let supplierId = "";
let otherSupplierId = "";
let variant = "";

async function receive(supplier: string, qty: number, unitPrice: number, date: string) {
  const po = await createPurchaseOrder({ supplierId: supplier, lines: [{ lineType: "STOCK", variantId: variant, qtyOrdered: qty, unitPrice }] } as never, OWNER);
  await submitPurchaseOrder(po.id, OWNER);
  const approved = await approvePurchaseOrder(po.id, OWNER);
  const grn = await createGoodsReceipt({ purchaseOrderId: po.id, receiptDate: date, lines: [{ purchaseOrderLineId: approved.lines[0]!.id, qtyAccepted: qty }] } as never, OWNER);
  await postGoodsReceipt(grn.id, {}, OWNER);
  return grn.id;
}

beforeAll(async () => {
  await purgeFinanceTables();
  OWNER = { type: "ADMIN", adminId: await ownerId(), label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  variant = (await createStockedProduct({ stocks: [0], basePrice: 500 })).variants[0]!.id;
  const seed = (await createStockedProduct({ stocks: [5], basePrice: 900 })).variants[0]!.id;
  await saveOpeningInventory([{ variantId: seed, sku: "SET-SEED", name: "seed", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: (await getFinanceContext()).brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  supplierId = (await createSupplier({ legalName: "Vitest Bottle House" } as never, OWNER)).id;
  otherSupplierId = (await createSupplier({ legalName: "Vitest Oil Market" } as never, OWNER)).id;
});

afterAll(async () => {
  await prisma.stockItemSetting.deleteMany({ where: { variantId: variant } });
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("item settings", () => {
  it("S-1: no row → the defaults", async () => {
    expect((await getItemSettings([variant])).get(variant)).toEqual(STOCK_ITEM_DEFAULTS);
  });

  it("S-2: set then get round-trips", async () => {
    const saved = await setItemSettings(variant, { preferredSupplierId: supplierId, leadTimeDays: 5, coverDays: 45 }, OWNER);
    expect(saved).toEqual({ preferredSupplierId: supplierId, leadTimeDays: 5, coverDays: 45 });
    expect((await getItemSettings([variant])).get(variant)).toEqual(saved);
  });

  it("S-3: cover under 7 days is refused", async () => {
    await expect(setItemSettings(variant, { preferredSupplierId: null, leadTimeDays: 3, coverDays: 5 }, OWNER)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("S-4: an unknown supplier is refused", async () => {
    await expect(setItemSettings(variant, { preferredSupplierId: "nope", leadTimeDays: 3, coverDays: 30 }, OWNER)).rejects.toMatchObject({ statusCode: 400, details: { code: "SUPPLIER_NOT_FOUND" } });
  });
});

describe("last purchase price", () => {
  it("P-1: the newest posted receipt line wins; a reversed receipt is ignored", async () => {
    expect((await lastPurchasePrice([variant])).has(variant)).toBe(false);
    await receive(supplierId, 10, 12, "2026-10-01");
    await receive(otherSupplierId, 10, 14, "2026-10-10");
    const reversed = await receive(otherSupplierId, 10, 99, "2026-10-20");
    await reverseGoodsReceipt(reversed, "wrong goods", OWNER);
    expect((await lastPurchasePrice([variant])).get(variant)).toEqual({ unitCost: 14, supplierId: otherSupplierId, date: "2026-10-10" });
  });
});
