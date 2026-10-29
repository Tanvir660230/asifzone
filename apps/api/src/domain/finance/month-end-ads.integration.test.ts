import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, markOpeningPostedInTx, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { financeTransaction } from "./finance-tx";
import { adSpendGaps } from "./ads.service";
import { monthEndChecklist, monthLabel } from "./finance-alerts.service";

// Blueprint P0.7 (owner decisions Q16 = A, Q-E, I-4): a month's ad spend is complete when every campaign that is not
// archived and spent in the month or the month before has each day recorded — spend > 0, or a zero a person confirmed.

const CSRF = "vitest-csrf";
let admin: string;
let OWNER: FinanceActor;
const api = () => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    post: (url: string, body: object = {}) => auth(request(app).post(`/api/v1/finance${url}`)).send(body),
    put: (url: string, body: object = {}) => auth(request(app).put(`/api/v1/finance${url}`)).send(body),
  };
};
const MONTH = "2026-09";
const septemberDays = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
let adAccount = "";
let live = "";
let quiet = "";

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await financeTransaction(async (tx) => {
    await tx.financeBusiness.update({ where: { id: ctx.business.id }, data: { openingDate: new Date("2026-08-01T00:00:00Z") } });
    await tx.financeAuditEntry.create({ data: { businessId: ctx.business.id, actorType: "SYSTEM", actorLabel: "test", action: "business.update", entityType: "FinanceBusiness", entityId: ctx.business.id } });
    await markOpeningPostedInTx(tx, ctx.business.id, new Date("2026-08-01T00:00:00Z"));
  });
  const a = await api().post("/financial-accounts", { kind: "AD_PLATFORM", name: `Meta ads ${RUN}`, provider: "Meta", accountReference: `act_${RUN}` });
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  adAccount = a.body.id;
  const c1 = await api().post("/ads/campaigns", { financialAccountId: adAccount, name: `Live ${RUN}`, startDate: "2026-09-01" });
  expect(c1.status, JSON.stringify(c1.body)).toBe(201);
  live = c1.body.id;
  const c2 = await api().post("/ads/campaigns", { financialAccountId: adAccount, name: `Quiet ${RUN}`, startDate: "2026-08-01", endDate: "2026-09-30" });
  quiet = c2.body.id;
  // Live spent on 1 Sep; Quiet spent only in August — both are in scope for September (spend this month or the month before)
  expect((await api().put(`/ads/campaigns/${live}/spend`, { date: "2026-09-01", amount: 100 })).status).toBe(200);
  expect((await api().put(`/ads/campaigns/${quiet}/spend`, { date: "2026-08-20", amount: 80 })).status).toBe(200);
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("month-end step 11: ad spend complete", () => {
  it("lists every day of an in-scope campaign without spend or a confirmed zero; the step stays open", async () => {
    const gaps = await adSpendGaps(MONTH);
    expect(gaps.find((g) => g.campaignId === live)?.missing).toEqual(septemberDays.slice(1));
    expect(gaps.find((g) => g.campaignId === quiet)?.missing).toEqual(septemberDays);
    const step = (await monthEndChecklist({ month: MONTH })).steps.find((s) => s.key === "ads")!;
    expect(step.status).toBe("TODO");
  });

  it("an imported or typed zero stays missing until a person confirms it; a confirmed zero counts", async () => {
    expect((await api().put(`/ads/campaigns/${live}/spend`, { date: "2026-09-02", amount: 0 })).status).toBe(200);
    expect((await adSpendGaps(MONTH)).find((g) => g.campaignId === live)?.missing).toContain("2026-09-02");
    const r = await api().post(`/ads/campaigns/${live}/confirm-zero`, { dates: septemberDays.slice(1), reason: "campaign paused all month" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await adSpendGaps(MONTH)).find((g) => g.campaignId === live)).toBeUndefined();
    const row = await prisma.adSpendDay.findFirstOrThrow({ where: { campaignId: live, date: new Date("2026-09-02T00:00:00Z") } });
    expect(row.confirmedZeroReason).toBe("campaign paused all month");
  });

  it("a confirmed zero never hides real spend, and needs a reason", async () => {
    expect((await api().post(`/ads/campaigns/${live}/confirm-zero`, { dates: ["2026-09-01"], reason: "oops" })).body.details?.code).toBe("DAY_HAS_SPEND");
    expect((await api().post(`/ads/campaigns/${live}/confirm-zero`, { dates: ["2026-09-03"] })).status).toBe(400);
  });

  it("archiving a campaign takes it out of the check; with every gap closed the step is done", async () => {
    const r = await api().post(`/ads/campaigns/${quiet}/archive`, { archived: true, reason: "ended in August" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await adSpendGaps(MONTH)).toEqual([]);
    expect((await monthEndChecklist({ month: MONTH })).steps.find((s) => s.key === "ads")!.status).toBe("DONE");
    // and bringing it back puts it in scope again
    await api().post(`/ads/campaigns/${quiet}/archive`, { archived: false });
    expect((await adSpendGaps(MONTH)).map((g) => g.campaignId)).toEqual([quiet]);
  });

  it("step 10 is part of the checklist; money Steadfast still holds is never a step", async () => {
    const steps = (await monthEndChecklist({ month: MONTH })).steps.map((s) => s.key);
    expect(steps).toContain("payouts");
    expect(steps).not.toContain("steadfast_held");
  });
});

describe("Final label (I-4)", () => {
  const effective = new Date("2026-11-01T00:00:00Z");
  it("a closed month with every step done is Final; open steps keep it Draft", () => {
    expect(monthLabel({ status: "CLOSED", closedAt: new Date("2026-11-05T00:00:00Z") }, 0, effective)).toBe("FINAL");
    expect(monthLabel({ status: "CLOSED", closedAt: new Date("2026-11-05T00:00:00Z") }, 2, effective)).toBe("DRAFT");
  });
  it("a month closed before the rule took effect keeps its Final label (Aug, Sep 2026)", () => {
    expect(monthLabel({ status: "CLOSED", closedAt: new Date("2026-10-03T00:00:00Z") }, 3, effective)).toBe("FINAL");
  });
  it("an open or soft-closed month is Draft", () => {
    expect(monthLabel({ status: "SOFT_CLOSED", closedAt: null }, 0, effective)).toBe("DRAFT");
    expect(monthLabel(null, 0, effective)).toBe("DRAFT");
  });
});
