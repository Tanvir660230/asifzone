/**
 * Meta Marketing API — daily spend per campaign of an ad account (owner's books §5.2). Read-only; needs a token with
 * `ads_read` (Business Settings › System users). The guard in lib/provider-guard.ts blocks it outside production.
 */
import { env } from "../../config/env";
import { integrationSetting } from "../../config/integration-overrides";
import { AppError } from "../../lib/app-error";

export interface MetaCampaignDay {
  campaignId: string;
  campaignName: string;
  date: string;
  spend: number;
  currency: string;
  impressions: number | null;
  clicks: number | null;
  purchases: number | null;
}

export function metaAdsConfig() {
  const token = integrationSetting("META_ADS_ACCESS_TOKEN").trim();
  const accounts = integrationSetting("META_ADS_ACCOUNT_IDS")
    .split(/[\s,]+/)
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => (a.startsWith("act_") ? a : `act_${a}`));
  return { token, accounts, configured: Boolean(token && accounts.length) };
}

interface InsightRow {
  campaign_id?: string;
  campaign_name?: string;
  date_start?: string;
  spend?: string;
  account_currency?: string;
  impressions?: string;
  clicks?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
}

const intOrNull = (v: string | undefined) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

/** Every campaign-day of `adAccountId` in [since, until] (inclusive, the account's time zone), following Meta's paging. */
export async function fetchMetaCampaignSpend(adAccountId: string, since: string, until: string): Promise<MetaCampaignDay[]> {
  const { token } = metaAdsConfig();
  if (!token) throw AppError.badRequest("Meta ad spend isn't connected — add the access token in Settings › Integrations");
  const params = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,campaign_name,spend,account_currency,impressions,clicks,actions,date_start",
    limit: "500",
    access_token: token,
  });
  let url: string | null = `https://graph.facebook.com/${env.meta.apiVersion}/${adAccountId}/insights?${params}`;
  const out: MetaCampaignDay[] = [];
  for (let page = 0; url && page < 50; page++) {
    const res: Response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = (await res.json().catch(() => null)) as { data?: InsightRow[]; paging?: { next?: string }; error?: { message?: string } } | null;
    if (!res.ok || !body) throw AppError.badRequest(`Meta ad spend for ${adAccountId} failed: ${body?.error?.message ?? `HTTP ${res.status}`}`);
    for (const r of body.data ?? []) {
      if (!r.campaign_id || !r.date_start) continue;
      out.push({
        campaignId: r.campaign_id,
        campaignName: r.campaign_name ?? r.campaign_id,
        date: r.date_start,
        spend: Number(r.spend ?? 0) || 0,
        currency: (r.account_currency ?? "").toUpperCase(),
        impressions: intOrNull(r.impressions),
        clicks: intOrNull(r.clicks),
        purchases: intOrNull(r.actions?.find((a) => a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase")?.value),
      });
    }
    url = body.paging?.next ?? null;
  }
  return out;
}
