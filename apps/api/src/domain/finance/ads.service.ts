/**
 * Advertising in the books (docs/FINANCE_OWNER_BOOKS.md §5). An ad account is a money account (kind AD_PLATFORM): paying
 * Meta (a bKash / card top-up) is a Treasury transfer INTO it; each campaign-day's spend comes OUT of it into 6500
 * marketing & advertising. A day's spend is the ACTUAL figure (Meta's API, or typed in) when known, else the campaign's
 * budget for that day — labelled planned, and replaced by the actual when it arrives. The ad account's balance is
 * then what is prepaid with Meta (or, negative, owed to it).
 */
import type { AdBudgetType, Prisma } from "@prisma/client";
import { addDays, businessDate } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { applyFinanceFacts, booksStarted, postRecorded, type FinanceFact } from "./finance-facts";
import { OWNER_BOOKS_EVENT_TYPES } from "./owner-books-posting-rules";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";
import { getProviders } from "../../providers/registry";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * The budget of a campaign spread over its days up to `through` (minor units): a daily budget every day; a lifetime
 * budget evenly over start → end, the last day taking the rounding. Pure.
 */
export function plannedSpend(c: { startDate: string; endDate: string | null; budgetType: AdBudgetType | null; budget: number | null }, through: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!c.budgetType || !c.budget) return out;
  const last = c.endDate && c.endDate < through ? c.endDate : through;
  if (last < c.startDate) return out;
  if (c.budgetType === "DAILY") {
    for (let d = c.startDate; d <= last; d = addDays(d, 1)) out.set(d, c.budget);
    return out;
  }
  const days = daysBetween(c.startDate, c.endDate!) + 1;
  const per = Math.floor(c.budget / days);
  for (let i = 0, d = c.startDate; d <= last; i++, d = addDays(d, 1)) out.set(d, i === days - 1 ? c.budget - per * (days - 1) : per);
  return out;
}

// ── campaigns ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CampaignInput {
  financialAccountId: string;
  name: string;
  platform?: string;
  externalId?: string | null;
  objective?: string | null;
  startDate: string;
  endDate?: string | null;
  budgetType?: AdBudgetType | null;
  budget?: number | null;
  landingPath?: string | null;
  isActive?: boolean;
  notes?: string | null;
}

async function adAccount(businessId: string, id: string) {
  const fa = await prisma.financialAccount.findFirst({ where: { id, businessId } });
  if (!fa || fa.kind !== "AD_PLATFORM") throw financeError(400, "NOT_AN_AD_ACCOUNT", "Choose an ad account (Money accounts › add an account of kind Ad platform)");
  return fa;
}

function validate(input: Partial<CampaignInput>) {
  if (input.endDate && input.startDate && input.endDate < input.startDate) throw financeError(400, "CAMPAIGN_DATES", "The end is after the start");
  if ((input.budgetType ?? null) !== null && !(input.budget && input.budget > 0)) throw financeError(400, "CAMPAIGN_BUDGET", "Give the budget amount");
  if (input.budgetType === "LIFETIME" && !input.endDate) throw financeError(400, "CAMPAIGN_BUDGET", "A lifetime budget needs an end date to spread over");
}

export async function createCampaign(input: CampaignInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  validate(input);
  await adAccount(business.id, input.financialAccountId);
  const c = await financeTransaction(async (tx) => {
    await ensureOwnerBooksSetupInTx(tx, business, actor);
    const row = await tx.adCampaign.create({
      data: {
        businessId: business.id, financialAccountId: input.financialAccountId, platform: input.platform ?? "META", externalId: input.externalId ?? null, name: input.name.trim(),
        objective: input.objective ?? null, startDate: dateColumn(input.startDate), endDate: input.endDate ? dateColumn(input.endDate) : null, budgetType: input.budgetType ?? null,
        budget: input.budget ? toDecimal(toMinor(input.budget, cur), cur) : null, landingPath: input.landingPath ?? null, isActive: input.isActive ?? true, notes: input.notes ?? null, createdByAdminId: adminOf(actor),
      },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "ad_campaign.create", entityType: "AdCampaign", entityId: row.id, after: row });
    return row;
  });
  await syncCampaignSpend(c.id);
  return (await listCampaigns({})).campaigns.find((x) => x.id === c.id)!;
}

export async function updateCampaign(id: string, input: Partial<CampaignInput>, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const before = await prisma.adCampaign.findFirst({ where: { id, businessId: business.id } });
  if (!before) throw financeError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  const merged = {
    startDate: input.startDate ?? businessDateOf(before.startDate), endDate: input.endDate !== undefined ? input.endDate : before.endDate ? businessDateOf(before.endDate) : null,
    budgetType: input.budgetType !== undefined ? input.budgetType : before.budgetType, budget: input.budget !== undefined ? input.budget : before.budget ? toMajorNumber(toMinor(before.budget, cur), cur) : null,
  };
  validate(merged);
  await financeTransaction(async (tx) => {
    const after = await tx.adCampaign.update({
      where: { id },
      data: {
        name: input.name?.trim(), objective: input.objective, externalId: input.externalId, landingPath: input.landingPath, isActive: input.isActive, notes: input.notes,
        startDate: dateColumn(merged.startDate), endDate: merged.endDate ? dateColumn(merged.endDate) : null, budgetType: merged.budgetType, budget: merged.budget ? toDecimal(toMinor(merged.budget, cur), cur) : null,
      },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "ad_campaign.update", entityType: "AdCampaign", entityId: id, before, after });
  });
  await syncCampaignSpend(id);
  return (await listCampaigns({})).campaigns.find((x) => x.id === id)!;
}

/** Types in (or corrects) one day's actual spend. Zero is a real figure (the campaign was off that day). */
export async function recordDaySpend(campaignId: string, input: { date: string; amount: number }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const c = await prisma.adCampaign.findFirst({ where: { id: campaignId, businessId: business.id } });
  if (!c) throw financeError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  if (input.date > businessToday(business)) throw financeError(400, "SPEND_IN_FUTURE", "Spend is recorded for days that happened");
  await financeTransaction(async (tx) => {
    const amount = toDecimal(toMinor(input.amount, cur), cur);
    const row = await tx.adSpendDay.upsert({
      where: { campaignId_date: { campaignId, date: dateColumn(input.date) } },
      create: { campaignId, date: dateColumn(input.date), source: "MANUAL", amount },
      update: { source: "MANUAL", amount, originalAmount: null, originalCurrency: null, fxRate: null },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "ad_spend.record", entityType: "AdSpendDay", entityId: row.id, after: { campaignId, date: input.date, amount: input.amount } });
  });
  await syncCampaignSpend(campaignId);
}

// ── into the books ────────────────────────────────────────────────────────────────────────────────────────────────────

async function desiredForCampaign(campaignId: string, today: string): Promise<FinanceFact[]> {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const c = await prisma.adCampaign.findUniqueOrThrow({ where: { id: campaignId }, include: { adAccount: { select: { ledgerAccountId: true } }, spendDays: true } });
  const actual = new Map(c.spendDays.map((d) => [businessDateOf(d.date), toMinor(d.amount, cur)]));
  // A planned day is a day that has ended (yesterday and before); today's spend waits for its actual figure.
  const planned = c.isActive
    ? plannedSpend({ startDate: businessDateOf(c.startDate), endDate: c.endDate ? businessDateOf(c.endDate) : null, budgetType: c.budgetType, budget: c.budget ? toMinor(c.budget, cur) : null }, addDays(today, -1))
    : new Map<string, number>();
  const days = new Set([...actual.keys(), ...planned.keys()]);
  const facts: FinanceFact[] = [];
  for (const date of [...days].sort()) {
    const isActual = actual.has(date);
    const amount = isActual ? actual.get(date)! : planned.get(date)!;
    if (amount <= 0) continue;
    facts.push({
      semanticKey: `ads:${c.id}:${date}`, type: OWNER_BOOKS_EVENT_TYPES.adSpend, date, entityType: "AdCampaign", entityId: c.id,
      payload: { campaignId: c.id, campaignName: c.name, date, amount, basis: isActual ? "ACTUAL" : "PLANNED", adAccountLedgerId: c.adAccount.ledgerAccountId },
    });
  }
  return facts;
}

/** Brings one campaign's days into the books (records, then posts). Idempotent. */
export async function syncCampaignSpend(campaignId: string) {
  const ctx = await getFinanceContext();
  if (!(await booksStarted(ctx))) return { recorded: 0, posted: 0, failed: 0 };
  const facts = await desiredForCampaign(campaignId, businessToday(ctx.business));
  const ids = await financeTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-ads:${campaignId}`}))`;
    return applyFinanceFacts(tx, ctx, `ads:${campaignId}:`, facts);
  });
  return { recorded: ids.length, ...(await postRecorded(ids)) };
}

export async function syncAllAdSpend() {
  const { business } = await getFinanceContext();
  const campaigns = await prisma.adCampaign.findMany({ where: { businessId: business.id }, select: { id: true } });
  const total = { campaigns: campaigns.length, recorded: 0, posted: 0, failed: 0 };
  for (const c of campaigns) {
    const r = await syncCampaignSpend(c.id);
    total.recorded += r.recorded;
    total.posted += r.posted;
    total.failed += r.failed;
  }
  return total;
}

/**
 * Pulls actual daily spend from Meta for every connected ad account (Settings › Integrations › Meta ad spend), last
 * `days` days (Meta revises recent days, so they are read again). Each Meta ad account is the money account whose
 * reference is its id (act_…); campaigns are created on first sight. Spend in another currency is converted at the ad
 * account's rate (its details: fxRate = taka per unit).
 */
export async function importMetaSpend(input: { days?: number; since?: string }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const source = getProviders().adSpend;
  const cfg = { configured: source.configured(), accounts: source.adAccounts() };
  if (!cfg.configured) throw financeError(409, "META_ADS_NOT_CONNECTED", "Connect Meta ad spend in Settings › Integrations (access token and ad account id)");
  const today = businessToday(business);
  const since = input.since ?? addDays(today, -(input.days ?? 7));
  const accounts = await prisma.financialAccount.findMany({ where: { businessId: business.id, kind: "AD_PLATFORM", isActive: true } });
  const result = { accounts: [] as Array<{ adAccountId: string; financialAccount: string | null; days: number; campaigns: number; error: string | null }>, since, until: today };
  for (const act of cfg.accounts) {
    const fa = accounts.find((a) => (a.accountReference ?? "").replace(/^act_/, "") === act.replace(/^act_/, ""));
    if (!fa) {
      result.accounts.push({ adAccountId: act, financialAccount: null, days: 0, campaigns: 0, error: `Add an ad account in Money accounts with reference ${act}` });
      continue;
    }
    try {
      const rows = await source.campaignDays(act, since, today);
      const meta = (fa.metadata ?? {}) as Record<string, unknown>;
      const rate = Number(meta.fxRate);
      const touched = new Set<string>();
      await financeTransaction(async (tx) => {
        for (const r of rows) {
          const foreign = r.currency && r.currency !== cur;
          if (foreign && !(rate > 0)) throw financeError(409, "AD_ACCOUNT_RATE", `${fa.name} spends in ${r.currency} — add its rate (taka per ${r.currency}) as fxRate in the account's details`);
          const amount = toMinor(foreign ? Math.round(r.spend * rate * 100) / 100 : r.spend, cur);
          let campaign = await tx.adCampaign.findUnique({ where: { financialAccountId_externalId: { financialAccountId: fa.id, externalId: r.campaignId } } });
          if (!campaign) {
            campaign = await tx.adCampaign.create({ data: { businessId: business.id, financialAccountId: fa.id, platform: "META", externalId: r.campaignId, name: r.campaignName, startDate: dateColumn(r.date), createdByAdminId: adminOf(actor) } });
            await recordFinanceAudit(tx, { businessId: business.id, actor, action: "ad_campaign.import", entityType: "AdCampaign", entityId: campaign.id, after: campaign });
          } else if (businessDateOf(campaign.startDate) > r.date) {
            campaign = await tx.adCampaign.update({ where: { id: campaign.id }, data: { startDate: dateColumn(r.date) } });
          }
          touched.add(campaign.id);
          const data = {
            source: "META_API", amount: toDecimal(amount, cur), originalAmount: foreign ? toDecimal(toMinor(r.spend, cur), cur) : null, originalCurrency: foreign ? r.currency : null,
            fxRate: foreign ? rate : null, impressions: r.impressions, clicks: r.clicks, purchases: r.purchases,
          } satisfies Prisma.AdSpendDayUpdateInput;
          await tx.adSpendDay.upsert({ where: { campaignId_date: { campaignId: campaign.id, date: dateColumn(r.date) } }, create: { campaignId: campaign.id, date: dateColumn(r.date), ...data }, update: data });
        }
        await recordFinanceAudit(tx, { businessId: business.id, actor, action: "ad_spend.import", entityType: "FinancialAccount", entityId: fa.id, after: { adAccountId: act, since, until: today, rows: rows.length } });
      });
      for (const id of touched) await syncCampaignSpend(id);
      result.accounts.push({ adAccountId: act, financialAccount: fa.name, days: rows.length, campaigns: touched.size, error: null });
    } catch (err) {
      result.accounts.push({ adAccountId: act, financialAccount: fa.name, days: 0, campaigns: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Campaigns with what they cost and what they brought: spend (actual + planned) in the period, and the orders whose
 * shopping session came from the campaign (its utm_campaign is the campaign's id or name, or the session landed on the
 * campaign's page). Profit after ads = delivered sales − their cost of goods − courier − ad spend.
 */
export async function listCampaigns(q: { from?: string; to?: string }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const major = (v: number) => toMajorNumber(v, cur);
  const today = businessToday(business);
  const to = q.to ?? today;
  const from = q.from ?? `${to.slice(0, 7)}-01`;
  const campaigns = await prisma.adCampaign.findMany({ where: { businessId: business.id }, include: { adAccount: { select: { id: true, name: true } }, spendDays: true }, orderBy: [{ isActive: "desc" }, { startDate: "desc" }] });
  const out = [];
  for (const c of campaigns) {
    const actual = new Map(c.spendDays.map((d) => [businessDateOf(d.date), toMinor(d.amount, cur)]));
    const planned = c.isActive ? plannedSpend({ startDate: businessDateOf(c.startDate), endDate: c.endDate ? businessDateOf(c.endDate) : null, budgetType: c.budgetType, budget: c.budget ? toMinor(c.budget, cur) : null }, addDays(today, -1)) : new Map<string, number>();
    let actualMinor = 0;
    let plannedMinor = 0;
    for (const d of new Set([...actual.keys(), ...planned.keys()])) {
      if (d < from || d > to) continue;
      if (actual.has(d)) actualMinor += actual.get(d)!;
      else plannedMinor += planned.get(d)!;
    }
    const attributed = await attributedOrders(c, from, to, business.timezone);
    const spend = actualMinor + plannedMinor;
    const revenue = attributed.reduce((s, o) => s + toMinor(o.total, cur), 0);
    out.push({
      id: c.id, name: c.name, platform: c.platform, externalId: c.externalId, objective: c.objective, adAccount: c.adAccount, isActive: c.isActive,
      startDate: businessDateOf(c.startDate), endDate: c.endDate ? businessDateOf(c.endDate) : null, budgetType: c.budgetType, budget: c.budget ? major(toMinor(c.budget, cur)) : null,
      landingPath: c.landingPath, notes: c.notes,
      period: { from, to }, spend: major(spend), actualSpend: major(actualMinor), plannedSpend: major(plannedMinor),
      orders: attributed.length, delivered: attributed.filter((o) => o.status === "DELIVERED").length, revenue: major(revenue),
      costPerOrder: attributed.length ? major(Math.round(spend / attributed.length)) : null,
      roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null,
      lastActualDay: c.spendDays.length ? businessDateOf(c.spendDays.reduce((m, d) => (d.date > m ? d.date : m), c.spendDays[0]!.date)) : null,
    });
  }
  const totals = out.reduce((t, c) => ({ spend: t.spend + c.spend, orders: t.orders + c.orders, revenue: t.revenue + c.revenue }), { spend: 0, orders: 0, revenue: 0 });
  return { period: { from, to }, campaigns: out, totals: { spend: Math.round(totals.spend * 100) / 100, orders: totals.orders, revenue: Math.round(totals.revenue * 100) / 100 }, meta: { connected: getProviders().adSpend.configured() } };
}

async function attributedOrders(c: { externalId: string | null; name: string; landingPath: string | null }, from: string, to: string, tz: string) {
  const start = new Date(`${addDays(from, -1)}T00:00:00Z`);
  const end = new Date(`${addDays(to, 1)}T23:59:59Z`);
  const orders = await prisma.order.findMany({ where: { deletedAt: null, sessionId: { not: null }, createdAt: { gte: start, lte: end } }, select: { id: true, total: true, status: true, sessionId: true, createdAt: true } });
  const inRange = orders.filter((o) => {
    const d = businessDate(o.createdAt, tz);
    return d >= from && d <= to;
  });
  if (!inRange.length) return [];
  const keys = [c.externalId, c.name].filter((x): x is string => Boolean(x)).map((x) => x.toLowerCase());
  const views = await prisma.pageView.findMany({
    where: { sessionId: { in: inRange.map((o) => o.sessionId!) }, OR: [{ utmCampaign: { not: null } }, ...(c.landingPath ? [{ path: { startsWith: c.landingPath } }] : [])] },
    select: { sessionId: true, utmCampaign: true, path: true },
  });
  const sessions = new Set(views.filter((v) => (v.utmCampaign && keys.includes(v.utmCampaign.toLowerCase())) || (c.landingPath && v.path?.startsWith(c.landingPath))).map((v) => v.sessionId));
  return inRange.filter((o) => sessions.has(o.sessionId!));
}
