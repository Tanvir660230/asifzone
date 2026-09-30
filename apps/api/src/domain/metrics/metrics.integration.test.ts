import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { aovOf, contributions, isSaleOrder, merchandiseVat, realisationOf, snapshotCoverage, sumOf, type BusinessRange, type OrderFact } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { cacheDel } from "../../config/redis";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder, trackOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../../modules/orders/order.service";
import { settlePaymentSession } from "../../modules/payments/payment.service";
import { reviewReturnRequest } from "../../modules/return-requests/return-request.service";
import { completeRefund, recordRefund } from "../payments/payment-ledger.service";
import { loadOrderFacts } from "./facts.repository";
import { computeMetrics, customerMetricsIndex } from "./metrics.service";
import { metricsConsistency } from "./consistency.service";
import { SALE_ORDER_WHERE } from "./sale-order";
import { resolveStoreRange, utcInstant } from "./store-time";

// docs/METRICS_REGISTRY.md — the fact loader + engine against real orders built through the real order, ledger and
// exchange paths (no hand-written rows), plus history immutability (M-2), store timezone (M-4) and the API contract.

let admin: string;
const ids = {} as Record<"delivered" | "pending" | "online" | "cancelled" | "returned" | "exchangedOriginal" | "replacement", string>;
let facts: OrderFact[] = [];
let today: BusinessRange;

const T = (taka: number) => Math.round(taka * 100);
const metric = (key: string, of = facts) => sumOf(contributions(key, of, today));

async function codOrder(stock = 10, price = 1000) {
  const { variants } = await createStockedProduct({ stocks: [stock], basePrice: price });
  return placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
}

beforeAll(async () => {
  admin = await ownerId();
  today = await resolveStoreRange({ preset: "today" });

  const delivered = await codOrder();
  await updateOrderStatus(delivered.id, { status: "DELIVERED" }, admin);
  ids.delivered = delivered.id;

  ids.pending = (await codOrder()).id;

  const online = await codOrder();
  await prisma.order.update({ where: { id: online.id }, data: { paymentMethod: "EPS_PG" } });
  const session = await prisma.paymentSession.create({
    data: { orderId: online.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: `m5_${online.id}`, expiresAt: new Date(Date.now() + 60_000) },
  });
  await settlePaymentSession(session.gatewayTransactionRef, `eps_${online.id}`, Number(online.total));
  ids.online = online.id;

  const cancelled = await codOrder();
  await updateOrderStatus(cancelled.id, { status: "CANCELLED" }, admin);
  ids.cancelled = cancelled.id;

  const returned = await codOrder();
  await updateOrderStatus(returned.id, { status: "DELIVERED" }, admin);
  await updateOrderStatus(returned.id, { status: "RETURNED" }, admin);
  await recordRefund(returned.id, { amount: 500 }, admin);
  ids.returned = returned.id;

  // Exchange downgrade (D6): replacement at 800 for a 1000 item — a requested refund of 200 on the original.
  const { variants } = await createStockedProduct({ stocks: [5, 5], basePrice: 1000, variantPrices: [null, 800] });
  const original = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await updateOrderStatus(original.id, { status: "DELIVERED" }, admin);
  const lineRow = await prisma.orderItem.findFirstOrThrow({ where: { orderId: original.id } });
  const req = await prisma.returnRequest.create({
    data: { orderId: original.id, customerId: original.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: lineRow.id, requestedVariantId: variants[1]!.id },
  });
  await reviewReturnRequest(req.id, { status: "APPROVED" }, admin);
  ids.exchangedOriginal = original.id;
  ids.replacement = (await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).exchangeOrderId!;
  trackOrder(ids.replacement);

  facts = await loadOrderFacts(Object.values(ids), "BDT");
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("metrics over real orders (loader + engine)", () => {
  it("eligibility: cancelled and exchange replacements are not sales; the SALE_ORDER query form agrees with the engine", async () => {
    const engine = new Set(facts.filter(isSaleOrder).map((f) => f.id));
    expect(engine).toEqual(new Set([ids.delivered, ids.pending, ids.online, ids.returned, ids.exchangedOriginal]));
    const query = await prisma.order.findMany({ where: { id: { in: Object.values(ids) }, ...SALE_ORDER_WHERE }, select: { id: true } });
    expect(new Set(query.map((r) => r.id))).toEqual(engine);
    expect(facts.find((f) => f.id === ids.replacement)!.isExchangeReplacement).toBe(true);
  });

  it("counts, merchandise, shipping, returns and net sales (D1)", () => {
    expect(metric("orders_placed")).toBe(5);
    expect(metric("orders_realised")).toBe(4); // pending COD is not revenue
    expect(metric("orders_cancelled")).toBe(1);
    expect(metric("cancelled_order_value")).toBe(T(1060));
    expect(metric("gross_merchandise_sales")).toBe(T(4000));
    expect(metric("shipping_charged")).toBe(T(240));
    expect(metric("returns")).toBe(T(1000)); // the exchanged unit is not a return
    expect(metric("net_merchandise_sales")).toBe(T(3000));
    expect(metric("net_sales")).toBe(T(3240));
    // Headline (PD-5.1): merchandise ex VAT − merchandise refunds. The returned order's 500 refund is merchandise; the
    // exchange downgrade refund is only requested (not completed), so it doesn't count yet.
    expect(metric("realised_net_sales")).toBe(T(4000 - 500) - metric("merchandise_vat"));
    expect(metric("merchandise_refunds")).toBe(T(500));
  });

  it("refunds and cash come from the Phase 4 ledger (a requested exchange refund is owed, not paid)", () => {
    expect(metric("refunds")).toBe(T(500));
    expect(metric("payments_received")).toBe(T(4 * 1060)); // COD collected ×3 + gateway; free replacement settled at 0
    expect(metric("collected_cash")).toBe(T(4 * 1060 - 500));
    expect(metric("exchange_difference_collected")).toBe(0);
  });

  it("units: ordered vs sold vs returned", () => {
    expect(metric("units_ordered")).toBe(5);
    expect(metric("units_sold")).toBe(4);
    expect(metric("units_returned")).toBe(1);
    expect(metric("net_units_sold")).toBe(3);
  });

  it("tax is the sum of the orders' own snapshots, with full coverage for new orders", async () => {
    const rows = await prisma.order.findMany({ where: { id: { in: [ids.delivered, ids.online, ids.returned, ids.exchangedOriginal] } }, select: { taxAmount: true } });
    expect(metric("tax_collected")).toBe(rows.reduce((s, r) => s + T(Number(r.taxAmount ?? 0)), 0));
    expect(snapshotCoverage("tax_collected", facts, today)).toEqual({ recorded: 4, missing: 0 });
  });

  it("M-2: changing prices, tax and shipping configuration afterwards changes no historical metric", async () => {
    const keys = ["gross_merchandise_sales", "realised_net_sales", "merchandise_vat", "net_sales", "tax_collected", "shipping_charged", "returns", "collected_cash"];
    const before = Object.fromEntries(keys.map((k) => [k, metric(k)]));
    const productIds = (await prisma.orderItem.findMany({ where: { orderId: { in: Object.values(ids) } }, select: { variantId: true } })).map((r) => r.variantId);
    // Originals captured first; every mutation happens inside `try` so a failure can never leave the shared test
    // database's store configuration changed.
    const tax = await prisma.taxSetting.findFirst();
    const rates = await prisma.shippingRate.findMany();
    try {
      await prisma.productVariant.updateMany({ where: { id: { in: productIds } }, data: { price: 9999, costPrice: 7777 } });
      if (tax) await prisma.taxSetting.update({ where: { id: tax.id }, data: { defaultRate: 25, enabled: true, mode: "EXCLUSIVE" } });
      for (const r of rates) await prisma.shippingRate.update({ where: { id: r.id }, data: { fee: 999 } });
      const after = await loadOrderFacts(Object.values(ids), "BDT");
      expect(Object.fromEntries(keys.map((k) => [k, metric(k, after)]))).toEqual(before);
    } finally {
      if (tax) await prisma.taxSetting.update({ where: { id: tax.id }, data: { defaultRate: tax.defaultRate, enabled: tax.enabled, mode: tax.mode } });
      for (const r of rates) await prisma.shippingRate.update({ where: { id: r.id }, data: { fee: r.fee } });
    }
  });
});

describe("metrics service", () => {
  it("computes fresh deltas through computeMetrics (store timezone, today)", async () => {
    const keys = ["realised_net_sales", "merchandise_vat", "net_sales", "orders_placed", "orders_realised"];
    const before = await computeMetrics({ metrics: keys, range: { preset: "today" }, fresh: true });
    const o = await codOrder();
    await updateOrderStatus(o.id, { status: "DELIVERED" }, admin);
    const after = await computeMetrics({ metrics: keys, range: { preset: "today" }, fresh: true });
    const delta = (k: string) => after.metrics[k]!.value - before.metrics[k]!.value;
    expect(delta("realised_net_sales") + delta("merchandise_vat")).toBeCloseTo(1000, 2); // merchandise only
    expect(delta("net_sales")).toBeCloseTo(1060, 2); // the secondary metric includes shipping
    expect(after.metrics.orders_placed!.value - before.metrics.orders_placed!.value).toBe(1);
    expect(after.metrics.orders_realised!.value - before.metrics.orders_realised!.value).toBe(1);
  });

  it("M-4: the business day follows StoreSetting.timezone", async () => {
    const o = await codOrder();
    // 20:00 UTC on Jan 10 is 02:00 on Jan 11 in Dhaka.
    await prisma.order.update({ where: { id: o.id }, data: { createdAt: new Date("2026-01-10T20:00:00Z") } });
    const setting = await prisma.storeSetting.findUniqueOrThrow({ where: { id: "singleton" } });
    const countOn = async (date: string) => {
      const range = await resolveStoreRange({ from: date, to: date });
      const f = await loadOrderFacts([o.id], "BDT");
      return sumOf(contributions("orders_placed", f, range));
    };
    // Direct writes bypass settings.service, so the cached settings copy is cleared explicitly after each one.
    const setTz = async (timezone: string) => {
      await prisma.storeSetting.update({ where: { id: "singleton" }, data: { timezone } });
      await cacheDel("settings:singleton");
    };
    try {
      await setTz("Asia/Dhaka");
      expect([await countOn("2026-01-10"), await countOn("2026-01-11")]).toEqual([0, 1]);
      await setTz("UTC");
      expect([await countOn("2026-01-10"), await countOn("2026-01-11")]).toEqual([1, 0]);
    } finally {
      await setTz(setting.timezone);
    }
  });

  it("utcInstant compares correctly with Prisma-written timestamps (the measured 6 h skew — audit §2)", async () => {
    const before = new Date(Date.now() - 60_000);
    const after = new Date(Date.now() + 60_000);
    const n = await prisma.notification.create({ data: { type: "metrics.tz-probe", title: "probe" } });
    try {
      const [row] = await prisma.$queryRaw<Array<{ inWindow: boolean; afterUpper: boolean; bare: boolean }>>`
        SELECT ("createdAt" >= ${utcInstant(before)}) AS "inWindow",
               ("createdAt" >= ${utcInstant(after)}) AS "afterUpper",
               ("createdAt" >= ${before}) AS bare
        FROM "Notification" WHERE id = ${n.id}`;
      expect(row!.inWindow).toBe(true);
      expect(row!.afterUpper).toBe(false);
      // The pre-Phase-5 form reads the naive-UTC column in the session zone. Under an Asia/Dhaka session it drops a row
      // created a minute ago; under a UTC session the two agree, so only assert the difference when the zones differ.
      const [session] = await prisma.$queryRaw<Array<{ tz: string }>>`SELECT current_setting('TimeZone') AS tz`;
      if (session!.tz !== "UTC" && session!.tz !== "Etc/UTC") expect(row!.bare).toBe(false);
    } finally {
      await prisma.notification.delete({ where: { id: n.id } });
    }
  });

  it("M-3: reconciliation checks pass (series, customers, products, ledger cash)", async () => {
    const report = await metricsConsistency({ preset: "today" });
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("groupings: day series zero-filled in business dates; products; customers", async () => {
    const byDay = await computeMetrics({ metrics: ["realised_net_sales"], range: { preset: "last_7_days" }, groupBy: "day", fresh: true });
    expect(byDay.groups).toHaveLength(7);
    expect(byDay.groups![6]!.key).toBe(byDay.range.to);
    const byProduct = await computeMetrics({ metrics: ["net_merchandise_sales", "net_units_sold"], range: { preset: "today" }, groupBy: "product", limit: 3, fresh: true });
    expect(byProduct.groups!.length).toBeLessThanOrEqual(3);
  });
});

describe("GET /api/v1/metrics (contract)", () => {
  it("returns registry metrics with range, timezone and currency", async () => {
    const api = await asOwner();
    const res = await api.get("/api/v1/metrics?metrics=realised_net_sales,net_sales,orders_placed,outstanding_cod,low_stock_variants&preset=today");
    expect(res.status).toBe(200);
    expect(res.body.range).toMatchObject({ timezone: expect.any(String), from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(res.body.currency).toBe("BDT");
    expect(res.body.metrics.realised_net_sales).toMatchObject({ unit: "money", value: expect.any(Number), coverage: { recorded: expect.any(Number), missing: expect.any(Number) } });
    expect(res.body.metrics.net_sales).toMatchObject({ unit: "money", value: expect.any(Number) });
    expect(res.body.metrics.orders_placed).toMatchObject({ unit: "count" });
  });

  it("groups by a supported dimension; custom from/to dates", async () => {
    const api = await asOwner();
    const res = await api.get(`/api/v1/metrics?metrics=realised_net_sales,orders_realised&from=${today.from}&to=${today.to}&groupBy=payment_method`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.groups)).toBe(true);
  });

  it("error contract: unknown (incl. the withdrawn realised_revenue), unsupported grouping, invalid range, validation", async () => {
    const api = await asOwner();
    const unknown = await api.get("/api/v1/metrics?metrics=revenue_magic&preset=today");
    expect([unknown.status, unknown.body.details?.code]).toEqual([400, "UNKNOWN_METRIC"]);
    // PD-5.1 resolved: the pending key was withdrawn in favour of realised_net_sales (no metric is pending now).
    const withdrawn = await api.get("/api/v1/metrics?metrics=realised_revenue&preset=today");
    expect([withdrawn.status, withdrawn.body.details?.code]).toEqual([400, "UNKNOWN_METRIC"]);
    const lineGrouping = await api.get("/api/v1/metrics?metrics=realised_net_sales&preset=today&groupBy=product");
    expect([lineGrouping.status, lineGrouping.body.details?.code]).toEqual([400, "UNSUPPORTED_GROUPING"]); // refunds name no line
    const grouping = await api.get("/api/v1/metrics?metrics=outstanding_cod&preset=today&groupBy=product");
    expect([grouping.status, grouping.body.details?.code]).toEqual([400, "UNSUPPORTED_GROUPING"]);
    const range = await api.get("/api/v1/metrics?metrics=net_sales&from=2026-10-05&to=2026-10-01");
    expect([range.status, range.body.details?.code]).toEqual([400, "INVALID_RANGE"]);
    const both = await api.get("/api/v1/metrics?metrics=net_sales&preset=today&from=2026-10-01&to=2026-10-02");
    expect(both.status).toBe(400);
  });

  it("definitions and consistency endpoints; admin only", async () => {
    const api = await asOwner();
    const defs = await api.get("/api/v1/metrics/definitions");
    expect(defs.status).toBe(200);
    expect(defs.body.metrics.find((d: { key: string }) => d.key === "realised_net_sales")).toMatchObject({ status: "active", label: "Realised net sales" });
    expect(defs.body.metrics.find((d: { key: string }) => d.key === "net_sales").label).toBe("Net sales incl. shipping, less returns");
    expect(defs.body.metrics.some((d: { status: string }) => d.status === "pending")).toBe(false);
    const cons = await api.get("/api/v1/metrics/consistency?preset=today");
    expect([cons.status, cons.body.ok]).toEqual([200, true]);
    const anon = await request(app).get("/api/v1/metrics?metrics=net_sales&preset=today");
    expect(anon.status).toBe(401);
  });
});

describe("PD-5.1 realised net sales over real orders (order, ledger and exchange paths)", () => {
  const lifetime = { startUtc: new Date(0), endUtc: new Date(Date.now() + 86_400_000) };
  const life = (key: string, of: OrderFact[]) => sumOf(contributions(key, of, lifetime));

  async function paidOnlineOrder() {
    const o = await codOrder();
    await prisma.order.update({ where: { id: o.id }, data: { paymentMethod: "EPS_PG" } });
    const session = await prisma.paymentSession.create({
      data: { orderId: o.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: `pd51_${o.id}`, expiresAt: new Date(Date.now() + 60_000) },
    });
    await settlePaymentSession(session.gatewayTransactionRef, `eps_${o.id}`, Number(o.total));
    return o;
  }

  it("paid online, then cancelled, refunded and moved to REFUNDED: realised, reversed at the cancellation, never reduced twice", async () => {
    const o = await paidOnlineOrder();
    await updateOrderStatus(o.id, { status: "CANCELLED" }, admin);
    await recordRefund(o.id, { amount: Number(o.total) }, admin);
    await updateOrderStatus(o.id, { status: "REFUNDED" }, admin); // T8: CANCELLED → REFUNDED
    const [f] = await loadOrderFacts([o.id], "BDT");
    expect(f!.status).toBe("REFUNDED");
    expect(f!.cancelledAt).not.toBeNull();
    expect(realisationOf(f!)).toEqual({ at: f!.payments[0]!.settledAt, reversedAt: f!.cancelledAt });
    // History keeps the sale and the reversal; the total nets to zero and the later refund adds nothing.
    const amounts = contributions("realised_net_sales", [f!], lifetime).map((c) => c.amount).sort((x, y) => x - y);
    const merch = T(1000) - (merchandiseVat(f!) ?? 0);
    expect(amounts).toEqual([-merch, merch]);
    expect([life("realised_net_sales", [f!]), life("orders_realised", [f!]), life("merchandise_refunds", [f!])]).toEqual([0, 0, 0]);
    // Cancelled-then-refunded is still not a sale order, in the engine and the SQL form.
    expect(isSaleOrder(f!)).toBe(false);
    expect(await prisma.order.count({ where: { id: o.id, ...SALE_ORDER_WHERE } })).toBe(0);
  });

  it("goods-first partial refund on a delivered COD order; the rest of a full refund is shipping, not merchandise", async () => {
    const o = await codOrder();
    await updateOrderStatus(o.id, { status: "DELIVERED" }, admin);
    await recordRefund(o.id, { amount: 300 }, admin);
    const [partial] = await loadOrderFacts([o.id], "BDT");
    const merch = T(1000) - (merchandiseVat(partial!) ?? 0);
    expect(life("realised_net_sales", [partial!])).toBe(merch - Math.round((T(300) * merch) / T(1000)));
    await recordRefund(o.id, { amount: Number(o.total) - 300 }, admin);
    const [full] = await loadOrderFacts([o.id], "BDT");
    expect(life("realised_net_sales", [full!])).toBe(0);
    expect(life("refunds", [full!])).toBe(T(Number(o.total)));
  });

  it("exchange downgrade: completing the difference refund reduces the original in full; the replacement adds nothing", async () => {
    const { variants } = await createStockedProduct({ stocks: [5, 5], basePrice: 1000, variantPrices: [null, 800] });
    const original = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    await updateOrderStatus(original.id, { status: "DELIVERED" }, admin);
    const lineRow = await prisma.orderItem.findFirstOrThrow({ where: { orderId: original.id } });
    const req = await prisma.returnRequest.create({
      data: { orderId: original.id, customerId: original.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: lineRow.id, requestedVariantId: variants[1]!.id },
    });
    await reviewReturnRequest(req.id, { status: "APPROVED" }, admin);
    const replacementId = (await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).exchangeOrderId!;
    trackOrder(replacementId);
    const requested = await prisma.refund.findFirstOrThrow({ where: { orderId: original.id, status: "REQUESTED" } });
    await completeRefund(original.id, requested.id, { method: "bKash" }, admin);
    const of = await loadOrderFacts([original.id, replacementId], "BDT");
    const orig = of.find((f) => f.id === original.id)!;
    const merch = T(1000) - (merchandiseVat(orig) ?? 0);
    expect(life("realised_net_sales", of)).toBe(merch - Math.round((T(200) * merch) / T(1000)));
    expect(life("returns", of)).toBe(0); // the exchanged unit is not a return
  });

  it("inclusive VAT comes from the order's own snapshot; later tax changes don't touch it", async () => {
    const tax = await prisma.taxSetting.findFirst();
    let orderId: string;
    try {
      if (tax) await prisma.taxSetting.update({ where: { id: tax.id }, data: { enabled: true, mode: "INCLUSIVE", defaultRate: 15, shippingTaxable: true } });
      const o = await codOrder();
      await updateOrderStatus(o.id, { status: "DELIVERED" }, admin);
      orderId = o.id;
    } finally {
      if (tax)
        await prisma.taxSetting.update({
          where: { id: tax.id },
          data: { enabled: tax.enabled, mode: tax.mode, defaultRate: tax.defaultRate, shippingTaxable: tax.shippingTaxable },
        });
    }
    const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { taxAmount: true, shippingTaxAmount: true } });
    const merchVat = T(Number(row.taxAmount)) - T(Number(row.shippingTaxAmount));
    expect(merchVat).toBeGreaterThan(0);
    const [f] = await loadOrderFacts([orderId], "BDT");
    expect(merchandiseVat(f!)).toBe(merchVat);
    expect(life("realised_net_sales", [f!])).toBe(T(1000) - merchVat);
    expect(life("gross_merchandise_sales", [f!])).toBe(T(1000)); // as charged
    expect(snapshotCoverage("realised_net_sales", [f!], lifetime)).toEqual({ recorded: 1, missing: 0 });
  });

  it("the service: AOV = realised net sales ÷ orders realised, and customer spend is realised net sales grouped", async () => {
    const m = await computeMetrics({ metrics: ["realised_net_sales", "orders_realised", "aov"], range: { preset: "today" }, fresh: true });
    const minor = (v: number) => Math.round(v * 100);
    expect(minor(m.metrics.aov!.value)).toBe(aovOf(minor(m.metrics.realised_net_sales!.value), m.metrics.orders_realised!.value));
    const o = await codOrder();
    await updateOrderStatus(o.id, { status: "DELIVERED" }, admin);
    const customerId = (await prisma.order.findUniqueOrThrow({ where: { id: o.id }, select: { customerId: true } })).customerId!;
    const own = await loadOrderFacts((await prisma.order.findMany({ where: { customerId }, select: { id: true } })).map((r) => r.id), "BDT");
    const index = await customerMetricsIndex();
    expect(minor(index.get(customerId)!.netSpend)).toBe(life("realised_net_sales", own));
  });
});
