/**
 * The metrics engine (docs/METRICS_REGISTRY.md §4) — pure. Every registry metric is a signed sum of *contributions*:
 * facts that each carry an instant (their time basis), an amount and the order/line they came from. A range total, a
 * day/month/year series and a product/category/customer/payment-method grouping are therefore the same numbers cut
 * differently, which is what makes the cross-surface checks (M-3) hold by construction.
 */
import { derivePaymentPosition } from "../engines/payment-ledger";
import { money } from "../engines/money";
import { bucketKey, inRange, type BusinessRange } from "./business-time";
import {
  couponDiscountOf,
  isCancelled,
  isOperationalOrder,
  isSaleOrder,
  lineDiscounts,
  lineGross,
  lineMerchandiseVat,
  lineNets,
  merchandiseVat,
  realisationOf,
  realisedAt,
  refundAllocations,
  returnEvents,
  shippingCharged,
  type InventoryVariantFact,
  type LineFact,
  type OrderFact,
} from "./facts";
import { metricDefinition, type MetricGrouping } from "./registry";
import { variantStockState } from "../engines/availability";

/** A successful settlement that brought new money in — every provider except STORE_CREDIT (credit spent on an order). */
function isCashSettlement(p: OrderFact["payments"][number]): boolean {
  return p.status === "SUCCEEDED" && p.provider !== "STORE_CREDIT";
}

export interface Contribution {
  at: Date | null;
  amount: number;
  order: OrderFact;
  line?: LineFact;
}

type Producer = (o: OrderFact) => Contribution[];

const one = (at: Date | null, amount: number, order: OrderFact, line?: LineFact): Contribution => ({ at, amount, order, line });

// ─── Base producers ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Realised-basis contributions of an order (P5-2). `build` gets the realisation instant. For an order cancelled after
 * it was realised, every contribution before the cancellation is repeated with the opposite sign AT the cancellation
 * instant, and anything after it is dropped: earlier periods never change and the net effect is zero. */
function realised(o: OrderFact, build: (at: Date) => Contribution[]): Contribution[] {
  const r = realisationOf(o);
  if (!r) return [];
  const cs = build(r.at);
  if (!r.reversedAt) return cs;
  const cut = r.reversedAt.getTime();
  const out: Contribution[] = [];
  for (const c of cs) {
    if (!c.at || c.at.getTime() >= cut) continue;
    out.push(c, { ...c, at: r.reversedAt, amount: -c.amount });
  }
  return out;
}

const P = {
  placed: (o: OrderFact) => (isSaleOrder(o) ? [one(o.placedAt, 1, o)] : []),
  realised: (o: OrderFact) => realised(o, (at) => [one(at, 1, o)]),
  cancelled: (o: OrderFact) => (isOperationalOrder(o) && isCancelled(o) ? [one(o.placedAt, 1, o)] : []),
  cancelledValue: (o: OrderFact) => (isOperationalOrder(o) && isCancelled(o) ? [one(o.placedAt, o.total, o)] : []),
  gross: (o: OrderFact) => realised(o, (at) => o.lines.map((l) => one(at, lineGross(l), o, l))),
  discountLines: (o: OrderFact) =>
    realised(o, (at) => {
      const d = lineDiscounts(o);
      return o.lines.map((l, i) => one(at, d[i]!, o, l));
    }),
  bundle: (o: OrderFact) => atRealised(o, o.bundleDiscount),
  coupon: (o: OrderFact) => atRealised(o, couponDiscountOf(o)),
  flash: (o: OrderFact) => atRealised(o, o.flashDiscount ?? 0),
  shipping: (o: OrderFact) => atRealised(o, shippingCharged(o)),
  adjustments: (o: OrderFact) => atRealised(o, o.priceAdjustment),
  tax: (o: OrderFact) => atRealised(o, o.taxAmount ?? 0),
  /** Merchandise VAT from the order's snapshot, allocated to lines (C2). */
  merchVat: (o: OrderFact) =>
    realised(o, (at) => {
      const v = lineMerchandiseVat(o);
      return o.lines.map((l, i) => one(at, v[i]!, o, l));
    }),
  /** Realised merchandise excluding VAT, per line (the positive part of realised_net_sales). */
  realisedMerch: (o: OrderFact) =>
    realised(o, (at) => {
      const nets = lineNets(o);
      const v = lineMerchandiseVat(o);
      return o.lines.map((l, i) => one(at, nets[i]! - v[i]!, o, l));
    }),
  /** VAT-exclusive merchandise part of completed refunds (C3, after overpayment — C4). Order-level: a refund names no line. */
  merchRefunds: (o: OrderFact) =>
    realised(o, () =>
      refundAllocations(o)
        .filter((a) => a.merchandiseExVat > 0)
        .map((a) => one(a.at, a.merchandiseExVat, o)),
    ),
  /** Overpayment part of completed refunds (any order): cash only, never a sales reduction. */
  overpaymentRefunds: (o: OrderFact) =>
    refundAllocations(o)
      .filter((a) => a.overpayment > 0)
      .map((a) => one(a.at, a.overpayment, o)),
  returnsValue: (o: OrderFact) => realised(o, () => returnEvents(o).map((e) => one(e.at, e.value, o, e.line))),
  refunds: (o: OrderFact) => o.refunds.filter((r) => r.status === "COMPLETED" && r.completedAt).map((r) => one(r.completedAt, r.amount, o)),
  refundCount: (o: OrderFact) => o.refunds.filter((r) => r.status === "COMPLETED" && r.completedAt).map((r) => one(r.completedAt, 1, o)),
  // Money received: store credit spent on an order is not new money (it was received once, on the order it came from).
  payments: (o: OrderFact) => o.payments.filter(isCashSettlement).map((p) => one(p.settledAt, p.amount, o)),
  paymentCount: (o: OrderFact) => o.payments.filter(isCashSettlement).map((p) => one(p.settledAt, 1, o)),
  exchangeDiff: (o: OrderFact) => (o.isExchangeReplacement ? o.payments.filter(isCashSettlement).map((p) => one(p.settledAt, p.amount, o)) : []),
  codPlaced: (o: OrderFact) => (isSaleOrder(o) && o.paymentMethod === "COD" ? [one(o.placedAt, 1, o)] : []),
  unitsOrdered: (o: OrderFact) => (isSaleOrder(o) ? o.lines.map((l) => one(o.placedAt, l.quantity, o, l)) : []),
  unitsSold: (o: OrderFact) => realised(o, (at) => o.lines.map((l) => one(at, l.quantity, o, l))),
  unitsReturned: (o: OrderFact) => realised(o, () => returnEvents(o).map((e) => one(e.at, e.units, o, e.line))),
  /** Recorded cost of units sold — lines without a recorded cost are unknown and excluded (P6-2, never counted at 0). */
  cogsSold: (o: OrderFact) => realised(o, (at) => o.lines.filter((l) => l.unitCostSnapshot !== null).map((l) => one(at, l.quantity * l.unitCostSnapshot!, o, l))),
  cogsReturned: (o: OrderFact) =>
    realised(o, () =>
      returnEvents(o)
        .filter((e) => e.cost !== null)
        .map((e) => one(e.at, e.cost!, o, e.line)),
    ),
  /** Margin over costed lines only: merchandise excluding VAT − recorded cost (same population on both sides). */
  marginSold: (o: OrderFact) =>
    realised(o, (at) => {
      const nets = lineNets(o);
      const v = lineMerchandiseVat(o);
      return o.lines.flatMap((l, i) => (l.unitCostSnapshot === null ? [] : [one(at, nets[i]! - v[i]! - l.quantity * l.unitCostSnapshot, o, l)]));
    }),
  marginReturned: (o: OrderFact) =>
    realised(o, () =>
      returnEvents(o)
        .filter((e) => e.cost !== null)
        .map((e) => one(e.at, e.valueExVat - e.cost!, o, e.line)),
    ),
} satisfies Record<string, Producer>;

function atRealised(o: OrderFact, amount: number): Contribution[] {
  return realised(o, (at) => [one(at, amount, o)]);
}

type Term = [sign: 1 | -1, producer: Producer];

/** Registry key → signed producers (additive metrics only). */
const ADDITIVE: Record<string, Term[]> = {
  orders_placed: [[1, P.placed]],
  orders_realised: [[1, P.realised]],
  orders_cancelled: [[1, P.cancelled]],
  cancelled_order_value: [[1, P.cancelledValue]],
  gross_merchandise_sales: [[1, P.gross]],
  discounts: [[1, P.discountLines]],
  bundle_discount: [[1, P.bundle]],
  coupon_discount: [[1, P.coupon]],
  flash_discount: [[1, P.flash]],
  shipping_charged: [[1, P.shipping]],
  price_adjustments: [[1, P.adjustments]],
  tax_collected: [[1, P.tax]],
  returns: [[1, P.returnsValue]],
  net_merchandise_sales: [[1, P.gross], [-1, P.discountLines], [-1, P.returnsValue]],
  net_sales: [[1, P.gross], [-1, P.discountLines], [1, P.shipping], [1, P.adjustments], [-1, P.returnsValue]],
  merchandise_vat: [[1, P.merchVat]],
  merchandise_refunds: [[1, P.merchRefunds]],
  overpayment_refunds: [[1, P.overpaymentRefunds]],
  realised_net_sales: [[1, P.realisedMerch], [-1, P.merchRefunds]],
  refunds: [[1, P.refunds]],
  refund_count: [[1, P.refundCount]],
  payments_received: [[1, P.payments]],
  payment_count: [[1, P.paymentCount]],
  collected_cash: [[1, P.payments], [-1, P.refunds]],
  exchange_difference_collected: [[1, P.exchangeDiff]],
  cod_orders_placed: [[1, P.codPlaced]],
  units_ordered: [[1, P.unitsOrdered]],
  units_sold: [[1, P.unitsSold]],
  units_returned: [[1, P.unitsReturned]],
  net_units_sold: [[1, P.unitsSold], [-1, P.unitsReturned]],
  cogs: [[1, P.cogsSold], [-1, P.cogsReturned]],
  gross_margin: [[1, P.marginSold], [-1, P.marginReturned]],
};

export const ADDITIVE_METRICS = new Set(Object.keys(ADDITIVE));

/** Signed contributions of one additive metric over the orders, restricted to the range. */
export function contributions(key: string, orders: OrderFact[], range: Pick<BusinessRange, "startUtc" | "endUtc">): Contribution[] {
  const terms = ADDITIVE[key];
  if (!terms) throw new Error(`Not an additive metric: ${key}`);
  const out: Contribution[] = [];
  for (const o of orders) {
    for (const [sign, producer] of terms) {
      for (const c of producer(o)) if (inRange(c.at, range)) out.push(sign === 1 ? c : { ...c, amount: -c.amount });
    }
  }
  return out;
}

export function sumOf(cs: Contribution[]): number {
  return cs.reduce((s, c) => s + c.amount, 0);
}

// ─── Grouping ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GroupKey {
  key: string;
  label: string;
}

/** Lines written before Phase 6 have no category/brand snapshot: shown as such, never re-attributed from today's catalog. */
const NOT_RECORDED: GroupKey = { key: "not_recorded", label: "Not recorded (before Phase 6)" };

export function groupKeyOf(c: Contribution, grouping: MetricGrouping, tz: string): GroupKey {
  switch (grouping) {
    case "day":
    case "month":
    case "year": {
      const k = bucketKey(c.at!, tz, grouping);
      return { key: k, label: k };
    }
    case "payment_method":
      return { key: c.order.paymentMethod, label: c.order.paymentMethod };
    case "customer":
      return { key: c.order.customerId ?? "guest", label: c.order.customerId ?? "guest" };
    case "product":
      return c.line ? { key: c.line.productId ?? `unattributed:${c.line.productName}`, label: c.line.productName } : { key: "unattributed", label: "Unattributed" };
    case "category":
      if (c.line && !c.line.attributionRecorded) return NOT_RECORDED;
      return c.line?.categoryId ? { key: c.line.categoryId, label: c.line.categoryName ?? "—" } : { key: "uncategorized", label: "Uncategorized" };
    case "brand":
      if (c.line && !c.line.attributionRecorded) return NOT_RECORDED;
      return c.line?.brand ? { key: c.line.brand, label: c.line.brand } : { key: "unbranded", label: "Unbranded" };
  }
}

// ─── Coverage ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Coverage {
  recorded: number;
  missing: number;
}

/** For snapshot fields that pre-Phase-2 orders never recorded: how many realised orders in range have one. */
export function snapshotCoverage(key: string, orders: OrderFact[], range: Pick<BusinessRange, "startUtc" | "endUtc">): Coverage | undefined {
  const isMissing =
    key === "tax_collected"
      ? (o: OrderFact) => o.taxAmount === null
      : key === "flash_discount"
        ? (o: OrderFact) => o.flashDiscount === null
        : key === "realised_net_sales" || key === "merchandise_vat" || key === "aov"
          ? (o: OrderFact) => merchandiseVat(o) === null
          : null;
  if (key === "cogs" || key === "gross_margin") {
    // Line-level: lines of realised orders in range with / without a recorded cost (P6-2).
    const lines = { recorded: 0, missing: 0 };
    for (const o of orders) {
      if (!inRange(realisedAt(o), range)) continue;
      for (const l of o.lines) {
        if (l.unitCostSnapshot === null) lines.missing++;
        else lines.recorded++;
      }
    }
    return lines;
  }
  if (!isMissing) return undefined;
  const cov = { recorded: 0, missing: 0 };
  for (const o of orders) {
    if (!inRange(realisedAt(o), range)) continue;
    if (isMissing(o)) cov.missing++;
    else cov.recorded++;
  }
  return cov;
}

// ─── Derived (non-additive) metrics ──────────────────────────────────────────────────────────────────────────────────

/** AOV = realised net sales ÷ orders realised (P5-5, same realisation population); 0 when nothing was realised. Minor
 * units, rounded half-up. */
export function aovOf(realisedNetSales: number, ordersRealised: number): number {
  return ordersRealised > 0 ? Math.round(realisedNetSales / ordersRealised) : 0;
}

export interface CustomerMetricStats {
  customersWithOrders: number;
  repeatCustomers: number;
  repeatCustomerRate: number;
  customerLifetimeValue: number;
}

/** Customer metrics as a grouping of the canonical facts (never a separate spend calculation). */
export function customerStats(orders: OrderFact[], range: Pick<BusinessRange, "startUtc" | "endUtc">): CustomerMetricStats {
  const ordersBy = new Map<string, number>();
  for (const c of contributions("orders_placed", orders, range)) if (c.order.customerId) ordersBy.set(c.order.customerId, (ordersBy.get(c.order.customerId) ?? 0) + 1);
  // Net realised orders per customer: a realised order reversed by a later cancellation (P5-2) nets to zero here too, so
  // CLV uses the same realisation population as AOV.
  const realisedBy = new Map<string, number>();
  for (const c of contributions("orders_realised", orders, range)) if (c.order.customerId) realisedBy.set(c.order.customerId, (realisedBy.get(c.order.customerId) ?? 0) + c.amount);
  const spendBy = new Map<string, number>();
  for (const c of contributions("realised_net_sales", orders, range)) if (c.order.customerId) spendBy.set(c.order.customerId, (spendBy.get(c.order.customerId) ?? 0) + c.amount);
  const customersWithOrders = ordersBy.size;
  const repeatCustomers = [...ordersBy.values()].filter((n) => n >= 2).length;
  const spenders = [...realisedBy].filter(([, n]) => n > 0).map(([id]) => id);
  const totalSpend = spenders.reduce((s, id) => s + (spendBy.get(id) ?? 0), 0);
  return {
    customersWithOrders,
    repeatCustomers,
    repeatCustomerRate: customersWithOrders > 0 ? repeatCustomers / customersWithOrders : 0,
    customerLifetimeValue: spenders.length > 0 ? Math.round(totalSpend / spenders.length) : 0,
  };
}

export interface PositionTotals {
  outstandingCod: number;
  amountDue: number;
  /** Orders contributing to amountDue (a balance still owed). */
  amountDueOrders: number;
  refundDue: number;
}

/** Point-in-time ledger totals over current orders — the Phase 4 engine per order, summed. */
export function positionTotals(orders: OrderFact[], currency: string): PositionTotals {
  const totals = { outstandingCod: 0, amountDue: 0, amountDueOrders: 0, refundDue: 0 };
  for (const o of orders) {
    if (o.deleted) continue;
    const pos = derivePaymentPosition({
      currency,
      total: money(o.total, currency),
      paymentMethod: o.paymentMethod,
      orderStatus: o.status,
      settlements: o.payments.filter((p) => p.status === "SUCCEEDED").map((p) => money(p.amount, currency)),
      failedAttempts: o.payments.filter((p) => p.status === "FAILED").length,
      refundsCompleted: o.refunds.filter((r) => r.status === "COMPLETED").map((r) => money(r.amount, currency)),
      refundsRequested: o.refunds.filter((r) => r.status === "REQUESTED").map((r) => money(r.amount, currency)),
      credits: o.credited ? [money(o.credited, currency)] : [],
    });
    totals.outstandingCod += pos.codToCollect.amount;
    if (o.status !== "CANCELLED" && !["RETURNED", "REFUNDED"].includes(o.status) && pos.amountDue.amount > 0) {
      totals.amountDue += pos.amountDue.amount;
      totals.amountDueOrders++;
    }
    totals.refundDue += pos.refundDue.amount;
  }
  return totals;
}

export interface InventoryTotals {
  stockOnHand: number;
  lowStockVariants: number;
  outOfStockVariants: number;
  inventoryValue: number;
}

/** Inventory metrics from InventoryService truth (read-only) and the shared per-variant stock rule (D5). */
export function inventoryTotals(variants: InventoryVariantFact[]): InventoryTotals {
  const t = { stockOnHand: 0, lowStockVariants: 0, outOfStockVariants: 0, inventoryValue: 0 };
  for (const v of variants) {
    if (v.held && v.trackInventory) {
      t.stockOnHand += v.stock;
      t.inventoryValue += Math.max(0, v.stock) * v.currentUnitCost;
    }
    if (v.purchasable) {
      const state = variantStockState(v.trackInventory, v.stock, v.lowStockThreshold);
      if (state === "LOW_STOCK") t.lowStockVariants++;
      if (state === "OUT_OF_STOCK") t.outOfStockVariants++;
    }
  }
  return t;
}

export function isKnownMetric(key: string): boolean {
  return metricDefinition(key) !== undefined;
}

/** Sums one additive metric's contributions by a caller-chosen key (e.g. coupon, shipping district, SKU snapshot). The
 * numbers are the engine's; only the cut differs. A null key drops the contribution. */
export function groupContributions<K>(key: string, orders: OrderFact[], range: Pick<BusinessRange, "startUtc" | "endUtc">, keyOf: (c: Contribution) => K | null): Map<K, number> {
  const out = new Map<K, number>();
  for (const c of contributions(key, orders, range)) {
    const k = keyOf(c);
    if (k === null) continue;
    out.set(k, (out.get(k) ?? 0) + c.amount);
  }
  return out;
}

/** Distinct orders contributing to a metric, by a caller-chosen key (e.g. orders per product). */
export function distinctOrdersBy<K>(key: string, orders: OrderFact[], range: Pick<BusinessRange, "startUtc" | "endUtc">, keyOf: (c: Contribution) => K | null): Map<K, Set<string>> {
  const out = new Map<K, Set<string>>();
  for (const c of contributions(key, orders, range)) {
    const k = keyOf(c);
    if (k === null) continue;
    const set = out.get(k) ?? new Set<string>();
    set.add(c.order.id);
    out.set(k, set);
  }
  return out;
}
