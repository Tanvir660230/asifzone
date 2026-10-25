import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { PERMISSIONS, addDays } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN } from "../../test-fixtures";
import { updateOrderStatus } from "../../modules/orders/order.service";
import type { FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { ensurePurchasingAccounting } from "./purchasing-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "./inventory-cutover.service";
import { approvePurchaseOrder, createPurchaseOrder, submitPurchaseOrder } from "./purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt } from "./goods-receipts.service";
import { createSupplier } from "./suppliers.service";
import { processFinancialEvent } from "./events.service";
import { runReconciliation } from "./reconciliation.service";
import { createMaterial } from "../manufacturing/materials.service";

// Owner's books §5–§6 (docs/FINANCE_OWNER_BOOKS.md): ad spend booked day by day (budget until the actual is known, Meta's
// figures replacing it), a year of hosting shared month by month, and packaging leaving stock with each parcel at its real
// cost — after a real valuation cutover, so the books' checks prove it.

const meta = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock("../../providers/ads/meta-insights", () => ({
  metaAdsConfig: () => ({ token: "t", accounts: ["act_111"], configured: true }),
  fetchMetaCampaignSpend: async () => meta.rows,
}));

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin: string;
const api = () => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/v1/finance${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
    patch: (url: string, body: object = {}) => auth(request(app).patch(`/api/v1/finance${url}`)).send(body),
    put: (url: string, body: object = {}) => auth(request(app).put(`/api/v1/finance${url}`)).send(body),
  };
};
let bank = "";
let adAccount = "";
let acc: Record<string, string> = {};
let poly = "";
let today = "";

async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function balanceOf(mappingKeyOrAccountId: string) {
  const { business } = await getFinanceContext();
  const m = await prisma.accountMapping.findUnique({ where: { businessId_key: { businessId: business.id, key: mappingKeyOrAccountId } } });
  const s = await prisma.journalLine.aggregate({ where: { accountId: m?.accountId ?? mappingKeyOrAccountId, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100;
}
const stock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  today = businessToday(ctx.business);
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "OB-SEED", name: "seed", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  acc = Object.fromEntries(((await api().get("/accounts")).body.accounts as Array<{ id: string; code: string }>).map((a) => [a.code, a.id]));
  const b = await api().post("/financial-accounts", { kind: "BANK", name: `Bank ${RUN}`, openingBalance: { amount: 100000, date: "2026-09-01" } });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  bank = b.body.id;
});

afterAll(async () => {
  await prisma.packingRule.deleteMany({ where: { notes: { startsWith: "vitest" } } });
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`UPDATE "OrderItem" SET "costMovementId" = NULL WHERE "costMovementId" IS NOT NULL`);
    await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "variantId" IN (SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.kind = 'MATERIAL' AND p.name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %'`);
  });
  await cleanupFixtures();
});

describe("ad spend", () => {
  it("an ad account is a money account; topping it up is a transfer into it", async () => {
    const r = await api().post("/financial-accounts", { kind: "AD_PLATFORM", name: `Meta ads ${RUN}`, provider: "Meta", accountReference: "act_111" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    adAccount = r.body.id;
    const t = await api().post("/movements/transfer", { movementDate: "2026-10-01", description: "bKash top-up to Meta", amount: 20000, fromFinancialAccountId: bank, toFinancialAccountId: adAccount }, `ads-top-${RUN}`);
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect((await api().get(`/financial-accounts/${adAccount}`)).body.currentBalance).toBe(20000);
  });

  it("a daily-budget campaign books its budget each day that has passed; an actual figure replaces the day's budget", async () => {
    const c = await api().post("/ads/campaigns", { financialAccountId: adAccount, name: "Cap launch", startDate: "2026-10-01", endDate: "2026-10-05", budgetType: "DAILY", budget: 500, landingPath: "/lp/cap" });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body).toMatchObject({ name: "Cap launch", budgetType: "DAILY", budget: 500 });
    expect(await balanceOf("expense.advertising")).toBe(2500);
    expect((await api().put(`/ads/campaigns/${c.body.id}/spend`, { date: "2026-10-02", amount: 450 })).status).toBe(200);
    expect(await balanceOf("expense.advertising")).toBe(2450);
    const list = (await api().get("/ads/campaigns?from=2026-10-01&to=2026-10-31")).body;
    expect(list.campaigns[0]).toMatchObject({ name: "Cap launch", spend: 2450, actualSpend: 450, plannedSpend: 2000 });
    expect((await api().get(`/financial-accounts/${adAccount}`)).body.currentBalance).toBe(17550);
    expect((await api().post("/ads/campaigns", { financialAccountId: bank, name: "x", startDate: "2026-10-01" })).body.details?.code).toBe("NOT_AN_AD_ACCOUNT");
    expect((await api().post("/ads/campaigns", { financialAccountId: adAccount, name: "x", startDate: "2026-10-01", budgetType: "LIFETIME", budget: 100 })).body.details?.code).toBe("CAMPAIGN_BUDGET");
  });

  it("Meta's daily spend comes in by campaign: new campaigns are created, a re-import changes nothing", async () => {
    meta.rows = [
      { campaignId: "cmp-9", campaignName: "Attar retargeting", date: "2026-10-10", spend: 700, currency: "BDT", impressions: 5000, clicks: 80, purchases: 3 },
      { campaignId: "cmp-9", campaignName: "Attar retargeting", date: "2026-10-11", spend: 650.5, currency: "BDT", impressions: 4200, clicks: 61, purchases: 2 },
    ];
    const r = await api().post("/ads/import-meta", { since: "2026-10-01" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.accounts[0]).toMatchObject({ adAccountId: "act_111", days: 2, campaigns: 1, error: null });
    expect(await balanceOf("expense.advertising")).toBe(2450 + 1350.5);
    await api().post("/ads/import-meta", { since: "2026-10-01" });
    expect(await balanceOf("expense.advertising")).toBe(2450 + 1350.5);
    // Meta revises a day: the books follow (a new revision supersedes the old)
    meta.rows[1]!.spend = 600;
    await api().post("/ads/import-meta", { since: "2026-10-01" });
    expect(await balanceOf("expense.advertising")).toBe(2450 + 1300);
  });

  it("a period total (USD at a rate, or taka) is shared over the days without their own figure; entering it again replaces only those", async () => {
    const before = await balanceOf("expense.advertising");
    const c = await api().post("/ads/campaigns", { financialAccountId: adAccount, name: "Before tracking", startDate: "2026-10-01", endDate: "2026-10-04" });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect((await api().put(`/ads/campaigns/${c.body.id}/spend`, { date: "2026-10-02", originalAmount: 2, currency: "USD", fxRate: 130 })).status).toBe(200);
    const r = await api().put(`/ads/campaigns/${c.body.id}/period-spend`, { from: "2026-10-01", to: "2026-10-04", originalAmount: 10, currency: "USD", fxRate: 130 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ total: 1300, original: 10, currency: "USD", rate: 130, ownDays: 1, ownTotal: 260, sharedDays: 3, shared: 1040 });
    const days = await prisma.adSpendDay.findMany({ where: { campaignId: c.body.id }, orderBy: { date: "asc" } });
    expect(days.map((d) => [d.source, Number(d.amount), Number(d.originalAmount)])).toEqual([["PERIOD", 346.67, 2.67], ["MANUAL", 260, 2], ["PERIOD", 346.67, 2.67], ["PERIOD", 346.66, 2.66]]);
    expect(await balanceOf("expense.advertising")).toBe(before + 1300);
    // In taka this time: the typed day stays, the shared days are replaced
    expect((await api().put(`/ads/campaigns/${c.body.id}/period-spend`, { from: "2026-10-01", to: "2026-10-04", amount: 1500 })).body).toMatchObject({ total: 1500, shared: 1240, sharedDays: 3 });
    expect(await balanceOf("expense.advertising")).toBe(before + 1500);
    expect((await api().put(`/ads/campaigns/${c.body.id}/period-spend`, { from: "2026-10-01", to: "2026-10-04", amount: 100 })).body.details?.code).toBe("PERIOD_LESS_THAN_DAYS");
    expect((await api().put(`/ads/campaigns/${c.body.id}/period-spend`, { from: "2026-09-30", to: "2026-10-04", amount: 1500 })).body.details?.code).toBe("PERIOD_OUTSIDE_CAMPAIGN");
    expect(await balanceOf("expense.advertising")).toBe(before + 1500);
  });

  it("Meta's figure for a day already given as part of a period total is not booked again; later days are", async () => {
    const before = await balanceOf("expense.advertising");
    meta.rows = [
      { campaignId: "cmp-10", campaignName: "Caps October", date: "2026-10-03", spend: 400, currency: "BDT", impressions: 1, clicks: 1, purchases: 0 },
      { campaignId: "cmp-10", campaignName: "Caps October", date: "2026-10-12", spend: 250, currency: "BDT", impressions: 1, clicks: 1, purchases: 0 },
    ];
    const r = await api().post("/ads/import-meta", { since: "2026-10-01" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await balanceOf("expense.advertising")).toBe(before + 250);
  });

  it("switching a campaign off keeps the spend of the days it ran; switching it back on changes nothing behind it", async () => {
    const before = await balanceOf("expense.advertising");
    const c = await api().post("/ads/campaigns", { financialAccountId: adAccount, name: `Ran then stopped ${RUN}`, startDate: addDays(today, -5), budgetType: "DAILY", budget: 100 });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(await balanceOf("expense.advertising")).toBe(before + 500);
    const off = await api().patch(`/ads/campaigns/${c.body.id}`, { isActive: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(await balanceOf("expense.advertising")).toBe(before + 500);
    expect((await api().patch(`/ads/campaigns/${c.body.id}`, { isActive: true })).status).toBe(200);
    expect(await balanceOf("expense.advertising")).toBe(before + 500);
  });

  it("a Meta campaign with a budget: a finished day Meta didn't report spent nothing — its budget isn't booked for it", async () => {
    const before = await balanceOf("expense.advertising");
    const c = await api().post("/ads/campaigns", { financialAccountId: adAccount, name: `Paused on Meta ${RUN}`, externalId: "cmp-11", startDate: addDays(today, -3), budgetType: "DAILY", budget: 300 });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(await balanceOf("expense.advertising")).toBe(before + 900); // budget until Meta's figures are known
    meta.rows = [{ campaignId: "cmp-11", campaignName: "Paused on Meta", date: addDays(today, -2), spend: 120, currency: "BDT", impressions: 1, clicks: 1, purchases: 0 }];
    const r = await api().post("/ads/import-meta", { since: addDays(today, -3) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await balanceOf("expense.advertising")).toBe(before + 120);
  });
});

describe("ad tags not linked to a campaign", () => {
  it("lists the utm_campaign values visitors arrived with that no campaign claims, with their orders; linking one moves its orders onto the campaign", async () => {
    const tag = `1202${RUN.replace(/\D/g, "").slice(0, 10)}`;
    const session = `s-unlinked-${RUN}`;
    const at = new Date("2026-10-15T08:00:00Z");
    await prisma.pageView.createMany({ data: [
      { sessionId: session, path: "/", utmSource: "fb", utmCampaign: tag, createdAt: at },
      { sessionId: `${session}-2`, path: "/", utmSource: "fb", utmCampaign: tag, createdAt: at },
    ] });
    const p = await createStockedProduct({ stocks: [5], basePrice: 900 });
    const o = await placeOrder([{ variantId: p.variants[0]!.id, quantity: 1 }]);
    await prisma.order.update({ where: { id: o.id }, data: { sessionId: session, createdAt: at } });

    const before = (await api().get("/ads/campaigns?from=2026-10-01&to=2026-10-31")).body;
    expect(before.unlinkedTags).toContainEqual({ tag, sessions: 2, orders: 1 });

    const c = before.campaigns.find((x: { name: string }) => x.name === "Cap launch");
    expect((await api().patch(`/ads/campaigns/${c.id}`, { externalId: tag })).status).toBe(200);
    const after = (await api().get("/ads/campaigns?from=2026-10-01&to=2026-10-31")).body;
    expect(after.unlinkedTags.map((t: { tag: string }) => t.tag)).not.toContain(tag);
    expect(after.campaigns.find((x: { id: string }) => x.id === c.id).orders).toBe(1);
    await prisma.pageView.deleteMany({ where: { sessionId: { startsWith: session } } });
  });
});

describe("prepaid costs", () => {
  it("a year of hosting is paid now and moves into its expense month by month as each month ends", async () => {
    const r = await api().post("/prepaid", { name: "VPS hosting", expenseAccountId: acc["6400"], amount: 12000, serviceStart: "2026-09-15", serviceEnd: "2027-09-14", fromFinancialAccountId: bank, paidOn: "2026-09-15", payee: "Hostinger" }, `ppd-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const p = r.body.prepaid;
    const ended = p.schedule.filter((s: { date: string }) => s.date <= today);
    const used = Math.round(ended.reduce((t: number, s: { amount: number }) => t + s.amount, 0) * 100) / 100;
    expect(p).toMatchObject({ number: "PPD-000001", amount: 12000, paymentStatus: "POSTED", used, remaining: 12000 - used, status: "RUNNING" });
    expect(await balanceOf("asset.prepaid")).toBe(12000 - used);
    expect(await balanceOf(acc["6400"]!)).toBe(used);
  });

  it("ending the service early books what is left in the ending month", async () => {
    const id = (await api().get("/prepaid")).body.prepaid[0].id;
    const r = await api().patch(`/prepaid/${id}`, { serviceEnd: addDays(today, -1) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ remaining: 0, status: "FINISHED" });
    expect(await balanceOf("asset.prepaid")).toBe(0);
    expect(await balanceOf(acc["6400"]!)).toBe(12000);
  });
});

describe("packaging", () => {
  it("poly bags bought at their real cost leave stock with each parcel and land in packaging & fulfilment", async () => {
    const m = await createMaterial({ name: "Vitest Poly bag", stockUnit: "pcs", variants: [{ sku: `POLY-${RUN}`, spec: "10x14" }] }, OWNER, { canSeeCost: true });
    poly = m.variants[0]!.id;
    const supplierId = (await createSupplier({ legalName: "Vitest Packaging Co" } as never, OWNER)).id;
    const po = await createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId: poly, qtyOrdered: 100, unitPrice: 2 }] } as never, OWNER);
    await submitPurchaseOrder(po.id, OWNER);
    const approved = await approvePurchaseOrder(po.id, OWNER);
    const grn = await createGoodsReceipt({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: approved.lines[0]!.id, qtyAccepted: 100 }] } as never, OWNER);
    await postGoodsReceipt(grn.id, {}, OWNER);
    expect(await stock(poly)).toBe(100);

    const shirt = await createStockedProduct({ stocks: [10], basePrice: 900 });
    const before = await placeOrder([{ variantId: shirt.variants[0]!.id, quantity: 1 }]);
    for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] as const) await updateOrderStatus(before.id, { status: s }, admin);

    const rule = await api().post("/packaging/rules", { scope: "EVERY_PARCEL", materialVariantId: poly, quantity: 1, per: "PARCEL", notes: "vitest poly" });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    expect((await api().post("/packaging/rules", { scope: "EVERY_PARCEL", materialVariantId: shirt.variants[0]!.id, quantity: 1, notes: "vitest" })).body.details?.code).toBe("NOT_A_MATERIAL");

    const o = await placeOrder([{ variantId: shirt.variants[0]!.id, quantity: 2 }]);
    for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] as const) await updateOrderStatus(o.id, { status: s }, admin);
    const sync = await api().post("/owner-books/sync");
    expect(sync.status, JSON.stringify(sync.body)).toBe(200);
    expect(sync.body.packaging.movements).toBe(1); // the parcel shipped before the rule existed takes nothing
    expect(await stock(poly)).toBe(99);
    await api().post("/owner-books/sync");
    expect(await stock(poly)).toBe(99);
    await postPending();
    expect(await balanceOf("cogs.packaging")).toBe(2);

    const overview = (await api().get("/packaging")).body;
    expect(overview.materials.find((x: { id: string }) => x.id === poly)).toMatchObject({ stock: 99, usedLast30Days: 1 });
    expect(overview.rules[0]).toMatchObject({ scope: "EVERY_PARCEL", quantity: 1, isActive: true });
  });

  it("the books' checks agree: inventory = valuation, events posted, ledger balanced", async () => {
    await postPending();
    const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity", "events.unposted"] }, OWNER);
    expect(Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]))).toEqual({
      "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "ledger.integrity": "MATCHED", "events.unposted": "MATCHED",
    });
  });
});
