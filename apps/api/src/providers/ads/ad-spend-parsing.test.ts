import { describe, it, expect } from "vitest";
import { parseTikTokReport } from "./tiktok-report";
import { taxPercentOf } from "./meta-insights";
import { withSpendTax } from "../../domain/finance/ads.service";

describe("ad spend parsing", () => {
  it("reads TikTok's daily campaign report: day from stat_time_day, spend, name, counts; skips rows without a campaign or day", () => {
    const rows = parseTikTokReport(
      {
        code: 0,
        data: {
          list: [
            { dimensions: { campaign_id: "1849", stat_time_day: "2026-11-25 00:00:00" }, metrics: { spend: "501.97", campaign_name: "Haven - Website Purchase", impressions: "19642", clicks: "337", conversion: "7" } },
            { dimensions: { campaign_id: "1849", stat_time_day: "2026-11-26 00:00:00" }, metrics: { spend: "500.45", campaign_name: "Haven - Website Purchase", impressions: "23049", clicks: "418", conversion: "6" } },
            { dimensions: { stat_time_day: "2026-11-26 00:00:00" }, metrics: { spend: "9" } },
            { dimensions: { campaign_id: "77", stat_time_day: "" }, metrics: { spend: "9" } },
          ],
        },
      },
      "bdt",
    );
    expect(rows).toEqual([
      { campaignId: "1849", campaignName: "Haven - Website Purchase", date: "2026-11-25", spend: 501.97, currency: "BDT", impressions: 19642, clicks: 337, purchases: 7 },
      { campaignId: "1849", campaignName: "Haven - Website Purchase", date: "2026-11-26", spend: 500.45, currency: "BDT", impressions: 23049, clicks: 418, purchases: 6 },
    ]);
  });

  it("a campaign without a name falls back to its id; missing numbers are null", () => {
    expect(parseTikTokReport({ data: { list: [{ dimensions: { campaign_id: "5", stat_time_day: "2026-11-01 00:00:00" }, metrics: {} }] } }, "BDT")).toEqual([
      { campaignId: "5", campaignName: "5", date: "2026-11-01", spend: 0, currency: "BDT", impressions: null, clicks: null, purchases: null },
    ]);
  });

  it("the tax setting: '5', '5%' and ' 7.5 ' are read; blank, junk, negative and 100+ are 0", () => {
    expect([taxPercentOf("5"), taxPercentOf("5%"), taxPercentOf(" 7.5 ")]).toEqual([5, 5, 7.5]);
    expect([taxPercentOf(""), taxPercentOf("five"), taxPercentOf("-5"), taxPercentOf("100")]).toEqual([0, 0, 0, 0]);
  });

  it("spend + tax is rounded to the paisa (Ads Manager ৳501.97 + 5% = ৳527.07)", () => {
    expect(withSpendTax(50197, 5)).toBe(52707);
    expect(withSpendTax(50045, 5)).toBe(52547);
    expect(withSpendTax(50197, 0)).toBe(50197);
  });
});
