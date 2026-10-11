import { describe, it, expect } from "vitest";
import {
  addDays,
  aovOf,
  bucketKey,
  businessDate,
  businessDayStartUtc,
  contributions,
  customerStats,
  enumerateBuckets,
  groupKeyOf,
  inventoryTotals,
  isSaleOrder,
  lineDiscounts,
  localClock,
  positionTotals,
  previousRange,
  realisedAt,
  resolveBusinessRange,
  returnEvents,
  shippingCharged,
  snapshotCoverage,
  sumOf,
  type OrderFact,
} from "@clothing-brand/shared";
import { T, deliveredCod, line, order, paidOnline } from "./metrics-facts.fixture";

// docs/METRICS_REGISTRY.md — the pure metrics engine: business time, eligibility, valuation and aggregation.
const TZ = "Asia/Dhaka";
const SEPT = resolveBusinessRange({ from: "2026-09-01", to: "2026-09-30" }, TZ, new Date("2026-09-30T12:00:00Z"));
const sum = (key: string, orders: OrderFact[], range = SEPT) => sumOf(contributions(key, orders, range));

describe("business time (§1)", () => {
  it("a UTC instant belongs to the store's business date, not the UTC date", () => {
    expect(businessDate(new Date("2026-09-29T20:00:00Z"), TZ)).toBe("2026-09-30"); // 02:00 in Dhaka
    expect(businessDate(new Date("2026-09-29T17:59:59Z"), TZ)).toBe("2026-09-29"); // 23:59:59 in Dhaka
    expect(businessDate(new Date("2026-09-29T20:00:00Z"), "UTC")).toBe("2026-09-29");
  });
  it("a Dhaka business day starts at 18:00 UTC the previous calendar day; ranges are half-open with inclusive dates", () => {
    const r = resolveBusinessRange({ from: "2026-09-30", to: "2026-09-30" }, TZ, new Date("2026-09-30T12:00:00Z"));
    expect(r.startUtc.toISOString()).toBe("2026-09-29T18:00:00.000Z");
    expect(r.endUtc.toISOString()).toBe("2026-09-30T18:00:00.000Z");
  });
  it("month boundaries follow the store timezone", () => {
    const r = resolveBusinessRange({ preset: "this_month" }, TZ, new Date("2026-09-30T19:00:00Z")); // Oct 1, 01:00 Dhaka
    expect([r.from, r.to]).toEqual(["2026-10-01", "2026-10-01"]);
    const last = resolveBusinessRange({ preset: "last_month" }, TZ, new Date("2026-03-15T00:00:00Z"));
    expect([last.from, last.to]).toEqual(["2026-02-01", "2026-02-28"]);
  });
  it("presets: last N days includes today; this_week starts Monday; yesterday; lifetime", () => {
    const now = new Date("2026-09-30T06:00:00Z"); // Wednesday
    expect(resolveBusinessRange({ preset: "last_7_days" }, TZ, now).from).toBe("2026-09-24");
    expect(resolveBusinessRange({ preset: "this_week" }, TZ, now).from).toBe("2026-09-28");
    expect(resolveBusinessRange({ preset: "yesterday" }, TZ, now).from).toBe("2026-09-29");
    expect(resolveBusinessRange({ preset: "lifetime" }, TZ, now).startUtc.getTime()).toBeLessThan(0);
  });
  it("is DST-correct: New York midnight is 05:00Z before the March change and 04:00Z after", () => {
    expect(businessDayStartUtc("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(businessDayStartUtc("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
    const r = resolveBusinessRange({ from: "2026-03-08", to: "2026-03-08" }, "America/New_York", new Date("2026-03-10T00:00:00Z"));
    expect((r.endUtc.getTime() - r.startUtc.getTime()) / 3_600_000).toBe(23); // the short day
  });
  it("rejects bad ranges and timezones", () => {
    expect(() => resolveBusinessRange({ from: "2026-09-31", to: "2026-10-01" }, TZ, new Date())).toThrow();
    expect(() => resolveBusinessRange({ from: "2026-10-02", to: "2026-10-01" }, TZ, new Date())).toThrow();
    expect(() => resolveBusinessRange({ preset: "today" }, "Mars/Olympus", new Date())).toThrow();
  });
  it("buckets, local clock, previous range", () => {
    expect(bucketKey(new Date("2026-09-29T20:00:00Z"), TZ, "month")).toBe("2026-09");
    expect(enumerateBuckets(SEPT, "day")).toHaveLength(30);
    expect(localClock(new Date("2026-09-29T20:00:00Z"), TZ)).toEqual({ hour: 2, dow: 3 });
    expect(previousRange(SEPT)).toMatchObject({ from: "2026-08-02", to: "2026-08-31" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("eligibility (§2)", () => {
  it("a sale order is not trashed, not cancelled, not an exchange replacement", () => {
    expect(isSaleOrder(order())).toBe(true);
    expect(isSaleOrder(order({ status: "CANCELLED" }))).toBe(false);
    expect(isSaleOrder(order({ deleted: true }))).toBe(false);
    expect(isSaleOrder(order({ isExchangeReplacement: true }))).toBe(false);
    expect(isSaleOrder(order({ status: "RETURNED" }))).toBe(true);
  });
  it("realisation: COD at first delivery (not placement, not prepayment); online at first successful payment", () => {
    const at = new Date("2026-09-12T10:00:00Z");
    expect(realisedAt(order())).toBeNull(); // pending COD = not revenue (D1)
    expect(realisedAt(order({ payments: [{ amount: T(1060), status: "SUCCEEDED", provider: "MANUAL", settledAt: at }] }))).toBeNull(); // prepaid COD
    expect(realisedAt(deliveredCod(at))).toEqual(at);
    expect(realisedAt(paidOnline(at))).toEqual(at);
    expect(realisedAt(order({ paymentMethod: "EPS_PG", payments: [{ amount: T(1060), status: "FAILED", provider: "EPS_PG", settledAt: at }] }))).toBeNull();
    expect(realisedAt(paidOnline(at, { status: "CANCELLED" }))).toBeNull(); // paid-then-cancelled is not a sale (P5-2)
  });
});

describe("valuation from snapshots (§3)", () => {
  it("line discounts use the Phase 2 allocations, else pro-rate the order discount exactly", () => {
    const allocated = order({ lines: [line({ unitPrice: T(600), bundleDiscountAllocated: T(30), couponDiscountAllocated: T(70) }), line({ unitPrice: T(400), bundleDiscountAllocated: T(20), couponDiscountAllocated: 0 })], discount: T(120) });
    expect(lineDiscounts(allocated)).toEqual([T(100), T(20)]);
    const legacy = order({ lines: [line({ unitPrice: T(700) }), line({ unitPrice: T(300) })], discount: T(101), bundleDiscount: 0, couponDiscount: null });
    const parts = lineDiscounts(legacy);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(T(101));
    expect(parts[0]!).toBeGreaterThan(parts[1]!);
  });
  it("shipping charged: 0 when waived; the fee when not; the order's own arithmetic when unknown", () => {
    expect(shippingCharged(order({ shippingWaived: true }))).toBe(0);
    expect(shippingCharged(order())).toBe(T(60));
    expect(shippingCharged(order({ shippingWaived: null, subtotal: T(1000), discount: T(100), total: T(900) }))).toBe(0);
    expect(shippingCharged(order({ shippingWaived: null, subtotal: T(1000), discount: T(100), total: T(1020) }))).toBe(T(120));
  });
  it("returns are valued net of discounts at the return date; exchange-returned units are not returns (P5-3)", () => {
    const back = new Date("2026-09-20T10:00:00Z");
    const l1 = line({ variantId: "v1", unitPrice: T(1000), quantity: 2, returnedQuantity: 1 });
    const o = deliveredCod(new Date("2026-09-12T10:00:00Z"), { lines: [l1], discount: T(200), returnMovements: [{ variantId: "v1", units: 1, at: back }] });
    expect(returnEvents(o).map((e) => [e.units, e.value])).toEqual([[1, T(900)]]); // (2000 − 200) / 2
    const ex = deliveredCod(new Date("2026-09-12T10:00:00Z"), {
      lines: [line({ orderItemId: "exItem", variantId: "v2", returnedQuantity: 1 })],
      returnMovements: [{ variantId: "v2", units: 1, at: back }],
      exchangedLines: [{ orderItemId: "exItem", approvedAt: back }],
    });
    expect(returnEvents(ex)).toEqual([]);
  });
});

describe("aggregation (§4)", () => {
  const sep12 = new Date("2026-09-12T10:00:00Z");
  const sep15 = new Date("2026-09-15T10:00:00Z");
  const sep20 = new Date("2026-09-20T10:00:00Z");
  const orders: OrderFact[] = [
    order({ id: "pendingCod" }), // placed, not realised
    deliveredCod(sep12, { id: "deliveredCod", customerId: "c1" }),
    paidOnline(sep15, { id: "paid", customerId: "c2", lines: [line({ productId: "prodB", productName: "Product B", categoryId: "catB", unitPrice: T(2000) })], shippingWaived: true, shippingFee: T(60), total: T(2000), subtotal: T(2000), taxAmount: T(260) }),
    paidOnline(sep15, { id: "cancelledPaid", status: "CANCELLED", customerId: "c3", refunds: [{ amount: T(1060), status: "COMPLETED", completedAt: sep20 }] }),
    deliveredCod(sep12, { id: "trashed", deleted: true }),
    deliveredCod(sep12, { id: "replacement", isExchangeReplacement: true, total: T(200), payments: [{ amount: T(200), status: "SUCCEEDED", provider: "COD", settledAt: sep20 }] }),
    deliveredCod(sep12, {
      id: "returned",
      customerId: "c1",
      status: "RETURNED",
      lines: [line({ variantId: "rv", returnedQuantity: 1 })],
      returnMovements: [{ variantId: "rv", units: 1, at: sep20 }],
      refunds: [{ amount: T(500), status: "COMPLETED", completedAt: sep20 }],
      taxAmount: null,
    }),
  ];

  it("counts: placed / realised / cancelled use their own predicates", () => {
    expect(sum("orders_placed", orders)).toBe(4); // pendingCod, deliveredCod, paid, returned
    expect(sum("orders_realised", orders)).toBe(3); // deliveredCod, paid, returned
    expect(sum("orders_cancelled", orders)).toBe(1);
  });
  it("gross − discounts + shipping − returns = net sales; refunds and cash come from the ledger", () => {
    expect(sum("gross_merchandise_sales", orders)).toBe(T(1000 + 2000 + 1000));
    expect(sum("shipping_charged", orders)).toBe(T(60 + 0 + 60));
    expect(sum("returns", orders)).toBe(T(1000));
    expect(sum("net_merchandise_sales", orders)).toBe(T(3000));
    expect(sum("net_sales", orders)).toBe(T(3120));
    expect(sum("refunds", orders)).toBe(T(1060 + 500)); // cancelled order's refund counts in refunds, not in sales
    expect(sum("payments_received", orders)).toBe(T(1060 + 2000 + 1060 + 1060 + 200 + 1060)); // cash is cash, incl. trash/exchange
    expect(sum("collected_cash", orders)).toBe(sum("payments_received", orders) - sum("refunds", orders));
    expect(sum("exchange_difference_collected", orders)).toBe(T(200));
  });
  it("tax comes from the snapshot, with coverage for orders that have none", () => {
    expect(sum("tax_collected", orders)).toBe(T(260));
    expect(snapshotCoverage("tax_collected", orders, SEPT)).toEqual({ recorded: 2, missing: 1 });
  });
  it("units: ordered (placed) vs sold (realised) vs net of returns", () => {
    expect(sum("units_ordered", orders)).toBe(4);
    expect(sum("units_sold", orders)).toBe(3);
    expect(sum("units_returned", orders)).toBe(1);
    expect(sum("net_units_sold", orders)).toBe(2);
  });
  it("time basis: a return in another period hits that period, not the sale's", () => {
    const early = resolveBusinessRange({ from: "2026-09-01", to: "2026-09-16" }, TZ, new Date("2026-09-30T00:00:00Z"));
    expect(sum("returns", orders, early)).toBe(0);
    expect(sum("net_sales", orders, early)).toBe(T(4120));
  });
  it("AOV = realised net sales ÷ orders realised", () => {
    expect(sum("realised_net_sales", orders)).toBe(T(1500 + 1740));
    expect(aovOf(sum("realised_net_sales", orders), sum("orders_realised", orders))).toBe(T(1080));
    expect(aovOf(100, 0)).toBe(0);
  });
  it("M-3: day series, customer and product groupings all sum to the total", () => {
    const cs = contributions("net_sales", orders, SEPT);
    const by = (g: "day" | "customer" | "product") => {
      const m = new Map<string, number>();
      for (const c of cs) m.set(groupKeyOf(c, g, TZ).key, (m.get(groupKeyOf(c, g, TZ).key) ?? 0) + c.amount);
      return [...m.values()].reduce((a, b) => a + b, 0);
    };
    expect(by("day")).toBe(sum("net_sales", orders));
    expect(by("customer")).toBe(sum("net_sales", orders));
    expect(by("product")).toBe(sum("net_sales", orders));
  });
  it("customer metrics are a grouping of the same facts", () => {
    const s = customerStats(orders, SEPT);
    expect(s.customersWithOrders).toBe(3); // cust1 (pending), c1, c2
    expect(s.repeatCustomers).toBe(1); // c1: two sale orders
    // realised_net_sales per customer (PD-5.1): c1 = 1000 + 1000 − 500 goods refund; c2 = 2000 − 260 inclusive VAT.
    expect(s.customerLifetimeValue).toBe(Math.round((T(1500) + T(1740)) / 2));
  });
  it("point-in-time ledger totals (Phase 4 engine)", () => {
    const t = positionTotals([order({ id: "due" }), paidOnline(sep15, { status: "CANCELLED" })], "BDT");
    expect(t.outstandingCod).toBe(T(1060));
    expect(t.refundDue).toBe(T(1060));
  });
  it("inventory: per-variant low stock (D5), physical stock and value", () => {
    const t = inventoryTotals([
      { variantId: "a", productId: "p", stock: 2, trackInventory: true, lowStockThreshold: 5, held: true, purchasable: true, currentUnitCost: T(100) },
      { variantId: "b", productId: "p", stock: 0, trackInventory: true, lowStockThreshold: 5, held: true, purchasable: true, currentUnitCost: T(100) },
      { variantId: "c", productId: "p", stock: 0, trackInventory: false, lowStockThreshold: 5, held: true, purchasable: true, currentUnitCost: T(100) },
      { variantId: "d", productId: "q", stock: 9, trackInventory: true, lowStockThreshold: 5, held: true, purchasable: false, currentUnitCost: T(10) },
    ]);
    expect(t).toEqual({ stockOnHand: 11, lowStockVariants: 1, outOfStockVariants: 1, inventoryValue: T(290) });
  });
});
