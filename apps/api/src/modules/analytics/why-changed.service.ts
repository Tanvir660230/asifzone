/**
 * "Why did it change" loader (docs/METRICS_REGISTRY.md §4.11): the report period against the one before it (same length).
 * Every number comes from the metrics engine — sessions, conversion (D25), orders, realised net sales — and the movers
 * are the engine's own contributions grouped by product (`net_merchandise_sales`), district and credited channel
 * (`realised_net_sales`). Nothing here is a second definition of a sale.
 */
import { groupContributions, money, previousRange, toMajor, type BusinessRange, type OrderFact } from "@clothing-brand/shared";
import { cacheGet, cacheSet } from "../../config/redis";
import { computeMetrics, loadFactsForRange } from "../../domain/metrics/metrics.service";
import { resolveLegacyWindow } from "../../domain/metrics/store-time";
import { channelLabel, creditedChannels } from "./traffic.service";
import { decompose, movers, type Decomposition, type Mover } from "./why-changed";

const CACHE_TTL_SECONDS = 300;

interface PeriodNumbers {
  sessions: number;
  webOrders: number;
  orders: number;
  realisedOrders: number;
  netSales: number;
}

async function periodNumbers(range: BusinessRange): Promise<PeriodNumbers> {
  const m = await computeMetrics({ metrics: ["sessions", "conversion_rate", "orders_placed", "orders_realised", "realised_net_sales"], range });
  const sessions = m.metrics.sessions!.value;
  return {
    sessions,
    webOrders: Math.round(m.metrics.conversion_rate!.value * sessions),
    orders: m.metrics.orders_placed!.value,
    realisedOrders: m.metrics.orders_realised!.value,
    netSales: m.metrics.realised_net_sales!.value,
  };
}

async function salesBy(range: BusinessRange, key: (o: OrderFact) => string | null): Promise<Map<string, number>> {
  const { orders, currency } = await loadFactsForRange(range);
  const g = groupContributions("realised_net_sales", orders, range, (c) => key(c.order));
  return new Map([...g.entries()].map(([k, v]) => [k, toMajor(money(v, currency))]));
}

export interface WhyChangedReport {
  range: { from: string; to: string };
  previous: { from: string; to: string };
  /** Website orders = visits × conversion. */
  webOrders: Decomposition<"visits" | "conversion">;
  /** Orders without a website visit (phone, admin) — not part of the split. */
  otherOrders: { before: number; after: number };
  /** Realised net sales = realised orders × average order value. */
  netSales: Decomposition<"orders" | "orderValue">;
  numbers: { before: PeriodNumbers; after: PeriodNumbers };
  movers: { products: { up: Mover[]; down: Mover[] }; districts: { up: Mover[]; down: Mover[] }; channels: { up: Mover[]; down: Mover[] } };
}

export async function getWhyChanged(days?: number, dateFrom?: Date, dateTo?: Date): Promise<WhyChangedReport> {
  const range = await resolveLegacyWindow(days, dateFrom, dateTo);
  const prev = previousRange(range);
  const key = `analytics:v1:why-changed:${range.timezone}:${range.startUtc.toISOString()}:${range.endUtc.toISOString()}`;
  const hit = await cacheGet<WhyChangedReport>(key);
  if (hit) return hit;

  const [after, before] = await Promise.all([periodNumbers(range), periodNumbers(prev)]);
  const conv = (p: PeriodNumbers) => (p.sessions > 0 ? p.webOrders / p.sessions : 0);
  const aov = (p: PeriodNumbers) => (p.realisedOrders > 0 ? p.netSales / p.realisedOrders : 0);

  const productSales = async (r: BusinessRange) => {
    const m = await computeMetrics({ metrics: ["net_merchandise_sales"], range: r, groupBy: "product", limit: 100 });
    return new Map((m.groups ?? []).map((g) => [g.label, g.metrics.net_merchandise_sales!]));
  };
  const channelSales = async (r: BusinessRange) => {
    const { orders } = await loadFactsForRange(r);
    const credit = await creditedChannels([...new Set(orders.map((o) => o.sessionId).filter((s): s is string => Boolean(s)))]);
    return salesBy(r, (o) => {
      const c = o.sessionId ? credit.get(o.sessionId) : undefined;
      return c ? channelLabel(c.cls) : "No website visit";
    });
  };
  const district = (o: OrderFact) => o.shippingDistrict || null;
  const [pA, pB, dA, dB, cA, cB] = await Promise.all([productSales(range), productSales(prev), salesBy(range, district), salesBy(prev, district), channelSales(range), channelSales(prev)]);

  const report: WhyChangedReport = {
    range: { from: range.from, to: range.to },
    previous: { from: prev.from, to: prev.to },
    webOrders: decompose({ visits: [before.sessions, after.sessions], conversion: [conv(before), conv(after)] }),
    otherOrders: { before: before.orders - before.webOrders, after: after.orders - after.webOrders },
    netSales: decompose({ orders: [before.realisedOrders, after.realisedOrders], orderValue: [aov(before), aov(after)] }),
    numbers: { before, after },
    movers: { products: movers(pB, pA), districts: movers(dB, dA), channels: movers(cB, cA) },
  };
  await cacheSet(key, report, CACHE_TTL_SECONDS);
  return report;
}
