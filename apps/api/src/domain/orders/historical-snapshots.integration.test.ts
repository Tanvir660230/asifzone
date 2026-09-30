import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { contributions, groupKeyOf, snapshotCoverage, sumOf, type OrderFact } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { cacheDel } from "../../config/redis";
import { RUN, asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder, trackOrder } from "../../test-fixtures";
import { trackOrder as trackOrderLookup, updateOrderStatus } from "../../modules/orders/order.service";
import { listCustomerOrders } from "../../modules/customers/customer.service";
import { deleteProduct, permanentlyDeleteProduct } from "../../modules/products/product.service";
import { reviewReturnRequest } from "../../modules/return-requests/return-request.service";
import { updateSettings } from "../../modules/settings/settings.service";
import { loadOrderFacts } from "../metrics/facts.repository";
import { computeMetrics } from "../metrics/metrics.service";
import { metricsConsistency } from "../metrics/consistency.service";

// Phase 6 (docs/PHASE_6_AUDIT.md): order lines freeze cost, product, category and brand when written; reports read the
// snapshots, never today's catalog; recorded cost never reaches a customer response; the store currency is locked.

let admin: string;
const lifetime = { startUtc: new Date(0), endUtc: new Date(Date.now() + 86_400_000) };
const T = (taka: number) => Math.round(taka * 100);
const sum = (key: string, of: OrderFact[]) => sumOf(contributions(key, of, lifetime));
const madeCategoryIds: string[] = [];

async function category(name: string) {
  const c = await prisma.category.create({ data: { name, slug: `p6-${RUN}-${madeCategoryIds.length}-${name.toLowerCase().replace(/\W+/g, "-")}` } });
  madeCategoryIds.push(c.id);
  return c;
}

/** A product with a known cost, brand and category, and one delivered COD order of one unit. */
async function deliveredSale(opts: { cost?: number | null; variantCost?: number | null; brand?: string | null; categoryId?: string } = {}) {
  const { product, variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
  await prisma.product.update({
    where: { id: product.id },
    data: { costPrice: opts.cost === undefined ? 400 : opts.cost, brand: opts.brand === undefined ? "Asif Studio" : opts.brand, ...(opts.categoryId ? { categoryId: opts.categoryId } : {}) },
  });
  if (opts.variantCost !== undefined) await prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { costPrice: opts.variantCost } });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
  return { product, variant: variants[0]!, order };
}

const lineOf = async (orderId: string) =>
  prisma.orderItem.findFirstOrThrow({
    where: { orderId },
    select: { unitCostSnapshot: true, productIdSnapshot: true, categoryIdSnapshot: true, categoryNameSnapshot: true, brandSnapshot: true },
  });

beforeAll(async () => {
  admin = await ownerId();
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.product.updateMany({ where: { categoryId: { in: madeCategoryIds } }, data: { categoryId: (await prisma.category.findFirstOrThrow({ where: { deletedAt: null, id: { notIn: madeCategoryIds } } })).id } });
  if (madeCategoryIds.length) await prisma.category.deleteMany({ where: { id: { in: madeCategoryIds } } });
  await prisma.$disconnect();
});

describe("cost snapshot (G1)", () => {
  it("a new order line records the cost at order time (variant cost wins over product cost), in minor units", async () => {
    const withVariantCost = await deliveredSale({ cost: 400, variantCost: 450 });
    expect((await lineOf(withVariantCost.order.id)).unitCostSnapshot).toBe(T(450));
    const productCostOnly = await deliveredSale({ cost: 400 });
    expect((await lineOf(productCostOnly.order.id)).unitCostSnapshot).toBe(T(400));
  });

  it("a later cost change changes neither the snapshot nor COGS / margin", async () => {
    const { product, order } = await deliveredSale({ cost: 400 });
    const before = await loadOrderFacts([order.id], "BDT");
    const cogsBefore = sum("cogs", before);
    const marginBefore = sum("gross_margin", before);
    await prisma.product.update({ where: { id: product.id }, data: { costPrice: 999 } });
    await prisma.productVariant.updateMany({ where: { productId: product.id }, data: { costPrice: 888 } });
    const after = await loadOrderFacts([order.id], "BDT");
    expect((await lineOf(order.id)).unitCostSnapshot).toBe(T(400));
    expect([sum("cogs", after), sum("gross_margin", after)]).toEqual([cogsBefore, marginBefore]);
    expect(cogsBefore).toBe(T(400));
  });

  it("no cost configured → unknown (NULL), excluded from COGS and margin, reported as coverage — never counted at 0", async () => {
    const { order } = await deliveredSale({ cost: null });
    expect((await lineOf(order.id)).unitCostSnapshot).toBeNull();
    const facts = await loadOrderFacts([order.id], "BDT");
    expect([sum("cogs", facts), sum("gross_margin", facts)]).toEqual([0, 0]);
    expect(snapshotCoverage("cogs", facts, lifetime)).toEqual({ recorded: 0, missing: 1 });
  });

  it("an old line without a snapshot (pre-Phase 6) stays unknown; the costed line carries the margin alone", async () => {
    const old = await deliveredSale({ cost: 400 });
    await prisma.orderItem.updateMany({ where: { orderId: old.order.id }, data: { unitCostSnapshot: null, categoryIdSnapshot: null, categoryNameSnapshot: null, brandSnapshot: null } });
    const costed = await deliveredSale({ cost: 400 });
    const facts = await loadOrderFacts([old.order.id, costed.order.id], "BDT");
    expect(sum("cogs", facts)).toBe(T(400));
    const merchExVat = (f: OrderFact) => sum("realised_net_sales", [f]) + sum("merchandise_refunds", [f]);
    expect(sum("gross_margin", facts)).toBe(merchExVat(facts.find((f) => f.id === costed.order.id)!) - T(400));
    expect(snapshotCoverage("gross_margin", facts, lifetime)).toEqual({ recorded: 1, missing: 1 });
  });

  it("the service reports COGS with line coverage", async () => {
    const m = await computeMetrics({ metrics: ["cogs", "gross_margin"], range: { preset: "today" }, fresh: true });
    expect(m.metrics.cogs).toMatchObject({ unit: "money", coverage: { recorded: expect.any(Number), missing: expect.any(Number) } });
    expect(m.metrics.cogs!.estimated).toBeUndefined();
  });
});

describe("category / brand / product snapshots (G2–G4)", () => {
  it("re-categorising, renaming the category and editing the brand after the order change no historical attribution", async () => {
    const original = await category("P6 Shirts");
    const other = await category("P6 Trousers");
    const { product, order } = await deliveredSale({ categoryId: original.id, brand: "Asif Studio" });
    await prisma.product.update({ where: { id: product.id }, data: { categoryId: other.id, brand: "Other Brand" } });
    await prisma.category.update({ where: { id: original.id }, data: { name: "Renamed" } });
    expect(await lineOf(order.id)).toMatchObject({ categoryIdSnapshot: original.id, categoryNameSnapshot: "P6 Shirts", brandSnapshot: "Asif Studio", productIdSnapshot: product.id });
    const [f] = await loadOrderFacts([order.id], "BDT");
    const c = contributions("gross_merchandise_sales", [f!], lifetime)[0]!;
    expect(groupKeyOf(c, "category", "Asia/Dhaka")).toEqual({ key: original.id, label: "P6 Shirts" });
    expect(groupKeyOf(c, "brand", "Asia/Dhaka")).toEqual({ key: "Asif Studio", label: "Asif Studio" });
  });

  it("a product without a brand is recorded as unbranded; a line without a snapshot is 'not recorded', never re-attributed", async () => {
    const unbranded = await deliveredSale({ brand: null });
    const legacy = await deliveredSale({ brand: "Asif Studio" });
    await prisma.orderItem.updateMany({ where: { orderId: legacy.order.id }, data: { categoryIdSnapshot: null, categoryNameSnapshot: null, brandSnapshot: null } });
    const facts = await loadOrderFacts([unbranded.order.id, legacy.order.id], "BDT");
    const keyOf = (id: string, g: "brand" | "category") => groupKeyOf(contributions("gross_merchandise_sales", facts.filter((f) => f.id === id), lifetime)[0]!, g, "Asia/Dhaka").key;
    expect(keyOf(unbranded.order.id, "brand")).toBe("unbranded");
    expect([keyOf(legacy.order.id, "brand"), keyOf(legacy.order.id, "category")]).toEqual(["not_recorded", "not_recorded"]);
  });

  it("permanently deleting the product erases no attribution or cost", async () => {
    const cat = await category("P6 Deleted");
    const { product, order } = await deliveredSale({ categoryId: cat.id, brand: "Gone Brand", cost: 400 });
    await deleteProduct(product.id); // to Trash first
    await permanentlyDeleteProduct(product.id);
    expect(await prisma.product.findUnique({ where: { id: product.id } })).toBeNull();
    const [f] = await loadOrderFacts([order.id], "BDT");
    expect(f!.lines[0]).toMatchObject({ productId: product.id, categoryId: cat.id, categoryName: "P6 Deleted", brand: "Gone Brand", unitCostSnapshot: T(400), attributionRecorded: true });
    expect(sum("cogs", [f!])).toBe(T(400));
  });

  it("exchange: the original keeps its snapshots and COGS; the replacement records its own and adds no COGS or sales", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [5, 5], basePrice: 1000, variantPrices: [null, 800] });
    await prisma.product.update({ where: { id: product.id }, data: { costPrice: 400, brand: "Exchange Brand" } });
    await prisma.productVariant.update({ where: { id: variants[1]!.id }, data: { costPrice: 350 } });
    const original = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    await updateOrderStatus(original.id, { status: "DELIVERED" }, admin);
    const lineRow = await prisma.orderItem.findFirstOrThrow({ where: { orderId: original.id } });
    const req = await prisma.returnRequest.create({
      data: { orderId: original.id, customerId: original.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: lineRow.id, requestedVariantId: variants[1]!.id },
    });
    await reviewReturnRequest(req.id, { status: "APPROVED" }, admin);
    const replacementId = (await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).exchangeOrderId!;
    trackOrder(replacementId);
    expect(await lineOf(original.id)).toMatchObject({ unitCostSnapshot: T(400), brandSnapshot: "Exchange Brand" });
    expect(await lineOf(replacementId)).toMatchObject({ unitCostSnapshot: T(350), productIdSnapshot: product.id, brandSnapshot: "Exchange Brand" });
    const facts = await loadOrderFacts([original.id, replacementId], "BDT");
    expect(sum("cogs", facts)).toBe(T(400)); // the original sale stands; the exchanged unit is not a return (P5-3, P6-5)
    expect(sum("units_sold", facts)).toBe(1);
  });
});

describe("reconciliation over costed, uncosted and pre-Phase-6 lines", () => {
  it("M-3 incl. Σ product gross margin = total and Σ category COGS (with 'Not recorded') = total", async () => {
    const costed = await deliveredSale({ cost: 400 });
    await deliveredSale({ cost: null });
    const legacy = await deliveredSale({ cost: 400 });
    await prisma.orderItem.updateMany({ where: { orderId: legacy.order.id }, data: { unitCostSnapshot: null, categoryIdSnapshot: null, categoryNameSnapshot: null, brandSnapshot: null } });
    const bySales = await computeMetrics({ metrics: ["units_sold"], range: { preset: "today" }, groupBy: "category", fresh: true });
    expect(bySales.groups!.some((g) => g.key === "not_recorded")).toBe(true);
    const report = await metricsConsistency({ preset: "today" });
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    const cogsCheck = report.checks.find((c) => c.check.startsWith("Σ category COGS"))!;
    expect(cogsCheck.expected).toBeGreaterThanOrEqual(400); // at least the costed order of this test
    expect((await lineOf(costed.order.id)).unitCostSnapshot).toBe(T(400));
  });
});

describe("recorded cost never reaches a customer (G6)", () => {
  it("checkout response, order tracking and the customer's order list omit unitCostSnapshot; the metrics loader has it", async () => {
    const { order } = await deliveredSale({ cost: 400 });
    expect(order.items.length).toBeGreaterThan(0);
    for (const item of order.items) expect("unitCostSnapshot" in item).toBe(false);
    const tracked = await trackOrderLookup(order.orderNumber, order.customerPhone);
    for (const item of tracked.items) expect("unitCostSnapshot" in item).toBe(false);
    const res = await request(app).post("/api/orders/track").send({ orderNumber: order.orderNumber, phone: order.customerPhone });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("unitCostSnapshot");
    const mine = await listCustomerOrders(order.customerId!, { page: 1, pageSize: 5 });
    expect(JSON.stringify(mine)).not.toContain("unitCostSnapshot");
    const [f] = await loadOrderFacts([order.id], "BDT");
    expect(f!.lines[0]!.unitCostSnapshot).toBe(T(400));
  });
});

describe("store currency lock (G5, P6-4)", () => {
  it("once orders exist the currency can't change (409 CURRENCY_LOCKED); saving the same currency still works", async () => {
    await deliveredSale();
    const current = (await prisma.storeSetting.findUniqueOrThrow({ where: { id: "singleton" } })).currency;
    try {
      await expect(updateSettings({ currency: current === "USD" ? "EUR" : "USD" })).rejects.toMatchObject({ statusCode: 409, details: { code: "CURRENCY_LOCKED" } });
      expect((await prisma.storeSetting.findUniqueOrThrow({ where: { id: "singleton" } })).currency).toBe(current);
      await expect(updateSettings({ currency: current })).resolves.toMatchObject({ currency: current });
      const api = await asOwner();
      const http = await api.patch("/api/settings", { currency: current === "USD" ? "EUR" : "USD" });
      expect([http.status, http.body.details?.code]).toEqual([409, "CURRENCY_LOCKED"]);
    } finally {
      // Even if a regression let the change through, the shared test DB keeps its currency (the lock blocks the app path).
      await prisma.storeSetting.update({ where: { id: "singleton" }, data: { currency: current } });
      await cacheDel("settings:singleton");
    }
  });
});
