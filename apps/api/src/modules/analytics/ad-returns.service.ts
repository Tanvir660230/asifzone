/**
 * Ad returns (docs/METRICS_REGISTRY.md §4.12): per ad campaign (the session's `utm_campaign`, the same matching rule as
 * Finance › Ads), what it really brought — sessions, orders, delivered/paid orders, realised net sales and gross margin
 * from the metrics engine — and, when the campaign is recorded in Finance with spend, the real ROAS (realised net sales ÷
 * spend), profit after ads (gross margin − spend) and cost per delivered order. Spend is Finance's own figure (actual,
 * else planned) — never a second calculation. Finance is only read when campaigns exist there (its context bootstraps).
 */
import { contributions, money, toMajor, type OrderFact } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { loadFactsForRange } from "../../domain/metrics/metrics.service";
import { resolveLegacyWindow, utcInstant } from "../../domain/metrics/store-time";
import { listCampaigns } from "../../domain/finance/ads.service";

const CACHE_TTL_SECONDS = 300;

export interface AdReturnRow {
  key: string;
  name: string;
  /** The Finance › Ads campaign this matches, if any. */
  financeCampaignId: string | null;
  sessions: number;
  orders: number;
  realisedOrders: number;
  netSales: number;
  grossMargin: number;
  /** Finance spend for the period (actual, else planned); null = not recorded in Finance. */
  spend: number | null;
  plannedShare: number | null;
  roas: number | null;
  profitAfterAds: number | null;
  costPerRealisedOrder: number | null;
}

export interface AdReturnsReport {
  range: { from: string; to: string };
  campaigns: AdReturnRow[];
  totals: { spend: number; netSales: number; grossMargin: number; orders: number; realisedOrders: number; profitAfterAds: number | null; roas: number | null };
  /** Campaigns in Finance with spend in the period but no visits carrying their id or name. */
  unmatchedSpend: Array<{ name: string; spend: number }>;
  financeConnected: boolean;
}

/** A Finance › Ads campaign's spend for the period, as Finance computes it. */
export interface FinanceCampaignSpend {
  id: string;
  name: string;
  externalId: string | null;
  spend: number;
  plannedSpend: number;
}

/** Finance's campaigns with their period spend; empty without reading Finance when none are recorded (its context
 * bootstraps the books on first use). */
export async function financeCampaignSpend(from: string, to: string): Promise<FinanceCampaignSpend[] | null> {
  if ((await prisma.adCampaign.count()) === 0) return null;
  return (await listCampaigns({ from, to })).campaigns;
}

export async function getAdReturns(days?: number, dateFrom?: Date, dateTo?: Date, deps: { campaignSpend?: typeof financeCampaignSpend } = {}): Promise<AdReturnsReport> {
  const range = await resolveLegacyWindow(days, dateFrom, dateTo);
  const key = `analytics:v1:ad-returns:${range.timezone}:${range.startUtc.toISOString()}:${range.endUtc.toISOString()}`;
  const hit = await cacheGet<AdReturnsReport>(key);
  if (hit) return hit;

  const [sessionRows, { orders, currency }, finance] = await Promise.all([
    // Each session started in the window, with the first utm_campaign it carried.
    prisma.$queryRaw<Array<{ campaign: string; sessions: bigint }>>`
      SELECT c.campaign, COUNT(*)::bigint AS sessions FROM (
        SELECT DISTINCT ON (pv."sessionId") pv."sessionId", pv."utmCampaign" AS campaign
        FROM "PageView" pv
        WHERE pv."utmCampaign" IS NOT NULL AND pv."createdAt" >= ${utcInstant(range.startUtc)} AND pv."createdAt" < ${utcInstant(range.endUtc)}
          AND NOT EXISTS (SELECT 1 FROM "PageView" e WHERE e."sessionId" = pv."sessionId" AND e."createdAt" < ${utcInstant(range.startUtc)})
        ORDER BY pv."sessionId", pv."createdAt" ASC
      ) c GROUP BY c.campaign`,
    loadFactsForRange(range),
    (deps.campaignSpend ?? financeCampaignSpend)(range.from, range.to),
  ]);

  // The campaign of each ordering session: the first utm_campaign seen in that session.
  const orderSessions = [...new Set(orders.map((o) => o.sessionId).filter((s): s is string => Boolean(s)))];
  const sessionCampaign = new Map<string, string>();
  if (orderSessions.length) {
    const rows = await prisma.$queryRaw<Array<{ sessionId: string; campaign: string }>>`
      SELECT DISTINCT ON ("sessionId") "sessionId", "utmCampaign" AS campaign FROM "PageView"
      WHERE "sessionId" = ANY(${orderSessions}) AND "utmCampaign" IS NOT NULL ORDER BY "sessionId", "createdAt" ASC`;
    for (const r of rows) sessionCampaign.set(r.sessionId, r.campaign);
  }
  const campaignOf = (o: OrderFact) => (o.sessionId ? (sessionCampaign.get(o.sessionId) ?? null) : null);

  const norm = (s: string) => s.trim().toLowerCase();
  const rows = new Map<string, AdReturnRow>();
  const row = (campaign: string) => {
    const k = norm(campaign);
    let r = rows.get(k);
    if (!r) {
      r = { key: k, name: campaign, financeCampaignId: null, sessions: 0, orders: 0, realisedOrders: 0, netSales: 0, grossMargin: 0, spend: null, plannedShare: null, roas: null, profitAfterAds: null, costPerRealisedOrder: null };
      rows.set(k, r);
    }
    return r;
  };
  for (const s of sessionRows) row(s.campaign).sessions += Number(s.sessions);

  const sum = (metric: string, apply: (r: AdReturnRow, v: number) => void) => {
    const by = new Map<string, number>();
    for (const c of contributions(metric, orders, range)) {
      const camp = campaignOf(c.order);
      if (camp) by.set(camp, (by.get(camp) ?? 0) + c.amount);
    }
    for (const [camp, v] of by) apply(row(camp), v);
  };
  const major = (v: number) => toMajor(money(v, currency));
  sum("orders_placed", (r, v) => (r.orders += v));
  sum("orders_realised", (r, v) => (r.realisedOrders += v));
  sum("realised_net_sales", (r, v) => (r.netSales += major(v)));
  sum("gross_margin", (r, v) => (r.grossMargin += major(v)));

  const unmatchedSpend: AdReturnsReport["unmatchedSpend"] = [];
  if (finance) {
    for (const c of finance) {
      if (!c.spend) continue;
      const target = [c.externalId, c.name].filter((x): x is string => Boolean(x)).map(norm).map((k) => rows.get(k)).find(Boolean);
      if (!target) {
        unmatchedSpend.push({ name: c.name, spend: c.spend });
        continue;
      }
      target.name = c.name;
      target.financeCampaignId = c.id;
      target.spend = (target.spend ?? 0) + c.spend;
      target.plannedShare = target.spend > 0 ? c.plannedSpend / target.spend : 0;
    }
  }
  for (const r of rows.values()) {
    if (r.spend && r.spend > 0) {
      r.roas = r.netSales / r.spend;
      r.profitAfterAds = r.grossMargin - r.spend;
      r.costPerRealisedOrder = r.realisedOrders > 0 ? r.spend / r.realisedOrders : null;
    }
  }

  const campaigns = [...rows.values()].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0) || b.netSales - a.netSales || b.sessions - a.sessions);
  const spent = campaigns.filter((c) => c.spend !== null);
  const spend = spent.reduce((s, c) => s + (c.spend ?? 0), 0);
  const report: AdReturnsReport = {
    range: { from: range.from, to: range.to },
    campaigns,
    totals: {
      spend,
      netSales: campaigns.reduce((s, c) => s + c.netSales, 0),
      grossMargin: campaigns.reduce((s, c) => s + c.grossMargin, 0),
      orders: campaigns.reduce((s, c) => s + c.orders, 0),
      realisedOrders: campaigns.reduce((s, c) => s + c.realisedOrders, 0),
      profitAfterAds: spent.length ? spent.reduce((s, c) => s + c.grossMargin, 0) - spend : null,
      roas: spend > 0 ? spent.reduce((s, c) => s + c.netSales, 0) / spend : null,
    },
    unmatchedSpend,
    financeConnected: finance !== null,
  };
  await cacheSet(key, report, CACHE_TTL_SECONDS);
  return report;
}
