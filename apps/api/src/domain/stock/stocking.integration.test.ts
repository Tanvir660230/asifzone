import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";
import { getStocking, setStocking } from "./stocking.service";

// How it's stocked (docs/STOCK_HUB.md §8): ready ↔ filled to order, and a never-sold product → material. Only the setting
// changes; the guards keep owed bottles and sold products where they are.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
const as = (r: request.Test) => r.set("Cookie", [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);
const why = { reason: "owner decision" };

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureManufacturingSetup(OWNER);
}, 60_000);

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("how it's stocked", () => {
  it("ready → filled to order warns until a recipe is approved, and back to ready resets the selling rule", async () => {
    const p = await createStockedProduct({ stocks: [3, 2] });
    expect((await getStocking(p.product.id)).mode).toBe("READY");
    const on = await setStocking(p.product.id, { mode: "FILLED_TO_ORDER", ...why }, OWNER);
    expect(on).toMatchObject({ mode: "FILLED_TO_ORDER", changed: true, hasApprovedRecipe: false });
    expect(on.warning).toMatch(/Add a recipe/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.product.id } })).fillToOrder).toBe(true);

    const bottle = (await createMaterial({ name: `Vitest Stocking bottle ${RUN}`, stockUnit: "pcs", variants: [{ sku: `STK-BTL-${RUN}`, spec: "6 ml" }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
    await approveBom((await createBom({ productId: p.product.id, lines: [{ materialVariantId: bottle, qtyPerUnit: "1" }] }, OWNER)).id, OWNER);
    expect((await getStocking(p.product.id)).hasApprovedRecipe).toBe(true);

    await prisma.product.update({ where: { id: p.product.id }, data: { stockPolicy: "UNLIMITED" } });
    const off = await setStocking(p.product.id, { mode: "READY", ...why }, OWNER);
    expect(off).toMatchObject({ mode: "READY", changed: true, warning: null });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: p.product.id }, select: { fillToOrder: true, stockPolicy: true } })).toEqual({ fillToOrder: false, stockPolicy: "TRACKED" });
    // a product with a recipe can't become a material
    expect((await getStocking(p.product.id)).blocked.MATERIAL).toMatch(/recipe/);
    // the same mode again changes nothing
    expect((await setStocking(p.product.id, { mode: "READY", ...why }, OWNER)).changed).toBe(false);
  });

  it("bottles owed keep it filled to order", async () => {
    const p = await createStockedProduct({ stocks: [0] });
    await setStocking(p.product.id, { mode: "FILLED_TO_ORDER", ...why }, OWNER);
    await prisma.productVariant.update({ where: { id: p.variants[0]!.id }, data: { stock: -2 } });
    expect((await getStocking(p.product.id)).owed).toBe(2);
    await expect(setStocking(p.product.id, { mode: "READY", ...why }, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await prisma.productVariant.update({ where: { id: p.variants[0]!.id }, data: { stock: 0 } });
  });

  it("only a product never ordered becomes a material — inactive, unpublished, with its unit — and stays one", async () => {
    const sold = await createStockedProduct({ stocks: [5] });
    await placeOrder([{ variantId: sold.variants[0]!.id, quantity: 1 }]);
    await expect(setStocking(sold.product.id, { mode: "MATERIAL", stockUnit: "pcs", ...why }, OWNER)).rejects.toMatchObject({ statusCode: 409 });

    const fresh = await createStockedProduct({ stocks: [40] });
    const r = await as(request(app).put(`/api/v1/finance/stock/products/${fresh.product.id}/stocking`)).send({ mode: "MATERIAL", stockUnit: "pcs", ...why });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: "MATERIAL", changed: true });
    const row = await prisma.product.findUniqueOrThrow({ where: { id: fresh.product.id }, include: { variants: true } });
    expect(row).toMatchObject({ kind: "MATERIAL", isActive: false, status: "DRAFT", stockUnit: "pcs", trackInventory: true });
    expect(row.variants[0]!.stock).toBe(40); // stock untouched
    await expect(setStocking(fresh.product.id, { mode: "READY", ...why }, OWNER)).rejects.toMatchObject({ statusCode: 409 });

    const noUnit = await as(request(app).put(`/api/v1/finance/stock/products/${sold.product.id}/stocking`)).send({ mode: "MATERIAL", ...why });
    expect(noUnit.status).toBe(400);
  });
});
