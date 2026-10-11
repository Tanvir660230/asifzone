/**
 * Fixed assets and depreciation (ERP programme E9, docs/FINANCE_FIXED_ASSETS.md).
 *
 * Registering an asset records what the books already hold: its cost is on its asset account (a supplier bill line, a
 * money movement or the opening balances put it there); optionally a reclassification journal moves it there from where
 * it was first booked. The register equals the ledger (check fixed_assets.register).
 *
 * Depreciation is monthly. Useful life = the months left from the first depreciated month:
 *   STRAIGHT_LINE      (cost − residual − opening depreciation) ÷ life a month, half-even; the last month takes the rest
 *   DECLINING_BALANCE  book value × yearly rate ÷ 12 a month; the last month of life takes the rest down to the residual
 * Never below the residual value. A run covers one month for every asset in use — ONE journal: Dr expense.depreciation /
 * Cr asset.accumulated_depreciation (each asset as party) — posted once; runs go month after month; only the latest run
 * is reversed (and not after one of its assets was disposed).
 *
 * Disposal (with or without proceeds into cash / bank / wallet): Dr accumulated depreciation, Dr the money account, Cr the
 * asset account at cost, the difference to the book value as gain (income.asset_disposal_gain) or loss
 * (expense.asset_disposal_loss). Depreciation must be run up to the month before. Final.
 */
import type { DepreciationMethod, Prisma } from "@prisma/client";
import { FIXED_ASSET_MAPPING_KEYS } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "./finance-audit";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { nextFinanceSequence } from "./suppliers.service";
import { chartState, provisionTemplateAccountsInTx } from "./chart-provisioning";
import { resolveMappedAccount } from "./chart.service";
import { requestMovementInTx } from "./treasury.service";
import { postJournalInTx, reverseJournalInTx, type JournalLineSpec } from "./journal.service";
import { divRound } from "./costing.service";
import { randomUUID } from "node:crypto";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
export const assetNumber = (n: number) => `FA-${String(n).padStart(4, "0")}`;
const PAYING_KINDS = new Set(["CASH", "BANK", "MOBILE_WALLET"]);

const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
const monthKey = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const lastDay = (key: string) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export interface AssetBasis {
  cost: number;
  residual: number;
  openingAccumulated: number;
  lifeMonths: number;
  method: DepreciationMethod;
  /** Percent a year (DECLINING_BALANCE). */
  ratePct: number | null;
  start: string;
}

/** One month's charge (minor units) given what is already accumulated. Pure; exact, half-even. */
export function monthlyCharge(a: AssetBasis, accumulated: number, periodKey: string): number {
  const n = monthIndex(periodKey) - monthIndex(a.start) + 1; // 1 = the first depreciated month
  if (n < 1) return 0;
  const remaining = a.cost - a.residual - accumulated;
  if (remaining <= 0) return 0;
  if (n >= a.lifeMonths) return remaining; // the last month of life (or later, catching up) takes the rest
  let charge: number;
  if (a.method === "STRAIGHT_LINE") {
    charge = Number(divRound(BigInt(a.cost - a.residual - a.openingAccumulated), BigInt(a.lifeMonths)));
  } else {
    const rate = BigInt(Math.round((a.ratePct ?? 0) * 10_000)); // percent × 10⁴
    charge = Number(divRound(BigInt(a.cost - accumulated) * rate, 100n * 10_000n * 12n));
  }
  return Math.max(0, Math.min(charge, remaining));
}

/** Projected charges month by month until fully depreciated (or `limit` months). */
export function projection(a: AssetBasis, accumulated: number, fromKey: string, limit = 600) {
  const out: Array<{ periodKey: string; charge: number; bookValue: number }> = [];
  let acc = accumulated;
  for (let i = monthIndex(fromKey); out.length < limit; i++) {
    const key = monthKey(i);
    const c = monthlyCharge(a, acc, key);
    if (c === 0 && monthIndex(key) >= monthIndex(a.start)) break;
    acc += c;
    if (c) out.push({ periodKey: key, charge: c, bookValue: a.cost - acc });
  }
  return out;
}

async function ensureSetup(tx: AppTransactionClient, business: Pick<FinanceBusinessInfo, "id">, actor: FinanceActor) {
  const audits: FinanceAuditInput[] = [];
  const { byCode, mapped } = await chartState(tx, business.id);
  await provisionTemplateAccountsInTx(tx, business, { needed: new Set<string>(FIXED_ASSET_MAPPING_KEYS), byCode, mapped, audits, actor, reason: "Fixed assets set-up" });
  if (audits.length) await recordFinanceAudit(tx, audits);
  const missing = FIXED_ASSET_MAPPING_KEYS.filter((k) => !mapped.has(k));
  if (missing.length) throw financeError(409, "FIXED_ASSET_MAPPINGS", `Map ${missing.join(", ")} in the chart first`);
}

const INCLUDE = {
  assetAccount: { select: { id: true, code: true, name: true } },
  disposalFinancialAccount: { select: { id: true, name: true } },
  depreciationLines: { where: { run: { status: "POSTED" } }, select: { amount: true, run: { select: { periodKey: true } } } },
} satisfies Prisma.FixedAssetInclude;
type AssetRow = Prisma.FixedAssetGetPayload<{ include: typeof INCLUDE }>;

function basisOf(a: AssetRow, cur: string): AssetBasis {
  return {
    cost: toMinor(a.cost, cur), residual: toMinor(a.residualValue, cur), openingAccumulated: toMinor(a.openingAccumulatedDepreciation, cur), lifeMonths: a.usefulLifeMonths,
    method: a.method, ratePct: a.decliningRatePct === null ? null : Number(a.decliningRatePct), start: a.depreciationStart,
  };
}
const accumulatedOf = (a: AssetRow, cur: string) => toMinor(a.openingAccumulatedDepreciation, cur) + a.depreciationLines.reduce((s, l) => s + toMinor(l.amount, cur), 0);

export function assetDto(a: AssetRow, cur: string, today: string) {
  const b = basisOf(a, cur);
  const acc = accumulatedOf(a, cur);
  const lastRun = a.depreciationLines.map((l) => l.run.periodKey).sort().at(-1) ?? null;
  const next = a.status === "IN_USE" ? projection(b, acc, lastRun ? monthKey(monthIndex(lastRun) + 1) : a.depreciationStart, 600) : [];
  const m = (n: number) => toMajorNumber(n, cur);
  return {
    id: a.id, number: assetNumber(a.number), name: a.name, category: a.category, assetAccount: a.assetAccount, acquisitionDate: businessDateOf(a.acquisitionDate),
    cost: m(b.cost), residualValue: m(b.residual), usefulLifeMonths: a.usefulLifeMonths, method: a.method, decliningRatePct: b.ratePct, depreciationStart: a.depreciationStart,
    openingAccumulatedDepreciation: m(b.openingAccumulated), accumulatedDepreciation: m(acc), bookValue: m(a.status === "DISPOSED" ? 0 : b.cost - acc),
    lastDepreciatedMonth: lastRun, nextCharge: next[0] ? { periodKey: next[0].periodKey, amount: m(next[0].charge) } : null, monthsLeft: next.length,
    fullyDepreciatedBy: next.at(-1)?.periodKey ?? null,
    location: a.location, custodian: a.custodian, serialNumber: a.serialNumber, notes: a.notes, sourceType: a.sourceType, sourceRef: a.sourceRef,
    status: a.status, disposedAt: a.disposedAt ? businessDateOf(a.disposedAt) : null, disposalProceeds: a.disposalProceeds === null ? null : m(toMinor(a.disposalProceeds, cur)),
    disposalFinancialAccount: a.disposalFinancialAccount, disposalGainLoss: a.disposalGainLoss === null ? null : m(toMinor(a.disposalGainLoss, cur)), disposalReason: a.disposalReason,
    asOf: today,
  };
}

export interface AssetInput {
  name: string;
  category?: string | null;
  assetAccountId: string;
  acquisitionDate: string;
  cost: number;
  residualValue?: number;
  usefulLifeMonths: number;
  method?: DepreciationMethod;
  decliningRatePct?: number | null;
  depreciationStart?: string;
  openingAccumulatedDepreciation?: number;
  location?: string | null;
  custodian?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
  sourceType?: "SUPPLIER_INVOICE" | "MONEY_MOVEMENT" | "OPENING_BALANCE" | "OTHER";
  sourceRef?: string | null;
  /** Move the cost onto the asset account from where it was first booked (e.g. an expense account) — one journal. */
  reclassifyFromAccountId?: string | null;
}

async function assetAccount(tx: AppTransactionClient, businessId: string, id: string) {
  const a = await tx.ledgerAccount.findFirst({ where: { id, businessId } });
  if (!a) throw financeError(404, "ACCOUNT_NOT_FOUND", "Asset account not found");
  if (a.type !== "ASSET" || !a.isPostable || !a.isActive || a.normalBalance !== "DEBIT") throw financeError(400, "ACCOUNT_TYPE", `${a.code} ${a.name} isn't an asset account that takes postings`);
  if (await tx.financialAccount.count({ where: { ledgerAccountId: a.id } })) throw financeError(400, "ACCOUNT_TYPE", `${a.code} ${a.name} is a money account`);
  const reserved = await tx.accountMapping.count({ where: { businessId, accountId: a.id, key: { in: ["asset.inventory", "asset.wip", "asset.receivable_trade", "asset.vat_input"] } } });
  if (reserved) throw financeError(400, "ACCOUNT_TYPE", `${a.code} ${a.name} holds inventory, receivables or tax — not fixed assets`);
  return a;
}

export async function createAsset(input: AssetInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    await ensureSetup(tx, business, actor);
    const account = await assetAccount(tx, business.id, input.assetAccountId);
    const method = input.method ?? "STRAIGHT_LINE";
    if (method === "DECLINING_BALANCE" && !(input.decliningRatePct && input.decliningRatePct > 0)) throw financeError(400, "DECLINING_RATE", "Give the yearly rate for declining balance");
    const cost = toMinor(input.cost, cur);
    const residual = toMinor(input.residualValue ?? 0, cur);
    const opening = toMinor(input.openingAccumulatedDepreciation ?? 0, cur);
    if (residual >= cost) throw financeError(400, "RESIDUAL", "The residual value is less than the cost");
    if (opening > cost - residual) throw financeError(400, "OPENING_DEPRECIATION", "Opening depreciation can't exceed cost − residual");
    const start = input.depreciationStart ?? input.acquisitionDate.slice(0, 7);
    if (start < input.acquisitionDate.slice(0, 7)) throw financeError(400, "DEPRECIATION_START", "Depreciation starts in or after the acquisition month");
    const latest = await tx.depreciationRun.findFirst({ where: { businessId: business.id, status: "POSTED" }, orderBy: { periodKey: "desc" } });
    if (latest && start <= latest.periodKey) throw financeError(409, "DEPRECIATION_START", `Depreciation already ran for ${latest.periodKey} — start this asset in ${monthKey(monthIndex(latest.periodKey) + 1)} or later (enter what it carried before as opening depreciation)`);
    const row = await tx.fixedAsset.create({
      data: {
        businessId: business.id, number: await nextFinanceSequence(tx, business.id, "fixed_asset"), name: input.name.trim(), category: input.category ?? null, assetAccountId: account.id,
        acquisitionDate: dateColumn(input.acquisitionDate), cost: toDecimal(cost, cur), residualValue: toDecimal(residual, cur), usefulLifeMonths: input.usefulLifeMonths, method,
        decliningRatePct: method === "DECLINING_BALANCE" ? input.decliningRatePct!.toFixed(4) : null, depreciationStart: start, openingAccumulatedDepreciation: toDecimal(opening, cur),
        location: input.location ?? null, custodian: input.custodian ?? null, serialNumber: input.serialNumber ?? null, notes: input.notes ?? null,
        sourceType: input.reclassifyFromAccountId ? "OTHER" : input.sourceType ?? "OTHER", sourceRef: input.sourceRef ?? null, createdByAdminId: adminOf(actor),
      },
      include: INCLUDE,
    });
    if (input.reclassifyFromAccountId) {
      const from = await tx.ledgerAccount.findFirst({ where: { id: input.reclassifyFromAccountId, businessId: business.id } });
      if (!from || !from.isPostable) throw financeError(400, "ACCOUNT_NOT_POSTABLE", "The account to move the cost from can't take postings");
      await postJournalInTx(tx, business, {
        entryDate: input.acquisitionDate, description: `Capitalised ${assetNumber(row.number)} ${row.name}`, kind: "ADJUSTMENT", sourceType: "FixedAsset", sourceId: row.id,
        idempotencyKey: `fixed-asset:capitalise:${row.id}`,
        lines: [
          { accountId: account.id, debit: cost, credit: 0, memo: `${assetNumber(row.number)} at cost`, partyType: "FixedAsset", partyId: row.id },
          { accountId: from.id, debit: 0, credit: cost, memo: `Moved to ${account.code} ${account.name}` },
        ],
      }, actor);
    }
    const today = businessToday(business);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "fixed_asset.create", entityType: "FixedAsset", entityId: row.id, after: assetDto(row, cur, today) });
    return assetDto(row, cur, today);
  });
}

export async function updateAsset(id: string, input: Partial<Pick<AssetInput, "name" | "category" | "location" | "custodian" | "serialNumber" | "notes" | "residualValue" | "usefulLifeMonths">>, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const before = await tx.fixedAsset.findFirst({ where: { id, businessId: business.id }, include: INCLUDE });
    if (!before) throw financeError(404, "FIXED_ASSET_NOT_FOUND", "Asset not found");
    if (before.status === "DISPOSED") throw financeError(409, "ASSET_DISPOSED", "A disposed asset is final");
    const after = await tx.fixedAsset.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}), ...(input.custodian !== undefined ? { custodian: input.custodian } : {}),
        ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.residualValue !== undefined ? { residualValue: toDecimal(toMinor(input.residualValue, cur), cur) } : {}),
        ...(input.usefulLifeMonths !== undefined ? { usefulLifeMonths: input.usefulLifeMonths } : {}),
      },
      include: INCLUDE,
    }).catch((err: unknown) => {
      if (err instanceof Error && /fixed once it has been depreciated/.test(err.message)) throw financeError(409, "ASSET_BASIS_FIXED", "Its cost and depreciation basis are fixed once it has been depreciated");
      throw err;
    });
    const today = businessToday(business);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "fixed_asset.update", entityType: "FixedAsset", entityId: id, before: assetDto(before, cur, today), after: input });
    return assetDto(after, cur, today);
  });
}

/** Depreciates every asset in use for one month: one journal, once. Months run in order. */
export async function runDepreciation(periodKey: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw financeError(400, "PERIOD_KEY", "A month is YYYY-MM");
  const today = businessToday(business);
  if (periodKey > today.slice(0, 7)) throw financeError(409, "FUTURE_MONTH", "Depreciation runs for a month that has started");
  return financeTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-depreciation:${business.id}`}))`;
    await ensureSetup(tx, business, actor);
    const existing = await tx.depreciationRun.findFirst({ where: { businessId: business.id, periodKey, status: "POSTED" }, include: { lines: true } });
    if (existing) return { run: runDto(existing, cur), replayed: true };
    const latest = await tx.depreciationRun.findFirst({ where: { businessId: business.id, status: "POSTED" }, orderBy: { periodKey: "desc" } });
    if (latest && periodKey < latest.periodKey) throw financeError(409, "MONTH_ALREADY_COVERED", `Depreciation already ran through ${latest.periodKey}`);
    if (latest && monthIndex(periodKey) !== monthIndex(latest.periodKey) + 1) throw financeError(409, "RUN_IN_ORDER", `Run ${monthKey(monthIndex(latest.periodKey) + 1)} first — months run in order`);
    const assets = await tx.fixedAsset.findMany({ where: { businessId: business.id, status: "IN_USE", depreciationStart: { lte: periodKey } }, include: INCLUDE, orderBy: { number: "asc" } });
    const charges = assets.map((a) => ({ a, amount: monthlyCharge(basisOf(a, cur), accumulatedOf(a, cur), periodKey) })).filter((x) => x.amount > 0);
    const total = charges.reduce((s, x) => s + x.amount, 0);
    const runId = randomUUID();
    let journalEntryId: string | null = null;
    if (charges.length) {
      const expense = await resolveMappedAccount(tx, business.id, "expense.depreciation");
      const accumulated = await resolveMappedAccount(tx, business.id, "asset.accumulated_depreciation");
      const lines: JournalLineSpec[] = [
        { accountId: expense.id, debit: total, credit: 0, memo: `Depreciation ${periodKey}` },
        ...charges.map((x) => ({ accountId: accumulated.id, debit: 0, credit: x.amount, memo: `${assetNumber(x.a.number)} ${x.a.name}`, partyType: "FixedAsset", partyId: x.a.id })),
      ];
      const { entry } = await postJournalInTx(tx, business, {
        entryDate: lastDay(periodKey) > today ? today : lastDay(periodKey), description: `Depreciation ${periodKey}`, kind: "ADJUSTMENT", sourceType: "DepreciationRun", sourceId: runId,
        idempotencyKey: `depreciation:${runId}`, lines,
      }, actor);
      journalEntryId = entry.id;
    }
    const run = await tx.depreciationRun.create({ data: { id: runId, businessId: business.id, periodKey, total: toDecimal(total, cur), journalEntryId, createdByAdminId: adminOf(actor) } });
    if (charges.length) await tx.depreciationLine.createMany({ data: charges.map((x) => ({ runId: run.id, assetId: x.a.id, amount: toDecimal(x.amount, cur) })) });
    const after = await tx.depreciationRun.findUniqueOrThrow({ where: { id: run.id }, include: { lines: true } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "depreciation.run", entityType: "DepreciationRun", entityId: run.id, after: { periodKey, totalMinor: total, assets: charges.length } });
    return { run: runDto(after, cur), replayed: false };
  });
}

function runDto(r: Prisma.DepreciationRunGetPayload<{ include: { lines: true } }>, cur: string) {
  return { id: r.id, periodKey: r.periodKey, status: r.status, total: toMajorNumber(toMinor(r.total, cur), cur), assets: r.lines.length, journalEntryId: r.journalEntryId, createdAt: r.createdAt, reversedAt: r.reversedAt, reversalReason: r.reversalReason };
}

/** Reverses the latest run (its journal reversed) — refused once one of its assets has been disposed. */
export async function reverseLatestRun(reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-depreciation:${business.id}`}))`;
    const latest = await tx.depreciationRun.findFirst({ where: { businessId: business.id, status: "POSTED" }, orderBy: { periodKey: "desc" }, include: { lines: { include: { asset: { select: { status: true, number: true } } } } } });
    if (!latest) throw financeError(404, "NO_DEPRECIATION_RUN", "No depreciation run to reverse");
    const disposed = latest.lines.filter((l) => l.asset.status === "DISPOSED");
    if (disposed.length) throw financeError(409, "ASSET_DISPOSED", `${disposed.map((l) => assetNumber(l.asset.number)).join(", ")} was disposed after this run`);
    if (latest.journalEntryId) await reverseJournalInTx(tx, business, latest.journalEntryId, reason, businessToday(business) < lastDay(latest.periodKey) ? businessToday(business) : lastDay(latest.periodKey), actor);
    await tx.depreciationRun.update({ where: { id: latest.id }, data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "depreciation.reverse", entityType: "DepreciationRun", entityId: latest.id, before: { status: "POSTED" }, after: { status: "REVERSED" }, reason });
    const after = await tx.depreciationRun.findUniqueOrThrow({ where: { id: latest.id }, include: { lines: true } });
    return runDto(after, cur);
  });
}

/** Disposes an asset (sold, scrapped, lost): cost and accumulated depreciation cleared, proceeds in, gain or loss booked. */
export async function disposeAsset(id: string, input: { disposalDate: string; proceeds?: number; financialAccountId?: string | null; reason: string }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-depreciation:${business.id}`}))`;
    await ensureSetup(tx, business, actor);
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "FixedAsset" WHERE id = ${id} AND "businessId" = ${business.id} FOR UPDATE`;
    if (!locked) throw financeError(404, "FIXED_ASSET_NOT_FOUND", "Asset not found");
    const a = await tx.fixedAsset.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    if (a.status === "DISPOSED") return assetDto(a, cur, businessToday(business));
    if (input.disposalDate < businessDateOf(a.acquisitionDate)) throw financeError(400, "DISPOSAL_DATE", "The disposal is on or after the acquisition date");
    if (input.disposalDate > businessToday(business)) throw financeError(400, "DISPOSAL_DATE", "A disposal records something that has happened");
    const month = input.disposalDate.slice(0, 7);
    const prev = monthKey(monthIndex(month) - 1);
    const latest = await tx.depreciationRun.findFirst({ where: { businessId: business.id, status: "POSTED" }, orderBy: { periodKey: "desc" } });
    if (a.depreciationStart <= prev && (!latest || latest.periodKey < prev)) throw financeError(409, "RUN_DEPRECIATION_FIRST", `Run depreciation through ${prev} before disposing`);
    if (a.depreciationLines.some((l) => l.run.periodKey >= month)) throw financeError(409, "DEPRECIATED_AFTER_DISPOSAL", `It was depreciated for ${month} or later — reverse those runs first`);
    const proceeds = toMinor(input.proceeds ?? 0, cur);
    let money = null;
    if (proceeds > 0) {
      if (!input.financialAccountId) throw financeError(400, "PROCEEDS_ACCOUNT", "Say which account the proceeds went into");
      money = await tx.financialAccount.findFirst({ where: { id: input.financialAccountId, businessId: business.id } });
      if (!money || !PAYING_KINDS.has(money.kind)) throw financeError(400, "PROCEEDS_ACCOUNT", "Proceeds go into cash, a bank or a wallet");
    }
    const cost = toMinor(a.cost, cur);
    const acc = accumulatedOf(a, cur);
    const gain = proceeds - (cost - acc); // > 0 gain, < 0 loss
    const accumulated = await resolveMappedAccount(tx, business.id, "asset.accumulated_depreciation");
    const party = { partyType: "FixedAsset", partyId: a.id };
    const lines: JournalLineSpec[] = [
      { accountId: a.assetAccountId, debit: 0, credit: cost, memo: `${assetNumber(a.number)} disposed at cost`, ...party },
      ...(acc ? [{ accountId: accumulated.id, debit: acc, credit: 0, memo: `${assetNumber(a.number)} accumulated depreciation cleared`, ...party }] : []),
      // the proceeds are owed by the buyer until the Treasury deposit below brings them in (money never skips Treasury)
      ...(proceeds ? [{ accountId: (await resolveMappedAccount(tx, business.id, "asset.disposal_receivable")).id, debit: proceeds, credit: 0, memo: `Proceeds due — ${assetNumber(a.number)} ${a.name}`, ...party }] : []),
      ...(gain > 0 ? [{ accountId: (await resolveMappedAccount(tx, business.id, "income.asset_disposal_gain")).id, debit: 0, credit: gain, memo: `Gain on ${assetNumber(a.number)}` }] : []),
      ...(gain < 0 ? [{ accountId: (await resolveMappedAccount(tx, business.id, "expense.asset_disposal_loss")).id, debit: -gain, credit: 0, memo: `Loss on ${assetNumber(a.number)}` }] : []),
    ];
    const { entry } = await postJournalInTx(tx, business, {
      entryDate: input.disposalDate, description: `Disposal of ${assetNumber(a.number)} ${a.name}`, kind: "ADJUSTMENT", sourceType: "FixedAsset", sourceId: a.id,
      idempotencyKey: `fixed-asset:dispose:${a.id}`, reason: input.reason, lines,
    }, actor);
    const deposit = proceeds ? (await requestMovementInTx(tx, business, {
      kind: "DEPOSIT", movementDate: input.disposalDate, amount: toMajorNumber(proceeds, cur), toFinancialAccountId: money!.id,
      counterAccountId: (await resolveMappedAccount(tx, business.id, "asset.disposal_receivable")).id, description: `Sale of ${assetNumber(a.number)} ${a.name}`.slice(0, 300),
    }, actor, `fixed-asset:proceeds:${a.id}`)).movement : null;
    const after = await tx.fixedAsset.update({
      where: { id },
      data: { status: "DISPOSED", disposedAt: dateColumn(input.disposalDate), disposalProceeds: toDecimal(proceeds, cur), disposalFinancialAccountId: money?.id ?? null, disposalGainLoss: toDecimal(gain, cur), disposalReason: input.reason, disposalJournalId: entry.id, disposalMovementId: deposit?.id ?? null },
      include: INCLUDE,
    });
    const today = businessToday(business);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "fixed_asset.dispose", entityType: "FixedAsset", entityId: id, before: { status: "IN_USE" }, after: { status: "DISPOSED", proceedsMinor: proceeds, gainMinor: gain }, reason: input.reason });
    return assetDto(after, cur, today);
  });
}

/** The register: every asset with cost, accumulated depreciation and book value; totals by asset account; runs. */
export async function assetRegister(q: { includeDisposed?: boolean } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const rows = await prisma.fixedAsset.findMany({ where: { businessId: business.id, ...(q.includeDisposed ? {} : { status: "IN_USE" }) }, include: INCLUDE, orderBy: { number: "asc" } });
  const assets = rows.map((a) => assetDto(a, cur, today));
  const inUse = rows.filter((a) => a.status === "IN_USE");
  const cost = inUse.reduce((s, a) => s + toMinor(a.cost, cur), 0);
  const acc = inUse.reduce((s, a) => s + accumulatedOf(a, cur), 0);
  const runs = await prisma.depreciationRun.findMany({ where: { businessId: business.id }, include: { lines: true }, orderBy: { createdAt: "desc" }, take: 24 });
  const latest = runs.find((r) => r.status === "POSTED");
  const nextMonth = latest ? monthKey(monthIndex(latest.periodKey) + 1) : (inUse.map((a) => a.depreciationStart).sort()[0] ?? today.slice(0, 7));
  return {
    asOf: today, assets,
    totals: { cost: toMajorNumber(cost, cur), accumulatedDepreciation: toMajorNumber(acc, cur), bookValue: toMajorNumber(cost - acc, cur), assets: inUse.length },
    nextRun: nextMonth <= today.slice(0, 7) ? nextMonth : null,
    nextRunCharge: toMajorNumber(inUse.reduce((s, a) => s + monthlyCharge(basisOf(a, cur), accumulatedOf(a, cur), nextMonth), 0), cur),
    runs: runs.map((r) => runDto(r, cur)),
  };
}
