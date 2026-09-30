import { describe, it, expect } from "vitest";
import {
  aovOf,
  contributions,
  customerStats,
  groupKeyOf,
  inclusiveTaxOf,
  money,
  resolveBusinessRange,
  sumOf,
  DEFAULT_ROUNDING_POLICY,
  type BusinessRange,
  type OrderFact,
} from "@clothing-brand/shared";
import { T, deliveredCod, line, order, paidOnline } from "./metrics-facts.fixture";

// Mutation tests (docs/METRICS_REGISTRY.md §8). The invariant suite encodes the defects the Phase 5 audit found
// (PHASE_5_METRICS_AUDIT §1–§2). Each mutant re-introduces one of them on top of the canonical engine; the suite must
// accept the canonical engine and reject every mutant.

interface Impl {
  metric: (key: string, orders: OrderFact[], range: BusinessRange) => number;
  aov: (orders: OrderFact[], range: BusinessRange) => number;
  customerSpend: (orders: OrderFact[], range: BusinessRange) => Map<string, number>;
  range: (from: string, to: string) => BusinessRange;
}

const TZ = "Asia/Dhaka";
const NOW = new Date("2026-09-30T12:00:00Z");
const canonicalMetric = (key: string, orders: OrderFact[], range: BusinessRange) => sumOf(contributions(key, orders, range));
const canonical: Impl = {
  metric: canonicalMetric,
  aov: (orders, range) => aovOf(canonicalMetric("net_sales", orders, range), canonicalMetric("orders_realised", orders, range)),
  customerSpend: (orders, range) => {
    const m = new Map<string, number>();
    for (const c of contributions("net_sales", orders, range)) m.set(c.order.customerId ?? "guest", (m.get(c.order.customerId ?? "guest") ?? 0) + c.amount);
    return m;
  },
  range: (from, to) => resolveBusinessRange({ from, to }, TZ, NOW),
};

// ── The fixture: one of every case the audit found mishandled ──
const d12 = new Date("2026-09-12T10:00:00Z");
const d20 = new Date("2026-09-20T10:00:00Z");
const lateNightDhaka = new Date("2026-09-24T19:30:00Z"); // 01:30 on Sep 25 in Dhaka, still Sep 24 in UTC
const FIXTURE: OrderFact[] = [
  deliveredCod(d12, { id: "sale", customerId: "c1", lines: [line({ productId: "p1", unitPrice: T(1000) })], taxAmount: T(130) }),
  paidOnline(d12, { id: "cancelled", status: "CANCELLED", customerId: "c2", refunds: [{ amount: T(1060), status: "COMPLETED", completedAt: d20 }] }),
  deliveredCod(d12, { id: "replacement", isExchangeReplacement: true, customerId: "c1", lines: [line({ productId: "p9", unitPrice: T(1200) })], discount: T(1000), total: T(200) }),
  deliveredCod(d12, {
    id: "exchangedOriginal",
    customerId: "c1",
    lines: [line({ orderItemId: "exLine", variantId: "exv", productId: "p2", unitPrice: T(1000), returnedQuantity: 1 })],
    returnMovements: [{ variantId: "exv", units: 1, at: d20 }],
    exchangedLines: [{ orderItemId: "exLine", approvedAt: d20 }],
    taxAmount: T(130),
  }),
  deliveredCod(d12, {
    id: "returned",
    customerId: "c3",
    status: "RETURNED",
    lines: [line({ variantId: "rv", productId: "p3", unitPrice: T(1000), quantity: 2, returnedQuantity: 1 })],
    returnMovements: [{ variantId: "rv", units: 1, at: d20 }],
    refunds: [{ amount: T(500), status: "COMPLETED", completedAt: d20 }],
    taxAmount: T(260),
  }),
  deliveredCod(d12, { id: "trashed", deleted: true, customerId: "c4" }),
  deliveredCod(lateNightDhaka, { id: "lateNight", customerId: "c5", placedAt: lateNightDhaka, lines: [line({ productId: null, productName: "Deleted product", unitPrice: T(500) })], total: T(560), subtotal: T(500), taxAmount: T(65) }),
  order({ id: "pendingCod", customerId: "c6" }),
];

/** A current catalog/tax state that differs from what the orders recorded. History must ignore it. */
const CURRENT_PRICE = T(1500);
const CURRENT_TAX_PCT = 7.5;

function violations(impl: Impl): string[] {
  const out: string[] = [];
  const check = (rule: string, ok: boolean) => { if (!ok) out.push(rule); };
  const sept = impl.range("2026-09-01", "2026-09-30");
  const m = (k: string, r = sept) => impl.metric(k, FIXTURE, r);

  // 1 / 2 / 12 — cancelled, exchange replacement and trashed orders are never sales; unattributed lines still count.
  check("orders_placed excludes cancelled/replacement/trashed", m("orders_placed") === 5);
  check("gross excludes cancelled/replacement/trashed", m("gross_merchandise_sales") === T(1000 + 1000 + 2000 + 500));
  // 3 — refunds are subtracted from cash.
  check("collected_cash nets refunds", m("collected_cash") === m("payments_received") - T(1060 + 500));
  // 4 — tax is the snapshot, never the current rate.
  check("tax is the snapshot", m("tax_collected") === T(130 + 130 + 260 + 65));
  // 5 — prices are the snapshot, never the current catalog price.
  check("gross uses price snapshots", m("gross_merchandise_sales") === T(4500));
  // 6 / 7 — business days in the store timezone: the late-night Dhaka order is on Sep 25, not Sep 24 (UTC date).
  check("store-timezone business day (Sep 25)", m("orders_realised", impl.range("2026-09-25", "2026-09-25")) === 1);
  check("store-timezone business day (not Sep 24)", m("orders_realised", impl.range("2026-09-24", "2026-09-24")) === 0);
  // 8 — returned units are not net sold.
  check("net units exclude returns", m("net_units_sold") === 1 + 1 + 2 + 1 - 1);
  // 9 — an exchange never double-counts merchandise: the original line stays sold, its units are not a return.
  check("exchange units are not returns", m("returns") === T(1000));
  check("net merchandise: exchange counted once", m("net_merchandise_sales") === T(4500 - 1000));
  // 10 — customer spend is the same net sales, grouped.
  const spend = impl.customerSpend(FIXTURE, sept);
  check("Σ customer spend = net sales", [...spend.values()].reduce((a, b) => a + b, 0) === m("net_sales"));
  check("customer c1 spend = own net sales", spend.get("c1") === T(1060 + 1060));
  // 11 — AOV denominator is orders realised.
  check("AOV = net sales ÷ realised orders", impl.aov(FIXTURE, sept) === aovOf(m("net_sales"), 4));
  // D1 — a pending COD order is not revenue.
  check("pending COD not realised", m("orders_realised") === 4);
  // Customer stats count the same sale orders.
  check("customers with orders", customerStats(FIXTURE, sept).customersWithOrders === 4);
  // Groupings reconcile.
  const byDay = new Map<string, number>();
  for (const c of contributions("net_sales", FIXTURE, sept)) byDay.set(groupKeyOf(c, "day", TZ).key, (byDay.get(groupKeyOf(c, "day", TZ).key) ?? 0) + c.amount);
  check("Σ day series = total", [...byDay.values()].reduce((a, b) => a + b, 0) === m("net_sales"));
  return out;
}

const withOrders = (map: (o: OrderFact) => OrderFact): Impl => ({
  ...canonical,
  metric: (k, orders, r) => canonicalMetric(k, orders.map(map), r),
  aov: (orders, r) => canonical.aov(orders.map(map), r),
  customerSpend: (orders, r) => canonical.customerSpend(orders.map(map), r),
});
const overrideMetric = (key: string, fn: (orders: OrderFact[], r: BusinessRange) => number): Impl => ({
  ...canonical,
  metric: (k, orders, r) => (k === key ? fn(orders, r) : canonicalMetric(k, orders, r)),
});

const MUTANTS: Array<[string, Impl]> = [
  ["1. include cancelled orders (status != CANCELLED dropped)", withOrders((o) => (o.status === "CANCELLED" ? { ...o, status: "CONFIRMED" } : o))],
  ["2. include exchange replacement orders", withOrders((o) => ({ ...o, isExchangeReplacement: false }))],
  ["3. ignore refunds in collected cash", overrideMetric("collected_cash", (orders, r) => canonicalMetric("payments_received", orders, r))],
  ["4. tax from the current rate instead of the snapshot", overrideMetric("tax_collected", (orders, r) => inclusiveTaxOf(money(canonicalMetric("net_sales", orders, r), "BDT"), CURRENT_TAX_PCT, DEFAULT_ROUNDING_POLICY.tax).amount)],
  ["5. current catalog price instead of the price snapshot", withOrders((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l, unitPrice: CURRENT_PRICE })) }))],
  ["6. NOW()/UTC day boundaries instead of the store timezone", { ...canonical, range: (from, to) => resolveBusinessRange({ from, to }, "UTC", NOW) }],
  ["7. UTC business date for buckets", { ...canonical, range: (from, to) => resolveBusinessRange({ from, to }, "Etc/GMT", NOW) }],
  ["8. returned units counted as sold", overrideMetric("net_units_sold", (orders, r) => canonicalMetric("units_sold", orders, r))],
  ["9a. exchange-returned units counted as returns", withOrders((o) => ({ ...o, exchangedLines: [] }))],
  ["9b. exchange replacement counted as a sale (double merchandise)", withOrders((o) => (o.isExchangeReplacement ? { ...o, isExchangeReplacement: false, discount: 0 } : o))],
  [
    "10. customer spend computed independently (Σ total of non-cancelled orders)",
    {
      ...canonical,
      customerSpend: (orders) => {
        const m = new Map<string, number>();
        for (const o of orders) if (o.status !== "CANCELLED") m.set(o.customerId ?? "guest", (m.get(o.customerId ?? "guest") ?? 0) + o.total);
        return m;
      },
    },
  ],
  ["11. AOV over orders placed instead of orders realised", { ...canonical, aov: (orders, r) => aovOf(canonicalMetric("net_sales", orders, r), canonicalMetric("orders_placed", orders, r)) }],
  ["12a. trashed orders counted", withOrders((o) => ({ ...o, deleted: false }))],
  ["12b. lines of deleted/trashed products dropped from history", withOrders((o) => ({ ...o, lines: o.lines.filter((l) => l.productId !== null) }))],
  ["D1. placed COD orders counted as realised", withOrders((o) => (o.paymentMethod === "COD" && !o.firstDeliveredAt ? { ...o, firstDeliveredAt: o.placedAt } : o))],
];

describe("metrics — mutation tests", () => {
  it("the canonical engine satisfies every invariant", () => {
    expect(violations(canonical)).toEqual([]);
  });
  it.each(MUTANTS)("kills mutant: %s", (_name, impl) => {
    expect(violations(impl).length).toBeGreaterThan(0);
  });
});
