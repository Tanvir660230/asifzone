import { Prisma } from "@prisma/client";
import { businessDate } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { can, type AdminIdentity } from "../../domain/auth/authorization";
import { computeMetrics } from "../../domain/metrics/metrics.service";
import { storeContext } from "../../domain/metrics/store-time";
import { profitByDay } from "../../domain/finance/profit.service";
import { targetProgress, type TargetProgress } from "./target-progress";

/**
 * Monthly targets (docs/superpowers/plans/2026-11-18-business-reports.md, Part 1). The month is the store-local
 * calendar month; its figures come from the metrics registry (net sales = realised_net_sales, orders = orders_placed)
 * and the books (profit = profitByDay's total), so they match Reports and Profit exactly.
 */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface MonthTargetsView {
  month: string;
  currency: string;
  daysInMonth: number;
  elapsedDays: number;
  finished: boolean;
  netSales: TargetProgress;
  orders: TargetProgress;
  /** Null for an admin who can't read the books. */
  profit: TargetProgress | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

function assertMonth(month: string) {
  if (!MONTH_RE.test(month)) throw AppError.badRequest("A month looks like 2026-11", { code: "BAD_MONTH" });
}

function monthDays(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));

export async function getMonthTargets(month: string, viewer: AdminIdentity, now: Date = new Date()): Promise<MonthTargetsView> {
  assertMonth(month);
  const { timezone, currency } = await storeContext();
  const daysInMonth = monthDays(month);
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const today = businessDate(now, timezone);
  const elapsedDays = today < first ? 0 : today > last ? daysInMonth : Number(today.slice(8, 10));
  const upTo = today > last ? last : today;
  const seesProfit = can(viewer, "finance.read");

  const [row, metrics, profit] = await Promise.all([
    prisma.monthlyTarget.findUnique({ where: { month }, include: { updatedByAdmin: { select: { name: true } } } }),
    elapsedDays > 0 ? computeMetrics({ metrics: ["realised_net_sales", "orders_placed"], range: { from: first, to: upTo } }, now) : null,
    seesProfit && elapsedDays > 0 ? profitByDay({ from: first, to: upTo }).then((p) => p.totals.profit) : null,
  ]);

  const progress = (target: number | null, actual: number) => targetProgress({ target, actual, elapsedDays, daysInMonth });
  return {
    month,
    currency,
    daysInMonth,
    elapsedDays,
    finished: elapsedDays >= daysInMonth,
    netSales: progress(num(row?.netSales), metrics?.metrics.realised_net_sales?.value ?? 0),
    orders: progress(row?.orders ?? null, metrics?.metrics.orders_placed?.value ?? 0),
    profit: seesProfit ? progress(num(row?.profit), profit ?? 0) : null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedByAdmin?.name ?? null,
  };
}

export interface MonthTargetsInput {
  netSales?: number | null;
  orders?: number | null;
  profit?: number | null;
}

/** Sets the month's targets; a field left out keeps its value, null clears it. */
export async function setMonthTargets(month: string, input: MonthTargetsInput, adminId: string) {
  assertMonth(month);
  const data = {
    ...(input.netSales !== undefined ? { netSales: input.netSales } : {}),
    ...(input.orders !== undefined ? { orders: input.orders } : {}),
    ...(input.profit !== undefined ? { profit: input.profit } : {}),
    updatedByAdminId: adminId,
  };
  await prisma.monthlyTarget.upsert({ where: { month }, create: { month, ...data }, update: data });
}
