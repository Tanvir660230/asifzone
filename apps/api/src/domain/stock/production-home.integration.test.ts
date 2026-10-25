import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import { recordInitialStock } from "../../modules/inventory/inventory.service";
import type { FinanceActor } from "../finance/finance-audit";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial, listMaterials, updateMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";
import { canStillMake, productionHome } from "./production-home.service";

// Production home (docs/STOCK_HUB.md §9) and purchase units (docs/MANUFACTURING.md §3). Expected figures by hand.

let OWNER: FinanceActor;
const SEE = { canSeeCost: true };
const material = async (name: string, unit: string, qty: number) => {
  const m = await createMaterial({ name: `Vitest PH ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `PH-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, SEE);
  if (qty) await prisma.$transaction((tx) => recordInitialStock(tx, m.variants[0]!.id, qty, "RESTOCK", { note: "test material" }));
  return m;
};

beforeAll(async () => {
  await purgeFinanceTables();
  OWNER = { type: "ADMIN", adminId: await ownerId(), label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureManufacturingSetup(OWNER);
}, 60_000);

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("purchase units", () => {
  it("are saved as a list per material, never the stock unit itself, and shown with it", async () => {
    const oil = await material("Oil", "ml", 0);
    const saved = await updateMaterial(oil.id, { purchaseUnits: [{ label: "litre", factor: 1000 }, { label: "tola", factor: 11.6638 }] }, OWNER, SEE);
    expect(saved.purchaseUnits).toEqual([{ label: "litre", factor: 1000 }, { label: "tola", factor: 11.6638 }]);
    expect((await listMaterials({ q: `Vitest PH Oil ${RUN}` }, SEE)).materials[0]!.purchaseUnits).toHaveLength(2);
    await expect(updateMaterial(oil.id, { purchaseUnits: [{ label: "ML", factor: 1 }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 400 });
    // replaced as a whole; an edit without them leaves them (and the description) alone
    await updateMaterial(oil.id, { description: "Dubai" }, OWNER, SEE);
    const kept = await updateMaterial(oil.id, { name: `Vitest PH Oil ${RUN}` }, OWNER, SEE);
    expect(kept).toMatchObject({ description: "Dubai" });
    expect(kept.purchaseUnits).toHaveLength(2);
    expect((await updateMaterial(oil.id, { purchaseUnits: [] }, OWNER, SEE)).purchaseUnits).toEqual([]);
  });
});

describe("can still make", () => {
  it("per size from the latest approved recipe, with the material that runs out first", async () => {
    const oil = await material("Attar oil", "ml", 100);
    const bottle6 = await material("Bottle 6", "pcs", 30);
    const bottle12 = await material("Bottle 12", "pcs", 2);
    const box = await material("Box", "pcs", 50);
    const attar = await createStockedProduct({ stocks: [0, 0] });
    const [six, twelve] = attar.variants;
    await prisma.product.update({ where: { id: attar.product.id }, data: { fillToOrder: true } });
    const bom = await createBom({
      productId: attar.product.id,
      lines: [
        { materialVariantId: oil.variants[0]!.id, finishedVariantId: six!.id, qtyPerUnit: "6", wastagePct: "5" }, // 6.3 ml
        { materialVariantId: bottle6.variants[0]!.id, finishedVariantId: six!.id, qtyPerUnit: "1" },
        { materialVariantId: oil.variants[0]!.id, finishedVariantId: twelve!.id, qtyPerUnit: "12" },
        { materialVariantId: bottle12.variants[0]!.id, finishedVariantId: twelve!.id, qtyPerUnit: "1" },
        { materialVariantId: box.variants[0]!.id, qtyPerUnit: "1" },
      ],
    }, OWNER);
    await approveBom(bom.id, OWNER);
    const rows = (await canStillMake()).filter((r) => r.productId === attar.product.id);
    // 6 ml: oil ⌊100 / 6.3⌋ = 15, bottles 30, boxes 50 → 15, oil first; 12 ml: oil 8, bottles 2 → 2, bottles first
    expect(rows.find((r) => r.variantId === six!.id)).toMatchObject({ canMake: 15, limiting: { variantId: oil.variants[0]!.id, stock: 100, unit: "ml" } });
    expect(rows.find((r) => r.variantId === twelve!.id)).toMatchObject({ canMake: 2, limiting: { variantId: bottle12.variants[0]!.id } });

    // owed bottles and a filled-to-order product without a recipe show under "needs you"
    await prisma.productVariant.update({ where: { id: six!.id }, data: { stock: -3 } });
    const bare = await createStockedProduct({ stocks: [0] });
    await prisma.product.update({ where: { id: bare.product.id }, data: { fillToOrder: true } });
    const home = await productionHome(SEE);
    expect(home.owed.find((o) => o.variantId === six!.id)).toMatchObject({ owed: 3 });
    expect(home.noRecipe.map((p) => p.productId)).toContain(bare.product.id);
    expect(home.noRecipe.map((p) => p.productId)).not.toContain(attar.product.id);
    expect(home.canMake.some((r) => r.variantId === twelve!.id)).toBe(true);
    await prisma.productVariant.update({ where: { id: six!.id }, data: { stock: 0 } });
  });
});
