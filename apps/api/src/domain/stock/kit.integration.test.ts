import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import { recordInitialStock } from "../../modules/inventory/inventory.service";
import type { FinanceActor } from "../finance/finance-audit";
import { createPackingRule } from "../finance/packaging.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";
import { productKit } from "./kit.service";

// A product's kit (docs/STOCK_HUB.md §11): what one sale takes, from the recipe and the packing rules, and what is left.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
const SEE = { canSeeCost: true };
const as = (r: request.Test) => r.set("Cookie", [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);
const material = async (name: string, unit: string, qty: number) => {
  const m = await createMaterial({ name: `Vitest KIT ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `KIT-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, SEE);
  await prisma.$transaction((tx) => recordInitialStock(tx, m.variants[0]!.id, qty, "RESTOCK", { note: "test material" }));
  return m.variants[0]!.id;
};

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureManufacturingSetup(OWNER);
}, 60_000);

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`DELETE FROM "PackingRule" WHERE "materialVariantId" IN (SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.name LIKE 'Vitest KIT %')`);
  });
  await cleanupFixtures();
});

describe("a product's kit", () => {
  it("a filled product: its recipe per size plus the parcel's packing, the part that runs out first, and how many sales are left", async () => {
    const oil = await material("Oil", "ml", 100);
    const bottle6 = await material("Bottle6", "pcs", 30);
    const bottle12 = await material("Bottle12", "pcs", 2);
    const poly = await material("Poly", "pcs", 40);
    const attar = await createStockedProduct({ stocks: [0, 0] });
    const [six, twelve] = attar.variants;
    await approveBom((await createBom({
      productId: attar.product.id,
      lines: [
        { materialVariantId: oil, finishedVariantId: six!.id, qtyPerUnit: "6", wastagePct: "5" }, // 6.3 ml a bottle
        { materialVariantId: bottle6, finishedVariantId: six!.id, qtyPerUnit: "1" },
        { materialVariantId: oil, finishedVariantId: twelve!.id, qtyPerUnit: "12" },
        { materialVariantId: bottle12, finishedVariantId: twelve!.id, qtyPerUnit: "1" },
      ],
    }, OWNER)).id, OWNER);
    await createPackingRule({ scope: "PRODUCT", scopeId: attar.product.id, materialVariantId: poly, quantity: 1, per: "PARCEL" }, OWNER);

    const kit = await productKit(attar.product.id, SEE);
    const s6 = kit.sizes.find((s) => s.variantId === six!.id)!;
    expect(s6.components.map((c) => [c.source, c.perSale, c.enoughFor])).toEqual([
      ["RECIPE", 6.3, 15], // ⌊100 / 6.3⌋
      ["RECIPE", 1, 30],
      ["PACKING", 1, 40],
    ]);
    expect(s6).toMatchObject({ canSell: 15, runsOutFirst: { variantId: oil } });
    const s12 = kit.sizes.find((s) => s.variantId === twelve!.id)!;
    expect(s12).toMatchObject({ canSell: 2, runsOutFirst: { variantId: bottle12 } }); // oil 8, bottles 2
    expect(s12.recipe).not.toBeNull();
    // no stock costing here: no average, so no cost — never a guessed one
    expect(s6.kitCost).toBeNull();
    expect(s6.components.every((c) => c.lastPurchase === null)).toBe(true);
  });

  it("a ready-bought product is its own item; over HTTP for inventory.read", async () => {
    const cap = await createStockedProduct({ stocks: [7] });
    const kit = await productKit(cap.product.id, SEE);
    expect(kit.sizes[0]!.components[0]).toMatchObject({ source: "ITEM", perSale: 1, stock: 7, enoughFor: 7 });
    const r = await as(request(app).get(`/api/v1/finance/stock/products/${cap.product.id}/kit`));
    expect(r.status).toBe(200);
    expect(r.body.sizes).toHaveLength(1);
  });
});
