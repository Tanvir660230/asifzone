import { Prisma } from "@prisma/client";
import { rateVital, type DeviceKind, type PageKind, type VitalRating, type WebVitalMetric } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

/** Site health › Site speed: real-visitor Core Web Vitals, stored anonymously and summarised at the 75th percentile —
 * the point Google judges a page by. Retention for both Site health tables lives here too. */

const DAY_MS = 24 * 60 * 60 * 1000;
const VITALS_RETENTION_DAYS = 30;
const ERRORS_RETENTION_DAYS = 90;

export interface VitalSampleInput {
  metric: WebVitalMetric;
  value: number;
  pageKind: PageKind;
  device: DeviceKind;
}

export interface VitalSummaryRow {
  metric: WebVitalMetric;
  pageKind: PageKind;
  device: DeviceKind;
  p75: number;
  samples: number;
  rating: VitalRating;
}

export async function recordVitalSamples(samples: VitalSampleInput[]): Promise<void> {
  await prisma.webVitalSample.createMany({ data: samples });
}

export async function summarizeVitals(days: number, now: Date = new Date()): Promise<VitalSummaryRow[]> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const rows = await prisma.$queryRaw<Array<{ metric: WebVitalMetric; pageKind: PageKind; device: DeviceKind; p75: number; samples: bigint }>>(Prisma.sql`
    SELECT "metric", "pageKind", "device",
           percentile_cont(0.75) WITHIN GROUP (ORDER BY "value") AS "p75",
           count(*) AS "samples"
      FROM "WebVitalSample"
     WHERE "createdAt" >= ${since}
     GROUP BY "metric", "pageKind", "device"
     ORDER BY "pageKind", "device", "metric"`);
  return rows.map((r) => {
    const p75 = r.metric === "CLS" ? Math.round(Number(r.p75) * 1000) / 1000 : Math.round(Number(r.p75));
    return { metric: r.metric, pageKind: r.pageKind, device: r.device, p75, samples: Number(r.samples), rating: rateVital(r.metric, p75) };
  });
}

/** Daily (jobs/site-health-retention-cron.ts): speed samples older than 30 days; error groups not seen for 90 days. */
export async function purgeOldSiteHealthData(now: Date = new Date()): Promise<{ samples: number; errors: number }> {
  const [samples, errors] = await Promise.all([
    prisma.webVitalSample.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - VITALS_RETENTION_DAYS * DAY_MS) } } }),
    prisma.errorGroup.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - ERRORS_RETENTION_DAYS * DAY_MS) } } }),
  ]);
  return { samples: samples.count, errors: errors.count };
}
