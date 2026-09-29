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
  const totals = await computeMetrics({ metrics: ["net_sales", "net_merchandise_sales", "collected_cash", "orders_placed"], range, fresh: true });
  const [byDay, byCustomer, byProduct] = await Promise.all([
    // Day buckets are capped (400); a longer range reconciles by month — the same contributions either way.
    computeMetrics({ metrics: ["net_sales", "orders_placed"], range, fresh: true, groupBy: Date.parse(totals.range.to) - Date.parse(totals.range.from) > 365 * 86_400_000 ? "month" : "day" }),
    computeMetrics({ metrics: ["net_sales"], range, groupBy: "customer", fresh: true }),
    computeMetrics({ metrics: ["net_merchandise_sales"], range, groupBy: "product", fresh: true }),
  ]);

  const window = { gte: new Date(totals.range.startUtc), lt: new Date(totals.range.endUtc) };
  const [paid, refunded] = await Promise.all([
    prisma.payment.aggregate({ where: { status: "SUCCEEDED", settledAt: window }, _sum: { amount: true } }),
    prisma.refund.aggregate({ where: { status: "COMPLETED", completedAt: window }, _sum: { amount: true } }),
  ]);
  const ledgerCash = toMajor(money(fromMajor(String(paid._sum.amount ?? 0), currency).amount - fromMajor(String(refunded._sum.amount ?? 0), currency).amount, currency));

  const checks: ConsistencyCheck[] = [
    { check: "Σ series net_sales = total", expected: totals.metrics.net_sales!.value, actual: sum(byDay.groups!.map((g) => g.metrics.net_sales!)) },
    { check: "Σ series orders_placed = total", expected: totals.metrics.orders_placed!.value, actual: sum(byDay.groups!.map((g) => g.metrics.orders_placed!)) },
    { check: "Σ customer net spend = net_sales", expected: totals.metrics.net_sales!.value, actual: sum(byCustomer.groups!.map((g) => g.metrics.net_sales!)) },
    { check: "Σ product net merchandise = net_merchandise_sales", expected: totals.metrics.net_merchandise_sales!.value, actual: sum(byProduct.groups!.map((g) => g.metrics.net_merchandise_sales!)) },
    { check: "collected_cash = ledger payments − ledger refunds", expected: ledgerCash, actual: totals.metrics.collected_cash!.value },
  ].map((c) => ({ ...c, ok: close(c.expected, c.actual) }));
  return { range: totals.range, checks, ok: checks.every((c) => c.ok) };
}
