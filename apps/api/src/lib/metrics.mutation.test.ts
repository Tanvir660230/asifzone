import { describe, it, expect } from "vitest";
import {
  aovOf,
  contributions,
  customerStats,
  groupKeyOf,
  inRange,
  inclusiveTaxOf,
  lineNets,
  merchandiseVat,
  money,
  realisationOf,
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
  /** How the implementation's loader presents a fact (identity for the canonical loader; mutants model a loader defect). */
  facts: (o: OrderFact) => OrderFact;
  aov: (orders: OrderFact[], range: BusinessRange) => number;
  customerSpend: (orders: OrderFact[], range: BusinessRange) => Map<string, number>;
  range: (from: string, to: string) => BusinessRange;
}

const TZ = "Asia/Dhaka";
const NOW = new Date("2026-09-30T12:00:00Z");
const canonicalMetric = (key: string, orders: OrderFact[], range: BusinessRange) => sumOf(contributions(key, orders, range));
const canonical: Impl = {
  metric: canonicalMetric,
  facts: (o) => o,
  aov: (orders, range) => aovOf(canonicalMetric("realised_net_sales", orders, range), canonicalMetric("orders_realised", orders, range)),
  customerSpend: (orders, range) => {
    const m = new Map<string, number>();
    for (const c of contributions("realised_net_sales", orders, range)) m.set(c.order.customerId ?? "guest", (m.get(c.order.customerId ?? "guest") ?? 0) + c.amount);
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

// PD-5.1 fixture (docs/BUSINESS_DECISIONS.md PD-5.1; METRICS_REGISTRY §3).
const d21 = new Date("2026-09-21T10:00:00Z");
const day12 = resolveBusinessRange({ from: "2026-09-12", to: "2026-09-12" }, TZ, NOW);
const day20 = resolveBusinessRange({ from: "2026-09-20", to: "2026-09-20" }, TZ, NOW);
const PD: OrderFact[] = [
  // total 1060, paid 1060 + a duplicate 200, refund 200 → overpayment only
  paidOnline(d12, {
    id: "overpaid",
    customerId: "k1",
    payments: [
      { amount: T(1060), status: "SUCCEEDED", provider: "EPS_PG", settledAt: d12 },
      { amount: T(200), status: "SUCCEEDED", provider: "MANUAL", settledAt: d12 },
    ],
    refunds: [{ amount: T(200), status: "COMPLETED", completedAt: d20 }],
  }),
  // merchandise 1000 + shipping 100; refund 300 → goods first: 700 (pro-rata would give 727.27)
  deliveredCod(d12, { id: "shipRefund", customerId: "k2", shippingFee: T(100), refunds: [{ amount: T(300), status: "COMPLETED", completedAt: d20 }] }),
  // paid on the 12th, cancelled on the 20th, refunded on the 21st
  paidOnline(d12, { id: "cancelledAfter", customerId: "k3", status: "CANCELLED", cancelledAt: d20, refunds: [{ amount: T(1060), status: "COMPLETED", completedAt: d21 }] }),
  // 1150 inclusive of 150 merchandise VAT (+ 9 shipping VAT)
  deliveredCod(d12, { id: "inclusiveVat", customerId: "k4", lines: [line({ unitPrice: T(1150) })], taxAmount: T(159), shippingTaxAmount: T(9) }),
  // exchange upgrade: the replacement's 300 difference is collected, not sold
  deliveredCod(d12, {
    id: "upOrig",
    customerId: "k5",
    lines: [line({ orderItemId: "upLine", variantId: "upv" })],
    returnMovements: [{ variantId: "upv", units: 1, at: d20 }],
    exchangedLines: [{ orderItemId: "upLine", approvedAt: d20 }],
  }),
  deliveredCod(d20, { id: "upRepl", isExchangeReplacement: true, customerId: "k5", lines: [line({ unitPrice: T(1300) })], discount: T(1000), shippingFee: 0, total: T(300) }),
  // exchange downgrade: a 200 difference refund on the original
  deliveredCod(d12, {
    id: "downOrig",
    customerId: "k6",
    lines: [line({ orderItemId: "dnLine", variantId: "dnv" })],
    returnMovements: [{ variantId: "dnv", units: 1, at: d20 }],
    exchangedLines: [{ orderItemId: "dnLine", approvedAt: d20 }],
    refunds: [{ amount: T(200), status: "COMPLETED", completedAt: d21 }],
  }),
];

/** An alternative refund reduction, for the allocation mutants: the canonical positive part minus a different split. */
function altRealisedNet(orders: OrderFact[], r: BusinessRange, mode: "refundBeforeOverpayment" | "proRata"): number {
  const positive = canonicalMetric("realised_net_sales", orders, r) + canonicalMetric("merchandise_refunds", orders, r);
  let reduction = 0;
  for (const o of orders) {
    const real = realisationOf(o);
    if (!real || real.reversedAt) continue;
    const merchCharged = lineNets(o).reduce((a, b) => a + b, 0);
    const exVat = merchCharged - (merchandiseVat(o) ?? 0);
    let remaining = merchCharged;
    for (const f of o.refunds) {
      if (f.status !== "COMPLETED" || !inRange(f.completedAt, r)) continue;
      if (mode === "refundBeforeOverpayment") {
        const part = Math.min(f.amount, remaining);
        remaining -= part;
        reduction += Math.round((part * exVat) / merchCharged);
      } else {
        reduction += Math.round((f.amount * exVat) / o.total);
      }
    }
  }
  return positive - reduction;
}

// Phase 6 fixture: what the line recorded vs what the catalog says today.
const P6: OrderFact[] = [
  deliveredCod(d12, {
    id: "costed",
    lines: [line({ unitPrice: T(1150), unitCostSnapshot: T(400), categoryId: "catThen", categoryName: "Shirts", brand: "Brand Then" })],
    subtotal: T(1150),
    total: T(1210),
    taxAmount: T(150),
    shippingTaxAmount: 0,
  }),
  deliveredCod(d12, { id: "uncosted", lines: [line({ unitCostSnapshot: null })] }),
  deliveredCod(d12, {
    id: "mixed",
    lines: [line({ unitCostSnapshot: T(400) }), line({ unitCostSnapshot: null })],
    subtotal: T(2000),
    total: T(2060),
  }),
  deliveredCod(d12, { id: "legacy", lines: [line({ attributionRecorded: false, categoryId: null, categoryName: null, brand: null, unitCostSnapshot: null })] }),
  deliveredCod(d12, { id: "deletedProduct", lines: [line({ variantId: "goneVariant", productId: "pGone", unitCostSnapshot: T(400) })] }),
];
/** Today's catalog, which differs from what was recorded. */
const CURRENT_COST = T(900);
const CURRENT_CATEGORY = { categoryId: "catNow", categoryName: "Trousers" };
const CURRENT_BRAND = "Brand Now";

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
  // 10 — customer spend is the same realised net sales, grouped (P5-4). c1: two sales of 1000 with 130 inclusive VAT.
  const spend = impl.customerSpend(FIXTURE, sept);
  check("Σ customer spend = realised net sales", [...spend.values()].reduce((a, b) => a + b, 0) === m("realised_net_sales"));
  check("customer c1 spend = own realised net sales", spend.get("c1") === T(870 + 870));
  // 11 — AOV = realised net sales ÷ orders realised (P5-5).
  check("AOV = realised net sales ÷ realised orders", impl.aov(FIXTURE, sept) === aovOf(m("realised_net_sales"), 4));
  // D1 — a pending COD order is not revenue.
  check("pending COD not realised", m("orders_realised") === 4);
  // Customer stats count the same sale orders.
  check("customers with orders", customerStats(FIXTURE, sept).customersWithOrders === 4);
  // Groupings reconcile.
  const byDay = new Map<string, number>();
  for (const c of contributions("realised_net_sales", FIXTURE, sept)) byDay.set(groupKeyOf(c, "day", TZ).key, (byDay.get(groupKeyOf(c, "day", TZ).key) ?? 0) + c.amount);
  check("Σ day series = total", [...byDay.values()].reduce((a, b) => a + b, 0) === m("realised_net_sales"));

  // ── PD-5.1 (headline, refund hierarchy, merchandise VAT, reversal, exchanges, AOV population) ──
  const one = (id: string) => PD.filter((o) => o.id === id);
  const rns = (orders: OrderFact[], r = sept) => impl.metric("realised_net_sales", orders, r);
  check("headline realised net sales (merchandise ex VAT − merchandise refunds)", rns(PD) === T(4500));
  check("overpayment refund doesn't reduce sales", rns(one("overpaid")) === T(1000));
  check("goods first, capped (not pro-rata)", rns(one("shipRefund")) === T(700));
  check("merchandise VAT from the order's snapshot", rns(one("inclusiveVat")) === T(1000));
  check("cancellation: sale stays on its day", rns(one("cancelledAfter"), day12) === T(1000));
  check("cancellation: reversal on the cancellation day", rns(one("cancelledAfter"), day20) === -T(1000));
  check("exchange downgrade refund is a merchandise refund", rns(one("downOrig")) === T(800));
  check("exchange upgrade difference is not a sale", rns([...one("upOrig"), ...one("upRepl")]) === T(1000));
  check("AOV over the realisation population (month)", impl.aov(PD, sept) === aovOf(T(4500), 5));
  check("AOV over the realisation population (day of sale)", impl.aov(PD, day12) === aovOf(T(6000), 6));
  check("customer spend follows realised net sales", impl.customerSpend(PD, sept).get("k6") === T(800));

  // ── Phase 6: recorded cost and attribution snapshots ──
  const h = (id: string) => P6.filter((o) => o.id === id);
  check("COGS from the recorded cost", impl.metric("cogs", h("costed"), sept) === T(400));
  check("margin from the recorded cost, ex VAT", impl.metric("gross_margin", h("costed"), sept) === T(1150 - 150 - 400));
  check("uncosted line is unknown, not zero cost", impl.metric("cogs", h("uncosted"), sept) === 0 && impl.metric("gross_margin", h("uncosted"), sept) === 0);
  check("mixed order: margin over the costed line only", impl.metric("gross_margin", h("mixed"), sept) === T(600));
  const catOf = (id: string) => {
    const cs = contributions("gross_merchandise_sales", h(id).map(impl.facts), sept);
    return cs.length ? groupKeyOf(cs[0]!, "category", TZ).key : "none";
  };
  const brandOf = (id: string) => {
    const cs = contributions("gross_merchandise_sales", h(id).map(impl.facts), sept);
    return cs.length ? groupKeyOf(cs[0]!, "brand", TZ).key : "none";
  };
  check("category from the snapshot", catOf("costed") === "catThen");
  check("brand from the snapshot", brandOf("costed") === "Brand Then");
  check("pre-Phase-6 line is not recorded, not re-attributed", catOf("legacy") === "not_recorded" && brandOf("legacy") === "not_recorded");
  check("deleted product keeps its attribution", contributions("gross_merchandise_sales", h("deletedProduct").map(impl.facts), sept)[0]?.line?.productId === "pGone");
  return out;
}

const withOrders = (map: (o: OrderFact) => OrderFact): Impl => ({
  ...canonical,
  facts: map,
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
  ["11. AOV over orders placed instead of orders realised", { ...canonical, aov: (orders, r) => aovOf(canonicalMetric("realised_net_sales", orders, r), canonicalMetric("orders_placed", orders, r)) }],
  ["11b. AOV denominator = payments instead of orders realised", { ...canonical, aov: (orders, r) => aovOf(canonicalMetric("realised_net_sales", orders, r), canonicalMetric("payment_count", orders, r)) }],
  ["12a. trashed orders counted", withOrders((o) => ({ ...o, deleted: false }))],
  ["12b. lines of deleted/trashed products dropped from history", withOrders((o) => ({ ...o, lines: o.lines.filter((l) => l.productId !== null) }))],
  ["D1. placed COD orders counted as realised", withOrders((o) => (o.paymentMethod === "COD" && !o.firstDeliveredAt ? { ...o, firstDeliveredAt: o.placedAt } : o))],
  // PD-5.1
  [
    "PD-1. old net_sales used as the headline (and for AOV / customer spend)",
    {
      ...overrideMetric("realised_net_sales", (orders, r) => canonicalMetric("net_sales", orders, r)),
      aov: (orders, r) => aovOf(canonicalMetric("net_sales", orders, r), canonicalMetric("orders_realised", orders, r)),
      customerSpend: (orders, r) => {
        const m = new Map<string, number>();
        for (const c of contributions("net_sales", orders, r)) m.set(c.order.customerId ?? "guest", (m.get(c.order.customerId ?? "guest") ?? 0) + c.amount);
        return m;
      },
    },
  ],
  ["PD-2. refund allocated to goods before the payment overage", overrideMetric("realised_net_sales", (orders, r) => altRealisedNet(orders, r, "refundBeforeOverpayment"))],
  ["PD-3. pro-rata refund allocation over the order total", overrideMetric("realised_net_sales", (orders, r) => altRealisedNet(orders, r, "proRata"))],
  [
    "PD-4. merchandise VAT from the current tax rate instead of the order's snapshot",
    withOrders((o) =>
      o.taxMode === "INCLUSIVE" && (o.taxAmount ?? 0) > 0
        ? { ...o, shippingTaxAmount: 0, taxAmount: inclusiveTaxOf(money(lineNets(o).reduce((a, b) => a + b, 0), "BDT"), CURRENT_TAX_PCT, DEFAULT_ROUNDING_POLICY.tax).amount }
        : o,
    ),
  ],
  ["PD-5. cancellation retroactively deletes the historical sale", withOrders((o) => (o.cancelledAt ? { ...o, cancelledAt: null, status: "CANCELLED" } : o))],
  ["PD-6. exchange upgrade difference counted as a new sale", overrideMetric("realised_net_sales", (orders, r) => canonicalMetric("realised_net_sales", orders, r) + canonicalMetric("exchange_difference_collected", orders, r))],
  // Phase 6
  ["P6-1. COGS from the current cost price instead of the line's recorded cost", withOrders((o) => ({ ...o, lines: o.lines.map((l) => (l.unitCostSnapshot === null ? l : { ...l, unitCostSnapshot: CURRENT_COST })) }))],
  ["P6-2. unknown cost counted as zero", withOrders((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l, unitCostSnapshot: l.unitCostSnapshot ?? 0 })) }))],
  ["P6-3. old lines backfilled with today's cost (fabricated history)", withOrders((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l, unitCostSnapshot: l.unitCostSnapshot ?? CURRENT_COST })) }))],
  [
    "P6-4. gross margin as net merchandise − COGS (uncosted revenue counted, VAT included)",
    overrideMetric("gross_margin", (orders, r) => canonicalMetric("net_merchandise_sales", orders, r) - canonicalMetric("cogs", orders, r)),
  ],
  ["P6-5. category from today's product instead of the snapshot", withOrders((o) => ({ ...o, lines: o.lines.map((l) => (l.attributionRecorded ? { ...l, ...CURRENT_CATEGORY } : l)) }))],
  ["P6-6. brand from today's product instead of the snapshot", withOrders((o) => ({ ...o, lines: o.lines.map((l) => (l.attributionRecorded ? { ...l, brand: CURRENT_BRAND } : l)) }))],
  ["P6-7. pre-Phase-6 lines re-attributed to today's category/brand", withOrders((o) => ({ ...o, lines: o.lines.map((l) => (l.attributionRecorded ? l : { ...l, attributionRecorded: true, ...CURRENT_CATEGORY, brand: CURRENT_BRAND })) }))],
  ["P6-8. product snapshot ignored: a permanently deleted product's lines lose their product", withOrders((o) => ({ ...o, lines: o.lines.map((l) => (l.variantId === "goneVariant" ? { ...l, productId: null } : l)) }))],
];

describe("metrics — mutation tests", () => {
  it("the canonical engine satisfies every invariant", () => {
    expect(violations(canonical)).toEqual([]);
  });
  it.each(MUTANTS)("kills mutant: %s", (_name, impl) => {
    expect(violations(impl).length).toBeGreaterThan(0);
  });
});
