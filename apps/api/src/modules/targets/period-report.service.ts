import { addDays, businessDate, businessDayStartUtc, permissionsForRole } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import type { AdminIdentity } from "../../domain/auth/authorization";
import { storeContext } from "../../domain/metrics/store-time";
import { captureError } from "../../lib/observability/error-capture";
import { getProviders } from "../../providers/registry";
import { getSettings } from "../settings/settings.service";
import { getSmsSettings } from "../sms-settings/sms-settings.service";
import { composePeriodReport } from "./period-report";
import { getScorecard } from "./scorecard.service";

/**
 * Weekly and monthly reports (docs/superpowers/plans/2026-11-18-business-reports.md, Part 4), sent the way the morning
 * brief is: opt-in per report (SMS notifications › Admin alerts), to the admin alert phones, once per store day — the
 * bell row is the marker, so a retried job sends nothing twice. The text is the scorecard's own figures.
 */
const TYPE = { week: "analytics.weekly_report", month: "analytics.monthly_report" } as const;

/** The scorecard read as the store itself: every figure, including profit and money. */
const STORE_VIEWER: AdminIdentity = { adminId: "system", role: "OWNER", permissions: permissionsForRole("OWNER") };

function monthLong(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
function monthShort(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
}

export async function sendPeriodReport(kind: "week" | "month", now: Date = new Date()): Promise<string | null> {
  const sms = await getSmsSettings();
  const phones = sms.adminAlertPhones.split(",").map((p) => p.trim()).filter(Boolean);
  const enabled = kind === "week" ? sms.adminWeeklyReportEnabled : sms.adminMonthlyReportEnabled;
  if (!enabled || !phones.length) return null;

  const { timezone, currency } = await storeContext();
  const today = businessDate(now, timezone);
  const sentToday = { gte: businessDayStartUtc(today, timezone), lt: businessDayStartUtc(addDays(today, 1), timezone) };
  if (await prisma.notification.findFirst({ where: { type: TYPE[kind], createdAt: sentToday }, select: { id: true } })) return null;

  // weekly: the month so far; monthly (run on the 1st): the month that just ended
  const month = kind === "week" ? today.slice(0, 7) : addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const card = await getScorecard(month, STORE_VIEWER, now);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const periodLabel = kind === "week" ? `${monthShort(month)} so far (day ${Number(card.range.to.slice(8, 10))}/${daysInMonth})` : monthLong(month);
  const { storeName } = await getSettings();
  const text = composePeriodReport({ storeName, currency, kind, periodLabel, figures: card.figures });

  // Awaited: the bell row is the once-a-day marker, so it must exist before any text goes out.
  await prisma.notification.create({
    // createdAt is the run's own instant: it is the marker for that store day, whichever clock the job ran on.
    data: { createdAt: now, type: TYPE[kind], title: `${kind === "week" ? "Weekly" : "Monthly"} report — ${kind === "week" ? `${monthLong(month)} so far` : monthLong(month)}`, body: text, link: "/admin/analytics/overview" },
  });
  const results = await Promise.allSettled(phones.map((to) => getProviders().sms.send({ to, body: text })));
  results.forEach((r, i) => {
    if (r.status === "rejected") captureError(r.reason, { msg: `[${TYPE[kind]}] SMS to ${phones[i]} failed:` });
  });
  return text;
}
