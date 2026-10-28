import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, markOpeningPostedInTx, ownerId, placeOrder, purgeFinanceTables } from "../../test-fixtures";
import { updateOrderStatus } from "../../modules/orders/order.service";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { projectOrder } from "./commerce-accounting.service";
import { activateInventoryCostingInTx, recordValuationInTx } from "./costing.service";
import { setCostPolicy } from "./chart.service";
import { estimateUnitCosts, variantsWithoutAnyCost } from "./cost-estimate";
import { getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import type { FinanceActor } from "./finance-audit";

// Blueprint P0.2 (owner decisions Q3 = A, Q-D): under AUTO_ESTIMATE a sold line with no cost is booked at the first cost
// source that exists — book average → approved recipe → last posted purchase → catalog — labelled ESTIMATED and queued for
// the owner to confirm; with no source it stays "cost missing". KNOWN_ONLY books no estimate. A product published for the
// first time needs a cost for every tracked size; one published before is never held back.

const SYSTEM: FinanceActor = { type: "SYSTEM", label: "test" };
let admin = "";
const v: Record<string, { id: string; productId: string }> = {};

async function variant(name: string, stock: number, catalogCost: number | null) {
  const p = await createStockedProduct({ stocks: [stock], basePrice: 1000 });
  await prisma.product.update({ where: { id: p.product.id }, data: { costPrice: catalogCost } });
  v[name] = { id: p.variants[0]!.id, productId: p.product.id };
}
async function deliver(orderId: string) {
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const) await updateOrderStatus(orderId, { status: s }, admin);
}
async function recognitionCogs(orderId: string) {
  const ev = await prisma.financialEvent.findMany({ where: { eventKey: { startsWith: `order:${orderId}:recognition#` } }, orderBy: { receivedAt: "desc" }, take: 1 });
  return ((ev[0]?.payload as { components?: { cogs: Array<{ unitCost: number; status: string }> } } | undefined)?.components?.cogs) ?? [];
}

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(SYSTEM);
  await financeTransaction(async (tx) => {
    await tx.financeBusiness.update({ where: { id: ctx.business.id }, data: { openingDate: new Date("2026-01-01T00:00:00Z"), costPolicy: "KNOWN_ONLY" } });
    await tx.financeAuditEntry.create({ data: { businessId: ctx.business.id, actorType: "SYSTEM", actorLabel: "test", action: "business.update", entityType: "FinanceBusiness", entityId: ctx.business.id } });
    await markOpeningPostedInTx(tx, ctx.business.id, new Date("2026-01-01T00:00:00Z"));
  });
  await variant("valued", 10, 999);
  await financeTransaction(async (tx) => {
    await recordValuationInTx(tx, { business: ctx.business, brandId: ctx.brand.id, variantId: v.valued!.id, sourceType: "Cutover", sourceId: "test", financialDate: "2026-10-15", op: { type: "CUTOVER", qty: 10, valueMinor: 10 * 12_000 } });
    await activateInventoryCostingInTx(tx, ctx.business.id, new Date(Date.now() - 60_000), SYSTEM);
  });
  // created after costing went live and never valued: their sales leave with no recorded cost
  await variant("catalogOnly", 10, 200);
  await variant("noCost", 10, null);
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`UPDATE "OrderItem" SET "costMovementId" = NULL WHERE "costMovementId" IS NOT NULL`);
  });
  await cleanupFixtures();
});

describe("the Q-D estimate chain", () => {
  it("takes the book average first, then (with no position, recipe or purchase) the catalog cost; none → nothing", async () => {
    const est = await estimateUnitCosts([v.valued!.id, v.catalogOnly!.id, v.noCost!.id], "BDT");
    expect(est.get(v.valued!.id)).toEqual({ unitCostMinor: 12_000, source: "BOOK_AVERAGE" });
    expect(est.get(v.catalogOnly!.id)).toEqual({ unitCostMinor: 20_000, source: "CATALOG" });
    expect(est.has(v.noCost!.id)).toBe(false);
  });
});

describe("booking a sale with no recorded cost", () => {
  it("KNOWN_ONLY: the line stays cost missing — no estimate is booked", async () => {
    const o = await placeOrder([{ variantId: v.catalogOnly!.id, quantity: 1 }]);
    await deliver(o.id);
    await projectOrder(o.id);
    expect((await recognitionCogs(o.id)).length).toBe(0);
    const ex = await prisma.financeException.findFirstOrThrow({ where: { orderId: o.id, kind: "MISSING_COST" } });
    expect(ex.status).toBe("OPEN");
  });

  it("AUTO_ESTIMATE: booked once at the catalog estimate, labelled ESTIMATED, and put in the figures to confirm", async () => {
    await setCostPolicy({ costPolicy: "AUTO_ESTIMATE", reason: "test: automatic estimates" }, SYSTEM);
    const o = await placeOrder([{ variantId: v.catalogOnly!.id, quantity: 2 }]);
    await deliver(o.id);
    await projectOrder(o.id);
    expect(await recognitionCogs(o.id)).toEqual([expect.objectContaining({ unitCost: 20_000, status: "ESTIMATED" })]);
    // posted once: no recognition without cost that a later revision had to replace
    expect(await prisma.financialEvent.count({ where: { eventKey: { startsWith: `order:${o.id}:recognition#` } } })).toBe(1);
    const ex = await prisma.financeException.findFirstOrThrow({ where: { orderId: o.id, kind: "MISSING_COST" } });
    expect(ex).toMatchObject({ status: "RESOLVED", resolution: "ESTIMATE_APPROVED" });
    expect(ex.resolutionNote).toMatch(/Automatic estimate from the catalog cost price/);
    const check = await prisma.financeVerification.findFirstOrThrow({ where: { entityType: "FinanceException", entityId: ex.id } });
    expect(check.status).toBe("ESTIMATED");
    // a replay posts nothing new
    await projectOrder(o.id);
    expect(await prisma.financialEvent.count({ where: { eventKey: { startsWith: `order:${o.id}:recognition#` } } })).toBe(1);
  });

  it("AUTO_ESTIMATE with no source at all: the line stays cost missing, never 0", async () => {
    const o = await placeOrder([{ variantId: v.noCost!.id, quantity: 1 }]);
    await deliver(o.id);
    await projectOrder(o.id);
    expect((await recognitionCogs(o.id)).length).toBe(0);
    expect((await prisma.financeException.findFirstOrThrow({ where: { orderId: o.id, kind: "MISSING_COST" } })).status).toBe("OPEN");
  });
});

describe("the publishing guard (wired into create, update and bulk publish in product.service.ts)", () => {
  it("a first publish (from draft or ready) of a tracked product names each size with no cost at all", async () => {
    const sku = (await prisma.productVariant.findUniqueOrThrow({ where: { id: v.noCost!.id } })).sku;
    expect(await variantsWithoutAnyCost(v.noCost!.productId, "DRAFT", "BDT")).toEqual([sku]);
    expect(await variantsWithoutAnyCost(v.noCost!.productId, "READY", "BDT")).toEqual([sku]);
    expect(await variantsWithoutAnyCost(v.catalogOnly!.productId, "DRAFT", "BDT")).toEqual([]);
  });

  it("a product that was published before is never held back", async () => {
    expect(await variantsWithoutAnyCost(v.noCost!.productId, "UNPUBLISHED", "BDT")).toEqual([]);
  });

  it("under KNOWN_ONLY the guard does not apply", async () => {
    await setCostPolicy({ costPolicy: "KNOWN_ONLY", reason: "test: back to known only" }, SYSTEM);
    expect(await variantsWithoutAnyCost(v.noCost!.productId, "DRAFT", "BDT")).toEqual([]);
  });
});
