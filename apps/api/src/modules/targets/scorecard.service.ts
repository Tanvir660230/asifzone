import { addDays, businessDate } from "@clothing-brand/shared";
import { can, type AdminIdentity } from "../../domain/auth/authorization";
import { computeMetrics } from "../../domain/metrics/metrics.service";
import { resolveStoreRange, storeContext } from "../../domain/metrics/store-time";
import { profitByDay } from "../../domain/finance/profit.service";
import { moneyMap } from "../../domain/finance/custody.service";
import { getDeliveryOutcomes } from "../analytics/delivery-outcomes.service";
import { scorecardStatus, type ScorecardStatus } from "./scorecard-status";
import { getMonthTargets, MONTH_RE } from "./targets.service";
import { AppError } from "../../lib/app-error";

/**
 * The one-page business scorecard (docs/superpowers/plans/2026-11-18-business-reports.md, Part 2): the month so far
 * against the same number of days just before, each figure from the source that already owns it — the metrics registry
 * (sales, orders, average order, returns, cancellations), delivery outcomes (delivered ÷ booked), the books (profit,
 * ad spend, sales per ad taka) and the money map (cash, owed to you, you owe, stock). Nothing is summed here.
 */
export interface ScorecardFigure {
  key: string;
  label: string;
  unit: "money" | "count" | "ratio" | "times";
  value: number | null;
  previous: number | null;
  target: number | null;
  status: ScorecardStatus;
  /** One line saying how the colour was decided. */
  rule: string;
}

export interface Scorecard {
  month: string;
  currency: string;
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  figures: ScorecardFigure[];
  money: { cash: number; owedToYou: number; youOwe: number; stock: number } | null;
}

const COMPARE_RULE = "Green within 5 % of the same days before, amber 5–15 % worse, red more than 15 % worse.";
const TARGET_RULE = "Follows the month's target: red when behind the steady pace.";

export async function getScorecard(month: string, viewer: AdminIdentity, now: Date = new Date()): Promise<Scorecard> {
  if (!MONTH_RE.test(month)) throw AppError.badRequest("A month looks like 2026-11", { code: "BAD_MONTH" });
  const { timezone, currency } = await storeContext();
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const today = businessDate(now, timezone);
  const to = today < first ? first : today > last ? last : today;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1;
  const previousRange = { from: addDays(first, -days), to: addDays(first, -1) };
  const books = can(viewer, "finance.read");

  const range = await resolveStoreRange({ from: first, to }, now);
  const [targets, metrics, delivery, profit, map] = await Promise.all([
    getMonthTargets(month, viewer, now),
    computeMetrics({ metrics: ["realised_net_sales", "orders_placed", "aov", "return_rate", "orders_cancelled"], range: { from: first, to }, compare: "previous" }, now),
    getDeliveryOutcomes(undefined, range.startUtc, new Date(range.endUtc.getTime() - 1)),
    books ? profitByDay({ from: first, to }) : null,
    books ? moneyMap({}, { sensitive: can(viewer, "finance.sensitive") }) : null,
  ]);

  const now$ = (k: string) => metrics.metrics[k]?.value ?? 0;
  const before$ = (k: string) => metrics.previous?.metrics[k] ?? null;
  const fig = (f: Omit<ScorecardFigure, "status" | "rule" | "target"> & { better: "higher" | "lower" | null; target?: { target: number | null; status: Parameters<typeof scorecardStatus>[0]["targetStatus"] }; mustBePositive?: boolean }): ScorecardFigure => {
    const hasTarget = f.target?.target != null;
    const status = f.value === null ? "neutral" : scorecardStatus({ value: f.value, previous: f.previous, better: f.better, targetStatus: hasTarget ? f.target!.status : undefined, mustBePositive: f.mustBePositive });
    return { key: f.key, label: f.label, unit: f.unit, value: f.value, previous: f.previous, target: f.target?.target ?? null, status, rule: f.better === null ? "For reading, not judged." : hasTarget ? TARGET_RULE : COMPARE_RULE };
  };

  const figures: ScorecardFigure[] = [
    fig({ key: "netSales", label: "Net sales", unit: "money", value: now$("realised_net_sales"), previous: before$("realised_net_sales"), better: "higher", target: targets.netSales }),
    fig({ key: "orders", label: "Orders", unit: "count", value: now$("orders_placed"), previous: before$("orders_placed"), better: "higher", target: targets.orders }),
    fig({ key: "aov", label: "Average order", unit: "money", value: now$("aov"), previous: before$("aov"), better: "higher" }),
    fig({ key: "deliverySuccess", label: "Delivered", unit: "ratio", value: delivery.totals.parcels > 0 ? delivery.totals.successRate : null, previous: delivery.previous && delivery.previous.parcels > 0 ? delivery.previous.successRate : null, better: "higher" }),
    fig({ key: "returnRate", label: "Returns", unit: "ratio", value: now$("return_rate"), previous: before$("return_rate"), better: "lower" }),
    fig({ key: "cancelledOrders", label: "Cancelled orders", unit: "count", value: now$("orders_cancelled"), previous: before$("orders_cancelled"), better: "lower" }),
  ];
  if (profit) {
    figures.push(
      fig({ key: "profit", label: "Profit", unit: "money", value: profit.totals.profit, previous: profit.priorTotals.profit, better: "higher", target: targets.profit ?? undefined, mustBePositive: true }),
      fig({ key: "adSpend", label: "Ad spend", unit: "money", value: profit.totals.ads, previous: profit.priorTotals.ads, better: null }),
      fig({ key: "salesPerAdTaka", label: "Sales per ad taka", unit: "times", value: profit.totals.salesPerAdTaka, previous: profit.priorTotals.salesPerAdTaka, better: "higher" }),
    );
  }

  const t = map?.totals;
  return {
    month,
    currency,
    range: { from: first, to },
    previousRange,
    figures,
    money: t
      ? {
          cash: t.cash + t.bank + t.wallets,
          owedToYou: t.courierReceivable + t.gatewayReceivable + t.customerReceivables + t.otherReceivable,
          youOwe: t.suppliersOwed + t.goodsNotInvoiced + t.loans,
          stock: t.inventory + t.workInProgress,
        }
      : null,
  };
}
