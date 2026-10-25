import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";
import { economics, productCostSheet, productCosts, saveCostProfile, type LinePlan } from "./cost-sheet.service";

// Cost & profit planning (docs/COST_SHEET.md). The attar figures are the live shop's (2026-10-25): oil ৳38/ml, 6 ml
// bottle ৳50, box ৳50, sticker ৳0.50; Steadfast Dhaka ৳55, outside ৳115, COD 1%, a return keeps the fee. By hand.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
let attar: { productId: string; categoryId: string; six: string; twelve: string };
const as = (r: request.Test) => r.set("Cookie", [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureManufacturingSetup(OWNER);
  const { business } = await getFinanceContext();
  await prisma.courierRateCard.create({ data: { businessId: business.id, effectiveFrom: new Date("2026-08-01"), zones: [{ name: "Inside Dhaka", districts: ["Dhaka"], areas: [], charge: 55 }], defaultCharge: 115, codPercent: 1, returnChargePercent: 100 } });
  const mat = async (name: string, unit: string, ref: number) => (await createMaterial({ name: `Vitest CS ${name} ${RUN}`, stockUnit: unit, referenceCost: ref, variants: [{ sku: `CS-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
  const [oil, b6, b12, box, sticker] = [await mat("Oil", "ml", 38), await mat("Bottle6", "pcs", 50), await mat("Bottle12", "pcs", 52), await mat("Box", "pcs", 50), await mat("Sticker", "pcs", 0.5)];
  const p = await createStockedProduct({ stocks: [0, 0], basePrice: 999, variantPrices: [999, 1599] });
  attar = { productId: p.product.id, categoryId: p.categoryId, six: p.variants[0]!.id, twelve: p.variants[1]!.id };
  const bom = await createBom({
    productId: attar.productId,
    lines: [
      { materialVariantId: oil, finishedVariantId: attar.six, qtyPerUnit: "6" },
      { materialVariantId: b6, finishedVariantId: attar.six, qtyPerUnit: "1" },
      { materialVariantId: oil, finishedVariantId: attar.twelve, qtyPerUnit: "12" },
      { materialVariantId: b12, finishedVariantId: attar.twelve, qtyPerUnit: "1" },
      { materialVariantId: box, qtyPerUnit: "1" },
      { materialVariantId: sticker, qtyPerUnit: "1" },
    ],
  }, OWNER);
  await approveBom(bom.id, OWNER);
}, 60_000);

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest CS %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest CS %'`);
  });
  await cleanupFixtures();
});

describe("economics (pure)", () => {
  it("adds fixed and percent lines, leaves an unknown cost out of the total and refuses a suggested price for it", () => {
    const line = (kind: LinePlan["kind"], fixed: number | null, percent = 0): LinePlan => ({ kind, label: kind, from: "AUTO", mode: "AUTO", fixed, percent, how: "", estimate: false });
    const e = economics([line("MAKING", 32_850), line("COURIER", 9_100), line("PAYMENT_FEE", 0, 1), line("ADS", 12_000)], 99_900, 35);
    expect(e).toMatchObject({ total: 32_850 + 9_100 + 999 + 12_000, profit: 99_900 - 54_949, complete: true, breakEvenAds: 99_900 - 42_949 });
    expect(e.suggestedPrice).toBe(Math.ceil((32_850 + 9_100 + 12_000) / 0.64));
    const unknown = economics([line("MAKING", null), line("COURIER", 9_100)], 99_900, 35);
    expect(unknown).toMatchObject({ complete: false, unknown: ["MAKING"], suggestedPrice: null, total: 9_100 });
  });
});

describe("a product's cost sheet", () => {
  it("works out every line from the recipe, the rate card and the shop's assumptions", async () => {
    await saveCostProfile("BUSINESS", "", { insideDhakaPct: 40, returnRatePct: 4, targetMarginPct: 35, lines: [] }, OWNER);
    const sheet = await productCostSheet(attar.productId);
    const six = sheet.sizes.find((s) => s.variantId === attar.six)!;
    const amount = (k: string) => six.lines.find((l) => l.kind === k)!.amount;
    expect(amount("MAKING")).toBe(328.5); // 6 × 38 + 50 + 50 + 0.50 — reference costs, so an estimate
    expect(six.lines.find((l) => l.kind === "MAKING")!.estimate).toBe(true);
    expect(amount("COURIER")).toBe(91); // 40% × 55 + 60% × 115
    expect(amount("PAYMENT_FEE")).toBe(9.99); // 1% of 999, all cash on delivery
    expect(amount("RETURN_RESERVE")).toBe(3.64); // 4% × 91
    expect(amount("PACKAGING")).toBe(0);
    expect(amount("ADS")).toBe(0); // no ad spend recorded
    expect(six).toMatchObject({ price: 999, total: 433.13, profit: 565.87, marginPct: 56.64, complete: true, suggestedPrice: 661.16, belowTarget: false });
    expect(sheet.sizes.find((s) => s.variantId === attar.twelve)!.lines.find((l) => l.kind === "MAKING")!.amount).toBe(558.5);
    expect(sheet.assumptions.insideDhakaPct).toEqual({ value: 40, from: "BUSINESS" });
  });

  it("the nearest level wins: a size's own line, then the product's, the category's, the shop's", async () => {
    await saveCostProfile("CATEGORY", attar.categoryId, { lines: [{ kind: "ADS", mode: "FIXED", amount: 120 }] }, OWNER);
    await saveCostProfile("PRODUCT", attar.productId, { targetMarginPct: 60, lines: [{ kind: "MAKING", variantId: attar.six, mode: "FIXED", amount: 300 }, { kind: "LABOUR", mode: "PERCENT_OF_PRICE", amount: 2 }] }, OWNER);
    const sheet = await productCostSheet(attar.productId);
    const six = sheet.sizes.find((s) => s.variantId === attar.six)!;
    const twelve = sheet.sizes.find((s) => s.variantId === attar.twelve)!;
    const line = (s: typeof six, k: string) => s.lines.find((l) => l.kind === k)!;
    expect(line(six, "ADS")).toMatchObject({ from: "CATEGORY", amount: 120 });
    expect(line(six, "MAKING")).toMatchObject({ from: "VARIANT", amount: 300 });
    expect(line(twelve, "MAKING")).toMatchObject({ from: "AUTO", amount: 558.5 });
    expect(line(six, "LABOUR")).toMatchObject({ from: "PRODUCT", amount: 19.98 });
    // 999 − (300 + 91 + 9.99 + 3.64 + 120 + 19.98) = 454.39 → 45.48%, below the product's own 60% target
    expect(six).toMatchObject({ total: 544.61, profit: 454.39, marginPct: 45.48, belowTarget: true, breakEvenAds: 574.39 });
    expect(sheet.own?.lines).toHaveLength(2);
    expect((await productCosts()).products.find((p) => p.productId === attar.productId)!.sizes[0]).toMatchObject({ making: 300, belowTarget: true });

    // saving nothing removes the product's own profile; the category's ads stay
    expect((await saveCostProfile("PRODUCT", attar.productId, { lines: [] }, OWNER)).removed).toBe(true);
    expect((await productCostSheet(attar.productId)).sizes[0]!.lines.find((l) => l.kind === "MAKING")!.from).toBe("AUTO");
  });

  it("over HTTP: costing.read sees it, costing.adjust saves; a size of another product is refused", async () => {
    const r = await as(request(app).get(`/api/v1/finance/cost-sheets/products/${attar.productId}`));
    expect(r.status).toBe(200);
    expect(r.body.sizes).toHaveLength(2);
    const bad = await as(request(app).put(`/api/v1/finance/cost-sheets/PRODUCT/${attar.productId}`)).send({ lines: [{ kind: "MAKING", variantId: "not-a-size", mode: "FIXED", amount: 1 }] });
    expect(bad.status).toBe(400);
    const noAmount = await as(request(app).put(`/api/v1/finance/cost-sheets/BUSINESS`)).send({ lines: [{ kind: "ADS", mode: "FIXED" }] });
    expect(noAmount.status).toBe(400);
    expect((await as(request(app).get("/api/v1/finance/cost-sheets/defaults"))).body.shop).toMatchObject({ insideDhakaPct: 40, targetMarginPct: 35 });
  });
});
