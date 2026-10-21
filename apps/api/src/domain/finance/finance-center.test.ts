import { describe, it, expect } from "vitest";
import { daySpendAmount, parseAdCsv, plannedByVersions } from "./ads.service";
import { renewalState, smsUsage } from "./finance-center.service";

describe("planned ad spend by budget history", () => {
  const c = { startDate: "2026-10-01", endDate: null };
  it("each day uses the budget in force that day", () => {
    const p = plannedByVersions(c, [{ from: "2026-10-01", budgetType: "DAILY", budget: 500 }, { from: "2026-10-03", budgetType: "DAILY", budget: 800 }], "2026-10-04");
    expect([...p.values()]).toEqual([500, 500, 800, 800]);
  });
  it("a change back-dated before the start applies from the start; no budget = nothing planned", () => {
    expect([...plannedByVersions(c, [{ from: "2026-09-01", budgetType: "DAILY", budget: 300 }], "2026-10-02").values()]).toEqual([300, 300]);
    expect(plannedByVersions(c, [{ from: "2026-10-01", budgetType: null, budget: null }], "2026-10-02").size).toBe(0);
  });
});

describe("a day's spend in another currency", () => {
  it("taka is exact; USD at a given rate is exact; at the default rate it is an estimate", () => {
    expect(daySpendAmount({ date: "x", amount: 450 }, "BDT", null)).toMatchObject({ amount: 45000, estimated: false });
    expect(daySpendAmount({ date: "x", originalAmount: 5, currency: "usd", fxRate: 124 }, "BDT", 122)).toMatchObject({ amount: 62000, original: 500, currency: "USD", rate: 124, estimated: false });
    expect(daySpendAmount({ date: "x", originalAmount: 5, currency: "USD" }, "BDT", 122)).toMatchObject({ amount: 61000, estimated: true });
  });
  it("the card's taka figure wins and gives the real rate; no rate at all is refused", () => {
    expect(daySpendAmount({ date: "x", originalAmount: 5, currency: "USD", amount: 615 }, "BDT", 122)).toMatchObject({ amount: 61500, rate: 123, estimated: false });
    expect(() => daySpendAmount({ date: "x", originalAmount: 5, currency: "USD" }, "BDT", null)).toThrow(/taka per USD/);
  });
});

describe("ad CSV", () => {
  it("reads Meta's export: quoted names, the currency in the header, day/month/year dates", () => {
    const r = parseAdCsv(`﻿Reporting starts,Campaign name,Campaign ID,Amount spent (USD),Results\n21/10/2026,"Tupi, BOGO",77,"1,204.50",3`, "BDT");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ date: "2026-10-21", campaignName: "Tupi, BOGO", campaignId: "77", spend: 1204.5, currency: "USD", purchases: 3 });
  });
  it("never guesses: bad dates, amounts and duplicate campaign-days are errors", () => {
    const r = parseAdCsv(`Day,Campaign name,Amount spent\n2026-13-45,A,1\n2026-10-01,A,abc\n2026-10-01,B,1\n2026-10-01,b,2`, "USD");
    expect(r.rows.map((x) => x.campaignName)).toEqual(["B"]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 5]);
    expect(parseAdCsv(`Name,Spend\nA,1`, "USD").errors[0]!.error).toMatch(/Need columns/);
  });
});

describe("subscriptions", () => {
  const p = { name: "VPS", serviceStart: "2026-10-04", serviceEnd: "2027-10-03", remindDaysBefore: 30 };
  it("active, then renew soon from the reminder day, expired after the end, renewed by a later payment", () => {
    expect(renewalState(p, [], "2027-01-01").status).toBe("ACTIVE");
    expect(renewalState(p, [], "2027-09-03")).toMatchObject({ status: "RENEW_SOON", remindOn: "2027-09-03", daysToEnd: 30 });
    expect(renewalState(p, [], "2027-10-04").status).toBe("EXPIRED");
    expect(renewalState(p, [{ name: " vps ", serviceStart: "2027-10-04" }], "2027-10-10").status).toBe("RENEWED");
  });
});

describe("SMS usage", () => {
  it("usage = drop in balance + recharges in between, never negative", () => {
    const u = smsUsage(
      [{ at: "2026-10-01T10:00:00Z", balance: 150000 }, { at: "2026-10-10T10:00:00Z", balance: 100000 }, { at: "2026-10-20T10:00:00Z", balance: 250000 }],
      [{ date: "2026-10-15", amount: 200000 }],
    );
    expect(u.map((x) => [x.used, x.recharged])).toEqual([[50000, 0], [50000, 200000]]);
  });
});
