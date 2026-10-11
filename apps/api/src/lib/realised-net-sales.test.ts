import { describe, it, expect } from "vitest";
import {
  aovOf,
  contributions,
  customerStats,
  groupKeyOf,
  merchandiseVat,
  refundAllocations,
  resolveBusinessRange,
  snapshotCoverage,
  sumOf,
  type BusinessRange,
  type OrderFact,
} from "@clothing-brand/shared";
import { T, deliveredCod, line, order, paidOnline } from "./metrics-facts.fixture";

// PD-5.1 (docs/BUSINESS_DECISIONS.md, METRICS_REGISTRY §3/§4.1): realised net sales = realised merchandise excluding VAT
// (tax snapshot) − the merchandise part of completed refunds (overpayment first, then goods first, capped); a realised
// order cancelled later is reversed in the cancellation period (P5-2); AOV and customer spend use it (P5-4, P5-5).

const TZ = "Asia/Dhaka";
const NOW = new Date("2026-09-30T12:00:00Z");
const range = (from: string, to = from): BusinessRange => resolveBusinessRange({ from, to }, TZ, NOW);
const SEPT = range("2026-09-01", "2026-09-30");
const sum = (key: string, orders: OrderFact[], r: BusinessRange = SEPT) => sumOf(contributions(key, orders, r));
const rns = (orders: OrderFact[], r: BusinessRange = SEPT) => sum("realised_net_sales", orders, r);

const d10 = new Date("2026-09-10T06:00:00Z");
const d12 = new Date("2026-09-12T06:00:00Z");
const d13 = new Date("2026-09-13T06:00:00Z");
const d14 = new Date("2026-09-14T06:00:00Z");
const d20 = new Date("2026-09-20T06:00:00Z");
const refund = (amount: number, at: Date) => ({ amount, status: "COMPLETED" as const, completedAt: at });

describe("realisation (D1, P5-1)", () => {
  it("1. a realised online sale counts at the settlement — merchandise only, shipping is separate", () => {
    const o = paidOnline(d12); // 1000 merchandise + 60 shipping, paid in full
    expect(rns([o])).toBe(T(1000));
    expect(sum("shipping_charged", [o])).toBe(T(60));
    expect(rns([o], range("2026-09-12"))).toBe(T(1000));
    const unpaid = { ...paidOnline(d12), payments: [] };
    expect(rns([unpaid])).toBe(0);
  });

  it("2. a realised COD sale counts at delivery, not at placement", () => {
    const o = deliveredCod(d12, { placedAt: d10 });
    expect(rns([o], range("2026-09-10"))).toBe(0);
    expect(rns([o], range("2026-09-12"))).toBe(T(1000));
  });

  it("3. an unrealised (pending) COD order is excluded, though it is an order placed", () => {
    const o = order();
    expect(rns([o])).toBe(0);
    expect(sum("orders_realised", [o])).toBe(0);
    expect(sum("orders_placed", [o])).toBe(1);
  });
});

describe("cancellation reversal (P5-2)", () => {
  it("4. a sale realised on day 1 and cancelled on day 3 stays in day 1 and is reversed on day 3; a later refund doesn't reduce it again", () => {
    const o = paidOnline(d12, { status: "CANCELLED", cancelledAt: d14, refunds: [refund(T(1060), d20)] });
    expect(rns([o], range("2026-09-12"))).toBe(T(1000)); // Day 1: +1000 — history untouched
    expect(rns([o], range("2026-09-14"))).toBe(-T(1000)); // Day 3: −1000 reversal
    expect(rns([o], range("2026-09-20"))).toBe(0); // the refund after the cancellation isn't a second reduction
    expect(rns([o])).toBe(0);
    expect(sum("orders_realised", [o], range("2026-09-12"))).toBe(1);
    expect(sum("orders_realised", [o], range("2026-09-14"))).toBe(-1);
    expect(sum("gross_merchandise_sales", [o], range("2026-09-14"))).toBe(-T(1000)); // every realised metric reverses
    expect(sum("refunds", [o])).toBe(T(1060)); // cash metrics are unchanged
  });

  it("a refund before the cancellation: the reversal nets it, total zero, never negative", () => {
    const o = paidOnline(d12, { status: "CANCELLED", cancelledAt: d14, refunds: [refund(T(1060), d13)] });
    expect(rns([o], range("2026-09-13"))).toBe(-T(1000));
    expect(rns([o], range("2026-09-14"))).toBe(0); // −(+1000) −(−1000)
    expect(rns([o])).toBe(0);
  });

  it("CANCELLED → REFUNDED is still a cancellation (history, not status); cancelled before realisation is never a sale", () => {
    const refunded = paidOnline(d12, { status: "REFUNDED", cancelledAt: d14, refunds: [refund(T(1060), d20)] });
    expect([rns([refunded], range("2026-09-12")), rns([refunded])]).toEqual([T(1000), 0]);
    expect(sum("orders_placed", [refunded])).toBe(0);
    const neverDelivered = order({ status: "CANCELLED", cancelledAt: d13 });
    expect([rns([neverDelivered]), sum("orders_realised", [neverDelivered])]).toEqual([0, 0]);
    // A legacy cancelled order with no history entry can't be reversed at a known time: excluded, nothing guessed.
    expect(rns([paidOnline(d12, { status: "CANCELLED" })])).toBe(0);
  });
});

describe("refund allocation (C3 goods first, capped · C4 overpayment first)", () => {
  it("5. a partial refund reduces merchandise by its amount", () => {
    const o = deliveredCod(d12, { refunds: [refund(T(400), d20)] });
    expect(rns([o])).toBe(T(600));
    expect(sum("merchandise_refunds", [o])).toBe(T(400));
    expect(rns([o], range("2026-09-20"))).toBe(-T(400)); // in the refund's period
  });

  it("6. a full refund nets merchandise to zero; the shipping part is non-merchandise", () => {
    const o = deliveredCod(d12, { refunds: [refund(T(1060), d20)] });
    expect(rns([o])).toBe(0);
    expect(refundAllocations(o)).toEqual([{ at: d20, amount: T(1060), overpayment: 0, merchandise: T(1000), merchandiseExVat: T(1000), other: T(60) }]);
  });

  it("7. an overpayment refund never reduces merchandise sales (total 1000, paid 1200, refund 200)", () => {
    const o = paidOnline(d12, {
      shippingFee: 0,
      total: T(1000),
      payments: [
        { amount: T(1000), status: "SUCCEEDED", provider: "EPS_PG", settledAt: d12 },
        { amount: T(200), status: "SUCCEEDED", provider: "MANUAL", settledAt: d13 },
      ],
      refunds: [refund(T(200), d20)],
    });
    expect(rns([o])).toBe(T(1000));
    expect(sum("overpayment_refunds", [o])).toBe(T(200));
    expect(sum("merchandise_refunds", [o])).toBe(0);
    // Only what is left after the overage reduces merchandise: a further 300 refund is merchandise.
    const more = { ...o, refunds: [refund(T(200), d20), refund(T(300), d20)] };
    expect(rns([more])).toBe(T(700));
  });

  it("8. goods first, capped — not pro-rata over the order total", () => {
    const o = deliveredCod(d12, { shippingFee: T(100), refunds: [refund(T(300), d20)] }); // total 1100
    expect(rns([o])).toBe(T(700)); // pro-rata would be 1000 − 300 × 1000/1100 = 727.27
    const capped = deliveredCod(d12, { shippingFee: T(100), refunds: [refund(T(1000), d13), refund(T(100), d20)] });
    expect(rns([capped])).toBe(0); // the second refund finds no merchandise left: it is shipping, never negative sales
    expect(refundAllocations(capped)[1]).toMatchObject({ merchandise: 0, other: T(100) });
  });
});

describe("exchanges (P5-3, D6)", () => {
  const exchanged = (over: Partial<OrderFact> = {}) =>
    deliveredCod(d12, {
      lines: [line({ orderItemId: "exLine", variantId: "exv" })],
      returnMovements: [{ variantId: "exv", units: 1, at: d14 }],
      exchangedLines: [{ orderItemId: "exLine", approvedAt: d14 }],
      ...over,
    });

  it("9. a downgrade difference refund on the original is a merchandise refund, in full", () => {
    const original = exchanged({ refunds: [refund(T(200), d20)] });
    const replacement = deliveredCod(d14, { isExchangeReplacement: true, lines: [line({ unitPrice: T(800) })], discount: T(800), shippingFee: 0, total: 0, payments: [] });
    expect(rns([original, replacement])).toBe(T(800));
    expect(sum("returns", [original])).toBe(0); // the exchanged unit is not a return
  });

  it("10. an upgrade difference collected on the replacement is not merchandise sales", () => {
    const original = exchanged();
    const replacement = deliveredCod(d20, { isExchangeReplacement: true, lines: [line({ unitPrice: T(1300) })], discount: T(1000), shippingFee: 0, total: T(300) });
    expect(rns([original, replacement])).toBe(T(1000));
    expect(sum("exchange_difference_collected", [original, replacement])).toBe(T(300));
  });
});

describe("merchandise VAT from the order's snapshot (C2)", () => {
  it("11. inclusive VAT is excluded from merchandise; exclusive VAT was never inside it; gross stays as charged", () => {
    const inclusive = deliveredCod(d12, { lines: [line({ unitPrice: T(1150) })], taxMode: "INCLUSIVE", taxAmount: T(159), shippingTaxAmount: T(9) });
    expect(merchandiseVat(inclusive)).toBe(T(150));
    expect(rns([inclusive])).toBe(T(1000));
    expect(sum("merchandise_vat", [inclusive])).toBe(T(150));
    expect(sum("gross_merchandise_sales", [inclusive])).toBe(T(1150));
    const exclusive = deliveredCod(d12, { taxMode: "EXCLUSIVE", taxAmount: T(150), shippingTaxAmount: 0, total: T(1210) });
    expect([rns([exclusive]), sum("merchandise_vat", [exclusive])]).toEqual([T(1000), 0]);
    // Per-line VAT is an allocation by line net (largest remainder); it sums exactly to the order's merchandise VAT.
    const twoLines = deliveredCod(d12, {
      lines: [line({ productId: "pA", unitPrice: T(1150) }), line({ productId: "pB", unitPrice: T(2300) })],
      taxAmount: T(450),
      shippingTaxAmount: 0,
    });
    const byProduct = new Map<string, number>();
    for (const c of contributions("merchandise_vat", [twoLines], SEPT)) byProduct.set(groupKeyOf(c, "product", TZ).key, c.amount);
    expect(Object.fromEntries(byProduct)).toEqual({ pA: T(150), pB: T(300) });
    // A refund of VAT-inclusive goods reduces sales by the VAT-exclusive equivalent; a full refund nets to exactly zero.
    const refunded = { ...inclusive, refunds: [refund(T(575), d20)] };
    expect(rns([refunded])).toBe(T(500));
    expect(rns([{ ...inclusive, refunds: [refund(T(1219), d20)] }])).toBe(0);
  });

  it("12. missing tax snapshot: no guess, no current rate — charged value kept and the gap reported as coverage", () => {
    const legacy = deliveredCod(d12, { lines: [line({ unitPrice: T(1150) })], taxMode: null, taxAmount: null, shippingTaxAmount: null });
    const partial = deliveredCod(d12, { lines: [line({ unitPrice: T(1150) })], taxMode: "INCLUSIVE", taxAmount: T(159), shippingTaxAmount: null });
    const recorded = deliveredCod(d12, { lines: [line({ unitPrice: T(1150) })], taxAmount: T(150), shippingTaxAmount: 0 });
    expect([merchandiseVat(legacy), merchandiseVat(partial)]).toEqual([null, null]);
    expect(rns([legacy, partial, recorded])).toBe(T(1150 + 1150 + 1000));
    expect(snapshotCoverage("realised_net_sales", [legacy, partial, recorded], SEPT)).toEqual({ recorded: 1, missing: 2 });
    expect(snapshotCoverage("merchandise_vat", [legacy, partial, recorded], SEPT)).toEqual({ recorded: 1, missing: 2 });
  });
});

describe("AOV and customer spend (P5-5, P5-4)", () => {
  const a = deliveredCod(d12, { customerId: "cA" });
  const b = deliveredCod(d12, { customerId: "cB", refunds: [refund(T(400), d20)] });
  const cancelledLater = paidOnline(d12, { customerId: "cC", status: "CANCELLED", cancelledAt: d14 });

  it("13. AOV = realised net sales ÷ orders realised (not the old net sales incl. shipping)", () => {
    expect(aovOf(rns([a, b]), sum("orders_realised", [a, b]))).toBe(T(800)); // (1000 + 600) / 2
    expect(aovOf(sum("net_sales", [a, b]), 2)).toBe(T(1060)); // the old basis differs
  });

  it("14. numerator and denominator share the realisation population, reversals included", () => {
    const all = [a, b, cancelledLater];
    // Whole month: the cancelled order is +1000/+1 and −1000/−1 — out of both.
    expect([rns(all), sum("orders_realised", all)]).toEqual([T(1600), 2]);
    // Day 12 only (before the cancellation): it is in both.
    expect([rns(all, range("2026-09-12")), sum("orders_realised", all, range("2026-09-12"))]).toEqual([T(3000), 3]);
    // A refunded order stays in the denominator (it was realised); its refund lowers the numerator.
    expect(sum("orders_realised", [b])).toBe(1);
  });

  it("15. customer spend and CLV follow realised net sales", () => {
    const all = [a, b, cancelledLater];
    const spend = new Map<string, number>();
    for (const c of contributions("realised_net_sales", all, SEPT)) spend.set(c.order.customerId!, (spend.get(c.order.customerId!) ?? 0) + c.amount);
    expect(Object.fromEntries(spend)).toEqual({ cA: T(1000), cB: T(600), cC: 0 });
    expect(customerStats(all, SEPT).customerLifetimeValue).toBe(T(800)); // (1000 + 600) / 2 standing realised customers
  });
});

describe("bridge and reconciliation", () => {
  it("realised net sales = gross − discounts − merchandise VAT − merchandise refunds; day series sum to the total", () => {
    const orders = [
      deliveredCod(d12, { lines: [line({ unitPrice: T(1150) })], taxAmount: T(159), shippingTaxAmount: T(9), refunds: [refund(T(300), d20)] }),
      paidOnline(d13, { discount: T(100), total: T(960), refunds: [refund(T(100), d20)] }),
      paidOnline(d12, { status: "CANCELLED", cancelledAt: d14 }),
    ];
    const bridge = sum("gross_merchandise_sales", orders) - sum("discounts", orders) - sum("merchandise_vat", orders) - sum("merchandise_refunds", orders);
    expect(rns(orders)).toBe(bridge);
    const byDay = new Map<string, number>();
    for (const c of contributions("realised_net_sales", orders, SEPT)) byDay.set(groupKeyOf(c, "day", TZ).key, (byDay.get(groupKeyOf(c, "day", TZ).key) ?? 0) + c.amount);
    expect([...byDay.values()].reduce((x, y) => x + y, 0)).toBe(rns(orders));
  });
});
