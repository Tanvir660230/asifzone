/**
 * Metrics reconciliation (docs/METRICS_REGISTRY.md §7, invariant M-3). There are no metric projections to rebuild; the
 * risk is two surfaces disagreeing. These checks recompute each number two independent ways and report any mismatch.
 */
import { fromMajor, money, toMajor, type BusinessRange, type RangeInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { computeMetrics } from "./metrics.service";
import { storeContext } from "./store-time";

export interface ConsistencyCheck {
  check: string;
  expected: number;
  actual: number;
  ok: boolean;
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.005;
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

export async function metricsConsistency(range: RangeInput | BusinessRange): Promise<{ range: unknown; checks: ConsistencyCheck[]; ok: boolean }> {
  const { currency } = await storeContext();
  const totals = await computeMetrics({
    metrics: [
      "realised_net_sales",
      "gross_merchandise_sales",
      "discounts",
      "merchandise_vat",
      "merchandise_refunds",
      "net_sales",
      "net_merchandise_sales",
      "collected_cash",
      "orders_placed",
      "cogs",
      "gross_margin",
      // Admin V2 behaviour / rate family (METRICS_REGISTRY §4.3a)
      "sessions",
      "return_rate",
      "units_sold",
      "units_returned",
    ],
    range,
    fresh: true,
  });
  const [byDay, byCustomer, byProduct, byCategory] = await Promise.all([
    // Day buckets are capped (400); a longer range reconciles by month — the same contributions either way.
    computeMetrics({ metrics: ["realised_net_sales", "net_sales", "orders_placed"], range, fresh: true, groupBy: Date.parse(totals.range.to) - Date.parse(totals.range.from) > 365 * 86_400_000 ? "month" : "day" }),
    computeMetrics({ metrics: ["realised_net_sales"], range, groupBy: "customer", fresh: true }),
    computeMetrics({ metrics: ["net_merchandise_sales", "gross_margin"], range, groupBy: "product", fresh: true }),
    // Phase 6: the category cut uses the lines' own snapshots ("Not recorded" included), so it must still add up.
    computeMetrics({ metrics: ["cogs"], range, groupBy: "category", fresh: true }),
  ]);

  const window = { gte: new Date(totals.range.startUtc), lt: new Date(totals.range.endUtc) };
  const [paid, refunded, sessionGroups] = await Promise.all([
    prisma.payment.aggregate({ where: { status: "SUCCEEDED", settledAt: window }, _sum: { amount: true } }),
    prisma.refund.aggregate({ where: { status: "COMPLETED", completedAt: window }, _sum: { amount: true } }),
    // Counted a second way (ORM group-by, not the engine's raw COUNT DISTINCT) — the sessions denominator of D25.
    prisma.pageView.groupBy({ by: ["sessionId"], where: { createdAt: window } }),
  ]);
  const unitsSold = totals.metrics.units_sold!.value;
  const ledgerCash = toMajor(money(fromMajor(String(paid._sum.amount ?? 0), currency).amount - fromMajor(String(refunded._sum.amount ?? 0), currency).amount, currency));

  const checks: ConsistencyCheck[] = [
    { check: "Σ series realised_net_sales = total", expected: totals.metrics.realised_net_sales!.value, actual: sum(byDay.groups!.map((g) => g.metrics.realised_net_sales!)) },
    { check: "Σ series net_sales = total", expected: totals.metrics.net_sales!.value, actual: sum(byDay.groups!.map((g) => g.metrics.net_sales!)) },
    { check: "Σ series orders_placed = total", expected: totals.metrics.orders_placed!.value, actual: sum(byDay.groups!.map((g) => g.metrics.orders_placed!)) },
    { check: "Σ customer net spend = realised_net_sales", expected: totals.metrics.realised_net_sales!.value, actual: sum(byCustomer.groups!.map((g) => g.metrics.realised_net_sales!)) },
    {
      check: "realised_net_sales = gross − discounts − merchandise VAT − merchandise refunds",
      expected: sum([totals.metrics.gross_merchandise_sales!.value, -totals.metrics.discounts!.value, -totals.metrics.merchandise_vat!.value, -totals.metrics.merchandise_refunds!.value]),
      actual: totals.metrics.realised_net_sales!.value,
    },
    { check: "Σ product net merchandise = net_merchandise_sales", expected: totals.metrics.net_merchandise_sales!.value, actual: sum(byProduct.groups!.map((g) => g.metrics.net_merchandise_sales!)) },
    { check: "collected_cash = ledger payments − ledger refunds", expected: ledgerCash, actual: totals.metrics.collected_cash!.value },
    { check: "Σ product gross margin = gross_margin (recorded cost)", expected: totals.metrics.gross_margin!.value, actual: sum(byProduct.groups!.map((g) => g.metrics.gross_margin!)) },
    { check: "Σ category COGS (incl. not recorded) = cogs", expected: totals.metrics.cogs!.value, actual: sum(byCategory.groups!.map((g) => g.metrics.cogs!)) },
    { check: "sessions = distinct storefront sessions with a pageview", expected: sessionGroups.length, actual: totals.metrics.sessions!.value },
    {
      check: "return_rate = units_returned ÷ units_sold",
      expected: unitsSold > 0 ? totals.metrics.units_returned!.value / unitsSold : 0,
      actual: totals.metrics.return_rate!.value,
    },
  ].map((c) => ({ ...c, ok: close(c.expected, c.actual) }));
  return { range: totals.range, checks, ok: checks.every((c) => c.ok) };
}
