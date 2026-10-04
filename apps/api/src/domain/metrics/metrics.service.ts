/**
 * The metrics service (docs/METRICS_REGISTRY.md) — the one entry point for business numbers. It validates a request
 * against the registry, resolves the range in the store timezone, loads canonical facts and runs the pure engine
 * (packages/shared/src/metrics). Every dashboard, BI page, report, CRM figure and storefront signal that states a
 * business number reads it from here.
 */
import {
  ADDITIVE_METRICS,
  aovOf,
  bucketKey,
  businessDate,
  contributions,
  customerStats,
  enumerateBuckets,
  groupKeyOf,
  InvalidRangeError,
  inventoryTotals,
  metricDefinition,
  positionTotals,
  previousRange,
  resolveBusinessRange,
  snapshotCoverage,
  sumOf,
  toMajor,
  money,
  type BusinessRange,
  type Coverage,
  type MetricGrouping,
  type OrderFact,
  type RangeInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { candidateOrderIds, loadCourierLoss, loadInventoryFacts, loadOrderFacts, loadPositionFacts } from "./facts.repository";
import { storeContext } from "./store-time";

const CACHE_TTL_SECONDS = 60;
const TIME_GROUPINGS = new Set<MetricGrouping>(["day", "month", "year"]);
const POSITION_KEYS = new Set(["outstanding_cod", "amount_due", "refund_due"]);
const INVENTORY_KEYS = new Set(["stock_on_hand", "low_stock_variants", "out_of_stock_variants", "inventory_value"]);
const CUSTOMER_KEYS = new Set(["customers_with_orders", "repeat_customer_rate", "customer_lifetime_value"]);

export interface MetricsRequest {
  metrics: string[];
  range: RangeInput | BusinessRange;
  groupBy?: MetricGrouping;
  limit?: number;
  /** Skip the 60 s cache (reconciliation and tests must see the database as it is now). */
  fresh?: boolean;
  /** Also compute the totals of the immediately preceding range of equal length, and the change (period-over-period). */
  compare?: "previous";
}

export interface MetricValue {
  value: number;
  unit: "money" | "count" | "ratio";
  estimated?: boolean;
  coverage?: Coverage;
}

export interface MetricsResult {
  range: { from: string; to: string; startUtc: string; endUtc: string; timezone: string; preset: string | null };
  currency: string;
  metrics: Record<string, MetricValue>;
  groups?: Array<{ key: string; label: string; metrics: Record<string, number> }>;
  /** compare=previous: the preceding range's totals and the % change per metric (null when the previous value is 0). */
  previous?: { range: { from: string; to: string }; metrics: Record<string, number>; changePct: Record<string, number | null> };
}

function isResolved(r: RangeInput | BusinessRange): r is BusinessRange {
  return (r as BusinessRange).startUtc instanceof Date;
}

export function validateMetricsRequest(req: MetricsRequest) {
  if (!req.metrics.length) throw AppError.badRequest("At least one metric is required", { code: "UNKNOWN_METRIC" });
  for (const key of req.metrics) {
    const def = metricDefinition(key);
    if (!def) throw AppError.badRequest(`Unknown metric: ${key}`, { code: "UNKNOWN_METRIC", metric: key });
    if (def.status === "pending") throw AppError.badRequest(`${def.label} is pending a business decision (PD-5.1)`, { code: "METRIC_PENDING", metric: key });
    if (req.groupBy && !def.groupings.includes(req.groupBy)) {
      throw AppError.badRequest(`${def.label} can't be grouped by ${req.groupBy}`, { code: "UNSUPPORTED_GROUPING", metric: key, groupBy: req.groupBy });
    }
  }
}

/** Computes the requested metrics (major units for money). Throws 400 for unknown/pending keys, bad groupings, bad ranges. */
export async function computeMetrics(req: MetricsRequest, now: Date = new Date()): Promise<MetricsResult> {
  validateMetricsRequest(req);
  const ctx = await storeContext();
  let range: BusinessRange;
  try {
    range = isResolved(req.range) ? req.range : resolveBusinessRange(req.range, ctx.timezone, now);
  } catch (err) {
    if (err instanceof InvalidRangeError || err instanceof RangeError) throw AppError.badRequest(err.message, { code: "INVALID_RANGE" });
    throw err;
  }

  const cacheKey = `metrics:v1:${ctx.timezone}:${range.startUtc.toISOString()}:${range.endUtc.toISOString()}:${[...req.metrics].sort().join(",")}:${req.groupBy ?? ""}:${req.limit ?? ""}:${req.compare ?? ""}`;
  if (!req.fresh) {
    const cached = await cacheGet<MetricsResult>(cacheKey);
    if (cached) return cached;
  }

  const result = await computeUncached(req, range, ctx.currency);
  if (req.compare === "previous" && range.preset !== "lifetime") {
    const prev = previousRange(range);
    const before = await computeUncached({ ...req, groupBy: undefined, compare: undefined }, prev, ctx.currency);
    const metrics = Object.fromEntries(Object.entries(before.metrics).map(([k, v]) => [k, v.value]));
    const changePct = Object.fromEntries(
      Object.entries(result.metrics).map(([k, v]) => {
        const p = metrics[k] ?? 0;
        return [k, p === 0 ? null : ((v.value - p) / Math.abs(p)) * 100];
      }),
    );
    result.previous = { range: { from: prev.from, to: prev.to }, metrics, changePct };
  }
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

async function computeUncached(req: MetricsRequest, range: BusinessRange, currency: string): Promise<MetricsResult> {
  const keys = req.metrics;
  const needsOrders = keys.some((k) => ADDITIVE_METRICS.has(k) || CUSTOMER_KEYS.has(k) || k === "aov");
  const orders: OrderFact[] = needsOrders ? await loadOrderFacts(await candidateOrderIds(range), currency) : [];
  const courierLoss = keys.includes("courier_loss") ? await loadCourierLoss(range, currency) : [];

  // A lifetime series starts at the first business date that has data, not at the epoch.
  let effective = range;
  if (range.preset === "lifetime" && req.groupBy && TIME_GROUPINGS.has(req.groupBy)) {
    const first = orders.reduce<Date | null>((min, o) => (!min || o.placedAt < min ? o.placedAt : min), null);
    effective = { ...range, from: first ? businessDate(first, range.timezone) : range.to };
  }

  const out: Record<string, MetricValue> = {};
  const toOut = (key: string, minorValue: number): number => (metricDefinition(key)!.unit === "money" ? toMajor(money(minorValue, currency)) : minorValue);

  for (const key of keys) {
    const def = metricDefinition(key)!;
    let value = 0;
    let coverage: Coverage | undefined;
    if (ADDITIVE_METRICS.has(key)) {
      value = sumOf(contributions(key, orders, range));
      coverage = snapshotCoverage(key, orders, range);
    } else if (key === "aov") {
      value = aovOf(sumOf(contributions("realised_net_sales", orders, range)), sumOf(contributions("orders_realised", orders, range)));
      coverage = snapshotCoverage(key, orders, range);
    } else if (key === "courier_loss") {
      value = courierLoss.reduce((s, e) => s + e.amount, 0);
    } else if (CUSTOMER_KEYS.has(key)) {
      const stats = customerStats(orders, range);
      value = key === "customers_with_orders" ? stats.customersWithOrders : key === "repeat_customer_rate" ? stats.repeatCustomerRate : stats.customerLifetimeValue;
    } else if (POSITION_KEYS.has(key)) {
      const totals = positionTotals(await loadPositionFacts(currency), currency);
      value = key === "outstanding_cod" ? totals.outstandingCod : key === "amount_due" ? totals.amountDue : totals.refundDue;
    } else if (INVENTORY_KEYS.has(key)) {
      const totals = inventoryTotals(await loadInventoryFacts(currency));
      value =
        key === "stock_on_hand" ? totals.stockOnHand : key === "low_stock_variants" ? totals.lowStockVariants : key === "out_of_stock_variants" ? totals.outOfStockVariants : totals.inventoryValue;
    }
    out[key] = { value: def.unit === "ratio" ? value : toOut(key, value), unit: def.unit, ...(def.estimated ? { estimated: true } : {}), ...(coverage ? { coverage } : {}) };
  }

  const result: MetricsResult = {
    range: { from: effective.from, to: effective.to, startUtc: range.startUtc.toISOString(), endUtc: range.endUtc.toISOString(), timezone: range.timezone, preset: range.preset },
    currency,
    metrics: out,
  };
  if (req.groupBy) result.groups = await buildGroups(req, effective, orders, courierLoss, toOut);
  return result;
}

async function buildGroups(
  req: MetricsRequest,
  range: BusinessRange,
  orders: OrderFact[],
  courierLoss: Array<{ amount: number; at: Date }>,
  toOut: (key: string, v: number) => number,
): Promise<NonNullable<MetricsResult["groups"]>> {
  const grouping = req.groupBy!;
  const tz = range.timezone;
  const groups = new Map<string, { key: string; label: string; minor: Record<string, number> }>();
  const touch = (key: string, label: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, label, minor: Object.fromEntries(req.metrics.map((m) => [m, 0])) };
      groups.set(key, g);
    }
    return g;
  };
  const isTime = TIME_GROUPINGS.has(grouping);
  if (isTime) for (const k of enumerateBuckets(range, grouping as "day" | "month" | "year")) touch(k, k);

  const additive = (key: string) => {
    for (const c of contributions(key, orders, range)) {
      const gk = groupKeyOf(c, grouping, tz);
      touch(gk.key, gk.label).minor[key]! += c.amount;
    }
  };

  for (const key of req.metrics) {
    if (ADDITIVE_METRICS.has(key)) additive(key);
    else if (key === "courier_loss" && isTime) {
      for (const e of courierLoss) touch(bucketKey(e.at, tz, grouping as "day"), bucketKey(e.at, tz, grouping as "day")).minor[key]! += e.amount;
    } else if (key === "aov" && isTime) {
      const net = new Map<string, number>();
      const cnt = new Map<string, number>();
      for (const c of contributions("realised_net_sales", orders, range)) net.set(bucketKey(c.at!, tz, grouping as "day"), (net.get(bucketKey(c.at!, tz, grouping as "day")) ?? 0) + c.amount);
      for (const c of contributions("orders_realised", orders, range)) cnt.set(bucketKey(c.at!, tz, grouping as "day"), (cnt.get(bucketKey(c.at!, tz, grouping as "day")) ?? 0) + c.amount);
      for (const g of groups.values()) g.minor[key] = aovOf(net.get(g.key) ?? 0, cnt.get(g.key) ?? 0);
    } else if (key === "customers_with_orders" && isTime) {
      const seen = new Map<string, Set<string>>();
      for (const c of contributions("orders_placed", orders, range)) {
        if (!c.order.customerId) continue;
        const k = bucketKey(c.at!, tz, grouping as "day");
        const set = seen.get(k) ?? new Set<string>();
        set.add(c.order.customerId);
        seen.set(k, set);
      }
      for (const [k, set] of seen) touch(k, k).minor[key] = set.size;
    }
  }

  let list = [...groups.values()];
  if (grouping === "customer") {
    const ids = list.map((g) => g.key).filter((k) => k !== "guest");
    const names = new Map((await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    list = list.map((g) => ({ ...g, label: g.key === "guest" ? "Guest" : (names.get(g.key) ?? g.key) }));
  }
  if (isTime) list.sort((a, b) => a.key.localeCompare(b.key));
  else {
    const first = req.metrics[0]!;
    list.sort((a, b) => (b.minor[first] ?? 0) - (a.minor[first] ?? 0));
    if (req.limit) list = list.slice(0, req.limit);
  }
  return list.map((g) => ({ key: g.key, label: g.label, metrics: Object.fromEntries(Object.entries(g.minor).map(([k, v]) => [k, toOut(k, v)])) }));
}

/** Engine access for reports that need facts beyond totals/groupings (e.g. heatmaps, RFM): the same facts, same range. */
export async function loadFactsForRange(range: BusinessRange): Promise<{ orders: OrderFact[]; currency: string }> {
  const { currency } = await storeContext();
  return { orders: await loadOrderFacts(await candidateOrderIds(range), currency), currency };
}

export interface CustomerMetricEntry {
  /** `customer_net_spend` — lifetime realised net sales of the customer's orders (P5-4, PD-5.1). */
  netSpend: number;
  /** `customer_orders` — sale orders placed (lifetime). */
  orders: number;
  realisedOrders: number;
}

/** Lifetime customer metrics for every customer, as a grouping of the canonical facts (never a separate spend
 * calculation). Cached by computeMetrics. */
export async function customerMetricsIndex(): Promise<Map<string, CustomerMetricEntry>> {
  const m = await computeMetrics({ metrics: ["realised_net_sales", "orders_placed", "orders_realised"], range: { preset: "lifetime" }, groupBy: "customer" });
  const out = new Map<string, CustomerMetricEntry>();
  for (const g of m.groups ?? []) {
    if (g.key === "guest") continue;
    out.set(g.key, { netSpend: g.metrics.realised_net_sales!, orders: g.metrics.orders_placed!, realisedOrders: g.metrics.orders_realised! });
  }
  return out;
}

export function minorToMajor(v: number, currency: string): number {
  return toMajor(money(v, currency));
}
