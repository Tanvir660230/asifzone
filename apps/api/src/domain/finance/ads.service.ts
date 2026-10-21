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

/**
 * Planned spend when the budget changed over time: each day uses the budget in force that day (the latest change dated on
 * or before it; days before the first change use the first). So raising a budget today never rewrites yesterday. Pure.
 */
export function plannedByVersions(c: { startDate: string; endDate: string | null }, versions: Array<{ from: string; budgetType: AdBudgetType | null; budget: number | null }>, through: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!versions.length) return out;
  const sorted = [...versions].sort((a, b) => a.from.localeCompare(b.from));
  const plans = sorted.map((v) => plannedSpend({ ...c, budgetType: v.budgetType, budget: v.budget }, through));
  const last = c.endDate && c.endDate < through ? c.endDate : through;
  for (let d = c.startDate; d <= last; d = addDays(d, 1)) {
    let i = 0;
    for (let k = 0; k < sorted.length; k++) if (sorted[k]!.from <= d) i = k;
    const v = plans[i]!.get(d);
    if (v !== undefined) out.set(d, v);
  }
  return out;
}

type BudgetedCampaign = { startDate: Date; endDate: Date | null; budgetType: AdBudgetType | null; budget: Prisma.Decimal | null; budgetChanges?: Array<{ effectiveDate: Date; budgetType: AdBudgetType | null; budget: Prisma.Decimal | null }> };

/** A campaign's planned spend through `through`, by its budget history (a campaign from before the history: its budget). */
function campaignPlanned(c: BudgetedCampaign, cur: string, through: string) {
  const range = { startDate: businessDateOf(c.startDate), endDate: c.endDate ? businessDateOf(c.endDate) : null };
  const versions = c.budgetChanges?.length
    ? c.budgetChanges.map((v) => ({ from: businessDateOf(v.effectiveDate), budgetType: v.budgetType, budget: v.budget ? toMinor(v.budget, cur) : null }))
    : [{ from: range.startDate, budgetType: c.budgetType, budget: c.budget ? toMinor(c.budget, cur) : null }];
  return plannedByVersions(range, versions, through);
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
  /** On an update that changes the budget: the first day the new budget applies (default today). */
  budgetFrom?: string | null;
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
    await tx.adBudgetChange.create({ data: { campaignId: row.id, effectiveDate: row.startDate, budgetType: row.budgetType, budget: row.budget, changedByAdminId: adminOf(actor) } });
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
  const budgetChanged = merged.budgetType !== before.budgetType || (merged.budget ?? null) !== (before.budget ? toMajorNumber(toMinor(before.budget, cur), cur) : null);
  const today = businessToday(business);
  let budgetFrom = input.budgetFrom ?? today;
  if (budgetFrom < merged.startDate) budgetFrom = merged.startDate;
  if (budgetChanged && input.budgetFrom && input.budgetFrom > today) throw financeError(400, "BUDGET_FROM", "A budget change starts today or on a day that has passed");
  await financeTransaction(async (tx) => {
    if (budgetChanged) {
      if (!(await tx.adBudgetChange.count({ where: { campaignId: id } }))) {
        // A campaign from before the history: its old budget held from its start.
        await tx.adBudgetChange.create({ data: { campaignId: id, effectiveDate: before.startDate, budgetType: before.budgetType, budget: before.budget } });
      }
      await tx.adBudgetChange.create({ data: { campaignId: id, effectiveDate: dateColumn(budgetFrom), budgetType: merged.budgetType, budget: merged.budget ? toDecimal(toMinor(merged.budget, cur), cur) : null, changedByAdminId: adminOf(actor) } });
    }
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
export interface DaySpendInput {
  date: string;
  /** The taka cost. Optional when the spend is in another currency — then original × rate. */
  amount?: number | null;
  /** The platform's figure in its own currency (e.g. USD 4.72) and the taka per unit it was paid at. */
  originalAmount?: number | null;
  currency?: string | null;
  fxRate?: number | null;
}

/**
 * The taka figure of a day's spend (minor units) and whether it is an estimate: typed in taka → exact; in another
 * currency → original × the rate given (exact) or the books' default rate (an ESTIMATE until the card statement's rate
 * is known). Pure.
 */
export function daySpendAmount(input: DaySpendInput, cur: string, defaultRate: number | null): { amount: number; original: number | null; currency: string | null; rate: number | null; estimated: boolean } {
  const foreign = input.currency && input.currency.toUpperCase() !== cur ? input.currency.toUpperCase() : null;
  if (!foreign) {
    if (input.amount === undefined || input.amount === null || !(input.amount >= 0)) throw financeError(400, "SPEND_AMOUNT", "Give the day's spend");
    return { amount: toMinor(input.amount, cur), original: null, currency: null, rate: null, estimated: false };
  }
  if (input.originalAmount === undefined || input.originalAmount === null || !(input.originalAmount >= 0)) throw financeError(400, "SPEND_AMOUNT", `Give the day's spend in ${foreign}`);
  const original = Math.round(input.originalAmount * 100);
  if (input.amount !== undefined && input.amount !== null) {
    if (!(input.amount >= 0)) throw financeError(400, "SPEND_AMOUNT", "The taka cost is zero or more");
    const amount = toMinor(input.amount, cur);
    return { amount, original, currency: foreign, rate: original ? Math.round((amount / original) * 1e6) / 1e6 : input.fxRate ?? defaultRate, estimated: false };
  }
  const rate = input.fxRate ?? defaultRate;
  if (!(rate && rate > 0)) throw financeError(400, "SPEND_RATE", `Give the taka per ${foreign} (or set a default rate in Finance Center › Settings)`);
  return { amount: Math.round(original * rate), original, currency: foreign, rate, estimated: !input.fxRate };
}

/** Types in (or corrects) one day's actual spend. Zero is a real figure (the campaign was off that day). */
export async function recordDaySpend(campaignId: string, input: DaySpendInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const c = await prisma.adCampaign.findFirst({ where: { id: campaignId, businessId: business.id } });
  if (!c) throw financeError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  if (input.date > businessToday(business)) throw financeError(400, "SPEND_IN_FUTURE", "Spend is recorded for days that happened");
  const biz = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { defaultUsdRate: true } });
  const s = daySpendAmount(input, cur, biz.defaultUsdRate ? Number(biz.defaultUsdRate) : null);
  await financeTransaction(async (tx) => {
    const row = await writeSpendDayInTx(tx, business.id, campaignId, input.date, "MANUAL", s, cur, actor);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "ad_spend.record", entityType: "AdSpendDay", entityId: row.id, after: { campaignId, date: input.date, amount: toMajorNumber(s.amount, cur), original: s.original === null ? null : s.original / 100, currency: s.currency, rate: s.rate, estimated: s.estimated } });
  });
  await syncCampaignSpend(campaignId);
}

async function writeSpendDayInTx(tx: Prisma.TransactionClient, businessId: string, campaignId: string, date: string, source: string, s: ReturnType<typeof daySpendAmount>, cur: string, actor: FinanceActor, extra: { impressions?: number | null; clicks?: number | null; purchases?: number | null } = {}) {
  const data = {
    source, amount: toDecimal(s.amount, cur), originalAmount: s.original === null ? null : toDecimal(s.original, cur), originalCurrency: s.currency, fxRate: s.rate,
    impressions: extra.impressions ?? null, clicks: extra.clicks ?? null, purchases: extra.purchases ?? null,
  };
  const row = await tx.adSpendDay.upsert({ where: { campaignId_date: { campaignId, date: dateColumn(date) } }, create: { campaignId, date: dateColumn(date), ...data }, update: data });
  // The rate is the books' default, not the card's: the taka figure is an estimate until it is checked.
  const key = { businessId_entityType_entityId: { businessId, entityType: "AdSpendDay", entityId: row.id } };
  if (s.estimated) {
    const v = { status: "ESTIMATED" as const, source: "Default USD rate", note: `${(s.original ?? 0) / 100} ${s.currency} at ${s.rate}`, setByAdminId: adminOf(actor) };
    await tx.financeVerification.upsert({ where: key, create: { businessId, entityType: "AdSpendDay", entityId: row.id, ...v }, update: v });
  } else {
    await tx.financeVerification.deleteMany({ where: { businessId, entityType: "AdSpendDay", entityId: row.id, status: "ESTIMATED", source: "Default USD rate" } });
  }
  return row;
}

// ── CSV import (Meta Ads Manager export, or any sheet with day / campaign / amount columns) ─────────────────────────────

/** Splits one CSV line (quotes, doubled quotes). Pure. */
export function csvCells(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cell); cell = ""; }
    else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

const pick = (headers: string[], ...names: RegExp[]) => {
  for (const n of names) {
    const i = headers.findIndex((h) => n.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

export interface AdCsvRow { line: number; date: string; campaignName: string; campaignId: string | null; spend: number; currency: string; impressions: number | null; clicks: number | null; purchases: number | null }

/**
 * Reads an ad-spend CSV: Meta's export ("Day" or "Reporting starts", "Campaign name", "Campaign ID", "Amount spent (USD)",
 * "Impressions", "Link clicks", "Purchases"/"Results") or a plain sheet (date, campaign, amount). The currency is the one
 * in the amount column's header, else `fallbackCurrency`. Rows that can't be read are returned as errors, never guessed;
 * a campaign-day twice in the file is an error (which one is right?). Pure.
 */
export function parseAdCsv(text: string, fallbackCurrency: string): { rows: AdCsvRow[]; errors: Array<{ line: number; error: string }> } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], errors: [{ line: 0, error: "The file is empty" }] };
  const headers = csvCells(lines[0]!).map((h) => h.toLowerCase());
  const iDate = pick(headers, /^day$/, /^date$/, /reporting starts/, /^day\b/, /date/);
  const iName = pick(headers, /^campaign name$/, /^campaign$/, /campaign name/);
  const iId = pick(headers, /^campaign id$/, /campaign id/);
  const iAmount = pick(headers, /^amount spent/, /^spend/, /^amount/, /cost/);
  const iImpr = pick(headers, /^impressions$/);
  const iClicks = pick(headers, /^link clicks$/, /^clicks/);
  const iPurch = pick(headers, /^purchases$/, /^results$/);
  const errors: Array<{ line: number; error: string }> = [];
  if (iDate < 0 || iName < 0 || iAmount < 0) return { rows: [], errors: [{ line: 1, error: "Need columns for the day, the campaign name and the amount spent" }] };
  const currency = (/\(([a-z]{3})\)/i.exec(headers[iAmount]!)?.[1] ?? fallbackCurrency).toUpperCase();
  const rows: AdCsvRow[] = [];
  const seen = new Map<string, number>();
  const num = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : Number(v.replace(/[,\s]/g, "")));
  for (let n = 1; n < lines.length; n++) {
    const c = csvCells(lines[n]!);
    const line = n + 1;
    const rawDate = c[iDate] ?? "";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(rawDate) ?? null;
    const dmy = !m ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(rawDate) : null;
    const date = m ? `${m[1]}-${m[2]}-${m[3]}` : dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}` : null;
    if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) { errors.push({ line, error: `Unreadable day "${rawDate}" (use YYYY-MM-DD or DD/MM/YYYY)` }); continue; }
    const name = c[iName] ?? "";
    if (!name) { errors.push({ line, error: "No campaign name" }); continue; }
    const spend = num(c[iAmount]);
    if (spend === null || !Number.isFinite(spend) || spend < 0) { errors.push({ line, error: `Unreadable amount "${c[iAmount] ?? ""}"` }); continue; }
    const campaignId = iId >= 0 && c[iId] ? c[iId]! : null;
    const key = `${campaignId ?? name.toLowerCase()}|${date}`;
    if (seen.has(key)) { errors.push({ line, error: `Same campaign and day as line ${seen.get(key)}` }); continue; }
    seen.set(key, line);
    const int = (i: number) => { const v = i >= 0 ? num(c[i]) : null; return v === null || !Number.isFinite(v) ? null : Math.round(v); };
    rows.push({ line, date, campaignName: name, campaignId, spend, currency, impressions: int(iImpr), clicks: int(iClicks), purchases: int(iPurch) });
  }
  return { rows, errors };
}

/**
 * Imports an ad-spend CSV into an ad account: previews first (`commit: false` — what would be created, replaced or is the
 * same), then writes every row in ONE transaction (all or nothing). Campaigns are matched by their platform id, else by
 * name; unknown ones are created. A day already recorded is replaced (the file is the newer figure); the same figure is
 * left alone. Foreign-currency spend uses `fxRate`, else the books' default rate (marked an estimate).
 */
export async function importAdCsv(input: { financialAccountId: string; csv: string; currency?: string | null; fxRate?: number | null; commit: boolean }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const fa = await adAccount(business.id, input.financialAccountId);
  const parsed = parseAdCsv(input.csv, (input.currency ?? "USD").toUpperCase());
  const today = businessToday(business);
  const biz = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { defaultUsdRate: true } });
  const defaultRate = biz.defaultUsdRate ? Number(biz.defaultUsdRate) : null;
  const errors = [...parsed.errors];
  const campaigns = await prisma.adCampaign.findMany({ where: { businessId: business.id, financialAccountId: fa.id }, include: { spendDays: { select: { date: true, amount: true } } } });
  const plan: Array<AdCsvRow & { campaign: string; campaignExists: boolean; amount: number; estimated: boolean; action: "NEW" | "REPLACE" | "SAME"; previous: number | null }> = [];
  for (const r of parsed.rows) {
    if (r.date > today) { errors.push({ line: r.line, error: "A day in the future" }); continue; }
    let s: ReturnType<typeof daySpendAmount>;
    try {
      s = daySpendAmount({ date: r.date, originalAmount: r.currency === cur ? null : r.spend, amount: r.currency === cur ? r.spend : null, currency: r.currency, fxRate: input.fxRate ?? null }, cur, defaultRate);
    } catch (err) {
      errors.push({ line: r.line, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const c = campaigns.find((x) => (r.campaignId && x.externalId === r.campaignId) || x.name.toLowerCase() === r.campaignName.toLowerCase()) ?? null;
    const prev = c?.spendDays.find((d) => businessDateOf(d.date) === r.date);
    const previous = prev ? toMinor(prev.amount, cur) : null;
    plan.push({ ...r, campaign: c?.name ?? r.campaignName, campaignExists: !!c, amount: s.amount, estimated: s.estimated, action: previous === null ? "NEW" : previous === s.amount ? "SAME" : "REPLACE", previous });
  }
  const summary = {
    rows: plan.length, errors, newCampaigns: [...new Set(plan.filter((p) => !p.campaignExists).map((p) => p.campaignName))],
    new: plan.filter((p) => p.action === "NEW").length, replace: plan.filter((p) => p.action === "REPLACE").length, same: plan.filter((p) => p.action === "SAME").length,
    total: toMajorNumber(plan.reduce((s, p) => s + p.amount, 0), cur), estimated: plan.filter((p) => p.estimated).length,
    lines: plan.map((p) => ({ line: p.line, date: p.date, campaign: p.campaign, spend: p.spend, currency: p.currency, amount: toMajorNumber(p.amount, cur), estimated: p.estimated, action: p.action, previous: p.previous === null ? null : toMajorNumber(p.previous, cur) })),
  };
  if (!input.commit) return { committed: false, ...summary };
  if (errors.length) throw financeError(400, "AD_CSV_ERRORS", `Fix the ${errors.length} line(s) that can't be read first — nothing was imported`, { errors });
  const touched = new Set<string>();
  await financeTransaction(async (tx) => {
    await ensureOwnerBooksSetupInTx(tx, business, actor);
    const byKey = new Map<string, string>();
    for (const p of plan) {
      const key = p.campaignId ?? p.campaignName.toLowerCase();
      let id = byKey.get(key) ?? campaigns.find((x) => (p.campaignId && x.externalId === p.campaignId) || x.name.toLowerCase() === p.campaignName.toLowerCase())?.id;
      if (!id) {
        const row = await tx.adCampaign.create({ data: { businessId: business.id, financialAccountId: fa.id, platform: fa.metadata && (fa.metadata as Record<string, unknown>).platform ? String((fa.metadata as Record<string, unknown>).platform) : "META", externalId: p.campaignId, name: p.campaignName, startDate: dateColumn(plan.filter((x) => (x.campaignId ?? x.campaignName.toLowerCase()) === key).map((x) => x.date).sort()[0]!), createdByAdminId: adminOf(actor) } });
        await tx.adBudgetChange.create({ data: { campaignId: row.id, effectiveDate: row.startDate, budgetType: null, budget: null } });
        await recordFinanceAudit(tx, { businessId: business.id, actor, action: "ad_campaign.import", entityType: "AdCampaign", entityId: row.id, after: row });
        id = row.id;
      }
      byKey.set(key, id);
      touched.add(id);
      if (p.action === "SAME") continue;
      const c = await tx.adCampaign.findUniqueOrThrow({ where: { id } });
      if (businessDateOf(c.startDate) > p.date) await tx.adCampaign.update({ where: { id }, data: { startDate: dateColumn(p.date) } });
      const s = { amount: p.amount, original: p.currency === cur ? null : Math.round(p.spend * 100), currency: p.currency === cur ? null : p.currency, rate: p.currency === cur ? null : input.fxRate ?? defaultRate, estimated: p.estimated };
      await writeSpendDayInTx(tx, business.id, id, p.date, "CSV", s, cur, actor, p);
    }
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "ad_spend.csv_import", entityType: "FinancialAccount", entityId: fa.id, after: { rows: plan.length, new: summary.new, replace: summary.replace, same: summary.same, total: summary.total } });
  });
  for (const id of touched) await syncCampaignSpend(id);
  return { committed: true, ...summary };
}

// ── into the books ────────────────────────────────────────────────────────────────────────────────────────────────────

async function desiredForCampaign(campaignId: string, today: string): Promise<FinanceFact[]> {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const c = await prisma.adCampaign.findUniqueOrThrow({ where: { id: campaignId }, include: { adAccount: { select: { ledgerAccountId: true } }, spendDays: true, budgetChanges: true } });
  const actual = new Map(c.spendDays.map((d) => [businessDateOf(d.date), toMinor(d.amount, cur)]));
  // A planned day is a day that has ended (yesterday and before); today's spend waits for its actual figure.
  const planned = c.isActive ? campaignPlanned(c, cur, addDays(today, -1)) : new Map<string, number>();
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
  const campaigns = await prisma.adCampaign.findMany({ where: { businessId: business.id }, include: { adAccount: { select: { id: true, name: true } }, spendDays: true, budgetChanges: { orderBy: { effectiveDate: "asc" } } }, orderBy: [{ isActive: "desc" }, { startDate: "desc" }] });
  const out = [];
  for (const c of campaigns) {
    const actual = new Map(c.spendDays.map((d) => [businessDateOf(d.date), toMinor(d.amount, cur)]));
    const planned = c.isActive ? campaignPlanned(c, cur, addDays(today, -1)) : new Map<string, number>();
    let actualMinor = 0;
    let plannedMinor = 0;
    for (const d of new Set([...actual.keys(), ...planned.keys()])) {
      if (d < from || d > to) continue;
      if (actual.has(d)) actualMinor += actual.get(d)!;
      else plannedMinor += planned.get(d)!;
    }
    const foreign: Record<string, number> = {};
    for (const d of c.spendDays) {
      const day = businessDateOf(d.date);
      if (day < from || day > to || !d.originalCurrency || !d.originalAmount) continue;
      foreign[d.originalCurrency] = (foreign[d.originalCurrency] ?? 0) + toMinor(d.originalAmount, cur);
    }
    const attributed = await attributedOrders(c, from, to, business.timezone);
    const spend = actualMinor + plannedMinor;
    const revenue = attributed.reduce((s, o) => s + toMinor(o.total, cur), 0);
    out.push({
      id: c.id, name: c.name, platform: c.platform, externalId: c.externalId, objective: c.objective, adAccount: c.adAccount, isActive: c.isActive,
      startDate: businessDateOf(c.startDate), endDate: c.endDate ? businessDateOf(c.endDate) : null, budgetType: c.budgetType, budget: c.budget ? major(toMinor(c.budget, cur)) : null,
      landingPath: c.landingPath, notes: c.notes,
      period: { from, to }, spend: major(spend), actualSpend: major(actualMinor), plannedSpend: major(plannedMinor),
      foreignSpend: Object.entries(foreign).map(([currency, amount]) => ({ currency, amount: amount / 100 })),
      budgetHistory: c.budgetChanges.map((b) => ({ from: businessDateOf(b.effectiveDate), budgetType: b.budgetType, budget: b.budget ? major(toMinor(b.budget, cur)) : null })),
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
