/**
 * TikTok Business API — daily spend per campaign of an advertiser (owner's books §5.2), the twin of meta-insights.ts.
 * Read-only; needs a long-term access token with the Reporting scope (TikTok for Business Developers › My apps ›
 * Advertiser authorization). The guard in lib/provider-guard.ts blocks it outside production.
 *
 *   GET https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/   (header Access-Token)
 *     report_type BASIC, data_level AUCTION_CAMPAIGN, dimensions ["campaign_id","stat_time_day"]
 *   → { code: 0, message, data: { list: [{ dimensions: { campaign_id, stat_time_day: "2026-11-25 00:00:00" },
 *                                          metrics: { spend: "501.97", campaign_name, impressions, clicks, conversion } }],
 *                                  page_info: { page, total_page } } }
 * A daily report covers at most 30 days, so a longer window is read in 30-day slices.
 */
import { addDays } from "@clothing-brand/shared";
import { integrationSetting } from "../../config/integration-overrides";
import { AppError } from "../../lib/app-error";
import type { CampaignSpendDay } from "./meta-insights";

const BASE = "https://business-api.tiktok.com/open_api/v1.3";

export function tiktokAdsConfig() {
  const token = integrationSetting("TIKTOK_ADS_ACCESS_TOKEN").trim();
  const accounts = integrationSetting("TIKTOK_ADS_ADVERTISER_IDS")
    .split(/[\s,]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  return { token, accounts, configured: Boolean(token && accounts.length) };
}

interface ReportRow {
  dimensions?: { campaign_id?: string; stat_time_day?: string };
  metrics?: { spend?: string; campaign_name?: string; impressions?: string; clicks?: string; conversion?: string; currency?: string };
}
interface ReportBody {
  code?: number;
  message?: string;
  data?: { list?: ReportRow[]; page_info?: { page?: number; total_page?: number } };
}

const intOrNull = (v: string | undefined) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

/** One report response → campaign-days (rows without a campaign or a day are skipped). Pure; exported for tests. */
export function parseTikTokReport(body: ReportBody, currency: string): CampaignSpendDay[] {
  const out: CampaignSpendDay[] = [];
  for (const r of body.data?.list ?? []) {
    const id = r.dimensions?.campaign_id;
    const day = (r.dimensions?.stat_time_day ?? "").slice(0, 10);
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    out.push({
      campaignId: id,
      campaignName: r.metrics?.campaign_name || id,
      date: day,
      spend: Number(r.metrics?.spend ?? 0) || 0,
      currency: (r.metrics?.currency || currency).toUpperCase(),
      impressions: intOrNull(r.metrics?.impressions),
      clicks: intOrNull(r.metrics?.clicks),
      purchases: intOrNull(r.metrics?.conversion),
    });
  }
  return out;
}

/** The advertiser's currency (the report doesn't carry it). */
async function advertiserCurrency(token: string, advertiserId: string): Promise<string> {
  const params = new URLSearchParams({ advertiser_ids: JSON.stringify([advertiserId]), fields: JSON.stringify(["currency"]) });
  const res = await fetch(`${BASE}/advertiser/info/?${params}`, { headers: { "Access-Token": token }, signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => null)) as { code?: number; message?: string; data?: { list?: Array<{ currency?: string }> } } | null;
  if (!res.ok || !body || body.code !== 0) throw AppError.badRequest(`TikTok advertiser ${advertiserId}: ${body?.message ?? `HTTP ${res.status}`}`);
  return (body.data?.list?.[0]?.currency ?? "").toUpperCase();
}

/** Every campaign-day of `advertiserId` in [since, until] (inclusive, the advertiser's time zone), following paging. */
export async function fetchTikTokCampaignSpend(advertiserId: string, since: string, until: string): Promise<CampaignSpendDay[]> {
  const { token } = tiktokAdsConfig();
  if (!token) throw AppError.badRequest("TikTok ad spend isn't connected — add the access token in Settings › Integrations");
  const currency = await advertiserCurrency(token, advertiserId);
  const out: CampaignSpendDay[] = [];
  for (let start = since; start <= until; start = addDays(start, 30)) {
    const end = addDays(start, 29) < until ? addDays(start, 29) : until;
    for (let page = 1, pages = 1; page <= pages && page <= 50; page++) {
      const params = new URLSearchParams({
        advertiser_id: advertiserId,
        report_type: "BASIC",
        data_level: "AUCTION_CAMPAIGN",
        dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
        metrics: JSON.stringify(["spend", "campaign_name", "impressions", "clicks", "conversion"]),
        start_date: start,
        end_date: end,
        page: String(page),
        page_size: "1000",
      });
      const res = await fetch(`${BASE}/report/integrated/get/?${params}`, { headers: { "Access-Token": token }, signal: AbortSignal.timeout(20_000) });
      const body = (await res.json().catch(() => null)) as ReportBody | null;
      if (!res.ok || !body || body.code !== 0) throw AppError.badRequest(`TikTok ad spend for ${advertiserId} failed: ${body?.message ?? `HTTP ${res.status}`}`);
      out.push(...parseTikTokReport(body, currency));
      pages = body.data?.page_info?.total_page ?? 1;
    }
  }
  return out;
}
