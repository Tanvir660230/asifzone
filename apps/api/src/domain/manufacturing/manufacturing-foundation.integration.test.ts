import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS, isPurchasable } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables } from "../../test-fixtures";
import { adjustVariantStock } from "../../modules/inventory/inventory.service";
import { listProducts } from "../../modules/products/product.service";
import { getFinanceContext } from "../finance/finance-context";
import { financeTransaction } from "../finance/finance-tx";
import { recordValuationInTx } from "../finance/costing.service";
import { createSupplier } from "../finance/suppliers.service";
import { searchPurchasableVariants } from "../finance/purchase-orders.service";
import type { FinanceActor } from "../finance/finance-audit";
import { DEFAULT_COST_CATEGORIES, MATERIALS_CATEGORY_SLUG, ensureManufacturingSetup, listCostCategories, manufacturingStatus } from "./manufacturing-setup.service";
import { archiveMaterial, createMaterial, listMaterials, restoreMaterial, updateMaterial } from "./materials.service";
import { approveBom, copyBom, createBom, updateBom } from "./boms.service";
import { approveProductionOrder, cancelProductionOrder, createProductionOrder, getProductionOrder, reopenProductionOrder, updateProductionOrder } from "./production-orders.service";

// Manufacturing M1 (docs/MANUFACTURING.md): set-up, materials that are never sold, versioned BOMs, production orders planned
// per variant with exact material requirements, approval snapshots of material cost, and the database's lifecycle guards.

let OWNER: FinanceActor;
let STAFF: FinanceActor;
const SEE = { canSeeCost: true };
let fabric: { productId: string; navy: string; black: string };
let label = "";
let cap: { productId: string; S: string; M: string; L: string };
let producerId = "";
let bomId = "";
let moId = "";
let cmtId = "";

beforeAll(async () => {
  await purgeFinanceTables();
  const owner = await ownerId();
  OWNER = { type: "ADMIN", adminId: owner, label: "owner@test", permissions: [...PERMISSIONS] };
  STAFF = { type: "ADMIN", adminId: owner, label: "staff@test", permissions: PERMISSIONS.filter((p) => p !== "manufacturing.approve" && p !== "costing.read") };
  await getFinanceContext();
  const p = await createStockedProduct({ stocks: [0, 0, 0], basePrice: 900 });
  cap = { productId: p.product.id, S: p.variants[0]!.id, M: p.variants[1]!.id, L: p.variants[2]!.id };
  producerId = (await createSupplier({ legalName: "Gazipur Caps Factory", paymentTermsDays: 15 } as never, OWNER)).id;
}, 60_000);

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %'`);
  });
  await cleanupFixtures();
});

describe("set-up", () => {
  it("provisions WIP, accrued production costs and production losses, the default cost categories and a hidden materials category — idempotently", async () => {
    const first = await ensureManufacturingSetup(OWNER);
    const again = await ensureManufacturingSetup(OWNER);
    expect(again.changes).toEqual([]);
    expect(first.missing).toEqual([]);
    const s = await manufacturingStatus();
    expect(s.readiness.ready).toBe(true);
    const { business } = await getFinanceContext();
    const wip = await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key: "asset.wip" } }, include: { account: true } });
    expect(wip.account.code).toBe("1630");
    expect((await listCostCategories()).categories).toHaveLength(DEFAULT_COST_CATEGORIES.length);
    expect(await prisma.category.findUniqueOrThrow({ where: { slug: MATERIALS_CATEGORY_SLUG } })).toMatchObject({ isActive: false });
    cmtId = (await prisma.productionCostCategory.findFirstOrThrow({ where: { code: "CMT" } })).id;
    await expect(prisma.productionCostCategory.delete({ where: { id: cmtId } })).rejects.toThrow(/never deleted/);
  });
});

describe("materials", () => {
  it("are stock-tracked products of kind MATERIAL that can never be sold or shown", async () => {
    const m = await createMaterial({ name: "Vitest Cotton twill", stockUnit: "cm", referenceCost: 0.12, variants: [{ sku: `VT-TWILL-NAVY-${Date.now()}`, spec: "150 cm wide", color: "Navy" }, { sku: `VT-TWILL-BLK-${Date.now()}`, spec: "150 cm wide", color: "Black" }] }, OWNER, SEE);
    fabric = { productId: m.id, navy: m.variants[0]!.id, black: m.variants[1]!.id };
    const row = await prisma.product.findUniqueOrThrow({ where: { id: m.id }, include: { variants: true } });
    expect(row).toMatchObject({ kind: "MATERIAL", isActive: false, status: "DRAFT", trackInventory: true, stockUnit: "cm" });
    expect(isPurchasable(row, row.variants[0])).toBe(false);
    await expect(prisma.product.update({ where: { id: m.id }, data: { isActive: true, status: "PUBLISHED" } })).rejects.toThrow(/Product_material_never_sold/);
    const catalog = await listProducts({ page: 1, pageSize: 100, search: "Vitest Cotton twill" } as never);
    expect(catalog.items.map((p: { id: string }) => p.id)).not.toContain(m.id);
    // …but it is bought like any stock item
    expect((await searchPurchasableVariants({ q: "Vitest Cotton", take: 20 })).variants.map((v) => v.id)).toContain(fabric.navy);
    const l = await createMaterial({ name: "Vitest Woven label", stockUnit: "pcs", variants: [{ sku: `VT-LABEL-${Date.now()}`, spec: "Standard" }] }, OWNER, SEE);
    label = l.variants[0]!.id;
  });

  it("keep their stock unit once they hold stock; costs are hidden without costing.read", async () => {
    await adjustVariantStock(fabric.navy, 10, "RESTOCK", (OWNER as { adminId: string }).adminId, "opening roll");
    await expect(updateMaterial(fabric.productId, { stockUnit: "m" }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409 });
    const hidden = await listMaterials({ q: "Vitest Cotton" }, { canSeeCost: false });
    expect(hidden.materials[0]!.referenceCost).toBeNull();
    const seen = await listMaterials({ q: "Vitest Cotton" }, SEE);
    expect(seen.materials[0]!.referenceCost).toBe(0.12);
  });
});

describe("bills of materials", () => {
  it("validate lines, approve (approvers only) and freeze; a change is a new version", async () => {
    await expect(createBom({ productId: cap.productId, lines: [{ materialVariantId: cap.S, qtyPerUnit: "1" }] }, OWNER)).rejects.toMatchObject({ statusCode: 400 }); // its own variant
    await expect(createBom({ productId: fabric.productId, lines: [{ materialVariantId: label, qtyPerUnit: "1" }] }, OWNER)).rejects.toMatchObject({ statusCode: 400 }); // a material has no BOM
    const bom = await createBom({
      productId: cap.productId,
      name: "Classic cap",
      lines: [
        { materialVariantId: fabric.navy, qtyPerUnit: "37.5", wastagePct: "4" },
        { materialVariantId: fabric.navy, finishedVariantId: cap.L, qtyPerUnit: "5.5", wastagePct: "4" },
        { materialVariantId: label, qtyPerUnit: "1", suppliedBy: "PRODUCER" },
      ],
    }, OWNER);
    expect(bom).toMatchObject({ version: 1, status: "DRAFT" });
    bomId = bom.id;
    await updateBom(bomId, { notes: "v1" }, OWNER);
    await expect(approveBom(bomId, STAFF)).rejects.toMatchObject({ statusCode: 403 });
    expect((await approveBom(bomId, OWNER)).status).toBe("APPROVED");
    await expect(updateBom(bomId, { notes: "late" }, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await expect(prisma.billOfMaterialsLine.updateMany({ where: { bomId }, data: { qtyPerUnit: "1" } })).rejects.toThrow(/frozen/);
    const v2 = await copyBom(bomId, OWNER);
    expect(v2).toMatchObject({ version: 2, status: "DRAFT" });
    expect(v2.lines).toHaveLength(3);
  });

  it("approving a new version archives the one approved before it — one approved recipe per product", async () => {
    const other = await createStockedProduct({ stocks: [0], basePrice: 400 });
    const v1 = await createBom({ productId: other.product.id, lines: [{ materialVariantId: label, qtyPerUnit: "1" }] }, OWNER);
    await approveBom(v1.id, OWNER);
    const v2 = await copyBom(v1.id, OWNER);
    expect((await approveBom(v2.id, OWNER)).status).toBe("APPROVED");
    const rows = await prisma.billOfMaterials.findMany({ where: { productId: other.product.id }, orderBy: { version: "asc" }, select: { version: true, status: true, archivedAt: true } });
    expect(rows.map((r) => [r.version, r.status])).toEqual([[1, "ARCHIVED"], [2, "APPROVED"]]);
    expect(rows[0]!.archivedAt).not.toBeNull();
  });
});

describe("materials — edit and archive", () => {
  it("rename a size's SKU, spec or colour in place; a SKU already used is refused", async () => {
    const sku = `VT-LABEL-RN-${Date.now()}`;
    const m = await updateMaterial((await prisma.productVariant.findUniqueOrThrow({ where: { id: label } })).productId, { variants: [{ id: label, sku, spec: "Woven 2 cm" }] }, OWNER, SEE);
    expect(m.variants.find((v) => v.id === label)).toMatchObject({ sku, spec: "Woven 2 cm" });
    const navySku = (await prisma.productVariant.findUniqueOrThrow({ where: { id: fabric.navy } })).sku;
    await expect(updateMaterial(m.id, { variants: [{ id: label, sku: navySku.toLowerCase() }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409 });
    await expect(updateMaterial(m.id, { variants: [{ id: fabric.navy, spec: "x" }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 400 }); // not its size
  });

  it("archive only an unused material with no stock; it leaves the list and can come back", async () => {
    await expect(archiveMaterial(fabric.productId, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409, details: { code: "MATERIAL_HAS_STOCK" } });
    const labelProduct = (await prisma.productVariant.findUniqueOrThrow({ where: { id: label } })).productId;
    await expect(archiveMaterial(labelProduct, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409, details: { code: "MATERIAL_IN_RECIPE" } });
    const spare = await createMaterial({ name: "Vitest Spare thread", stockUnit: "m", variants: [{ sku: `VT-THREAD-${Date.now()}`, spec: "Black" }] }, OWNER, SEE);
    expect((await archiveMaterial(spare.id, OWNER, SEE)).archived).toBe(true);
    expect((await listMaterials({ q: "Vitest Spare thread" }, SEE)).materials).toHaveLength(0);
    expect((await listMaterials({ q: "Vitest Spare thread", includeArchived: true }, SEE)).materials[0]!.archived).toBe(true);
    expect((await restoreMaterial(spare.id, OWNER, SEE)).archived).toBe(false);
  });
});

describe("production orders", () => {
  it("plan per variant; requirements come exactly from the BOM, rounded up to whole stock units", async () => {
    const mo = await createProductionOrder({
      productId: cap.productId,
      producerSupplierId: producerId,
      bomId,
      expectedDate: "2026-12-31",
      terms: "৳45 per piece CMT, 50% advance",
      lines: [{ variantId: cap.S, plannedQty: 400 }, { variantId: cap.M, plannedQty: 600 }, { variantId: cap.L, plannedQty: 100 }],
      extraMaterials: [{ materialVariantId: fabric.black, plannedQty: 500 }],
      plannedCosts: [{ categoryId: cmtId, amount: 49_500, basis: "1,100 pcs × ৳45" }],
    }, OWNER, SEE);
    moId = mo.id;
    expect(mo.number).toMatch(/^MO-\d{6}$/);
    expect(mo.plannedUnits).toBe(1100);
    const navy = mo.materials.find((m) => m.materialVariantId === fabric.navy)!;
    // ⌈1,100 × 37.5 × 1.04 + 100 × 5.5 × 1.04⌉ = ⌈42,900 + 572⌉
    expect(navy).toMatchObject({ suppliedBy: "BUSINESS", plannedQty: 43_472, fromBom: true });
    expect(mo.materials.find((m) => m.materialVariantId === label)).toMatchObject({ suppliedBy: "PRODUCER", plannedQty: 1100 });
    expect(mo.materials.find((m) => m.materialVariantId === fabric.black)).toMatchObject({ plannedQty: 500, fromBom: false });
    expect(mo.planned).toMatchObject({ otherCost: 49_500, materialsWithoutCost: 2 });
    await expect(createProductionOrder({ productId: cap.productId, lines: [{ variantId: fabric.navy, plannedQty: 1 }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 400 });
    await expect(createProductionOrder({ productId: cap.productId, bomId: (await prisma.billOfMaterials.findFirstOrThrow({ where: { productId: cap.productId, version: 2 } })).id, lines: [{ variantId: cap.S, plannedQty: 1 }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409 }); // draft BOM
  });

  it("a draft is re-planned on edit; approval needs an approver and snapshots material averages as the planned cost", async () => {
    const edited = await updateProductionOrder(moId, { lines: [{ variantId: cap.S, plannedQty: 400 }, { variantId: cap.M, plannedQty: 600 }] }, OWNER, SEE);
    expect(edited.materials.find((m) => m.materialVariantId === fabric.navy)!.plannedQty).toBe(39_000); // L removed
    // the navy roll gets a known average: 10 cm on hand at 0.10 / cm (a valuation entry, as the cutover would write)
    const ctx = await getFinanceContext();
    await financeTransaction(async (tx) => {
      await recordValuationInTx(tx, { business: ctx.business, brandId: ctx.brand.id, variantId: fabric.navy, sourceType: "Cutover", sourceId: "test", financialDate: "2026-10-15", op: { type: "CUTOVER", qty: 10, valueMinor: 100 } });
    });
    await expect(approveProductionOrder(moId, STAFF, SEE)).rejects.toMatchObject({ statusCode: 403 });
    const approved = await approveProductionOrder(moId, OWNER, SEE);
    expect(approved.status).toBe("APPROVED");
    const navy = approved.materials.find((m) => m.materialVariantId === fabric.navy)!;
    expect(navy.plannedUnitCost).toBe(0.1);
    expect(navy.plannedCost).toBe(3900); // 39,000 cm × 0.10
    expect(approved.planned).toMatchObject({ materialCost: 3900, otherCost: 49_500, totalCost: 53_400, materialsWithoutCost: 1 });
    expect((await getProductionOrder(moId, { canSeeCost: false })).planned).toBeNull();
  });

  it("an approved plan is frozen by the database; reopen, cancel and illegal transitions follow the lifecycle", async () => {
    await expect(updateProductionOrder(moId, { notes: "x" }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409 });
    await expect(prisma.productionOrderLine.updateMany({ where: { productionOrderId: moId }, data: { plannedQty: 1 } })).rejects.toThrow(/frozen/);
    await expect(prisma.productionOrder.update({ where: { id: moId }, data: { status: "CLOSED" } })).rejects.toThrow(/can't go from APPROVED to CLOSED/);
    const reopened = await reopenProductionOrder(moId, OWNER, SEE);
    expect(reopened.status).toBe("DRAFT");
    expect(reopened.materials.every((m) => m.plannedUnitCost === null)).toBe(true);
    const cancelled = await cancelProductionOrder(moId, "design changed", OWNER, SEE);
    expect(cancelled.status).toBe("CANCELLED");
    await expect(prisma.productionOrder.update({ where: { id: moId }, data: { notes: "x" } })).rejects.toThrow(/final/);
  });
});

describe("over HTTP (schemas and routes)", () => {
  it("accepts decimal strings for quantities per unit and wastage, and refuses more decimals than allowed", async () => {
    const owner = await asOwner();
    const ok = await owner.post("/api/v1/manufacturing/boms", { productId: cap.productId, name: "http", lines: [{ materialVariantId: fabric.navy, qtyPerUnit: "37.5", wastagePct: "4", suppliedBy: "BUSINESS" }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.lines[0]).toMatchObject({ qtyPerUnit: "37.5", wastagePct: "4" });
    const bad = await owner.post("/api/v1/manufacturing/boms", { productId: cap.productId, lines: [{ materialVariantId: fabric.navy, qtyPerUnit: "1.1234567" }] });
    expect(bad.status).toBe(400);
    const products = await owner.get("/api/v1/manufacturing/products?q=Vitest%20P1");
    expect(products.status).toBe(200);
    expect(products.body.products.some((p: { id: string }) => p.id === cap.productId)).toBe(true);
    expect(products.body.products.some((p: { id: string }) => p.id === fabric.productId)).toBe(false); // materials aren't produced
  });
});
