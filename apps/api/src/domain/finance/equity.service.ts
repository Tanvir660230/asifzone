/**
 * Partners & equity — foundation (ERP programme E11, docs/FINANCE_EQUITY.md).
 *
 * B-2 (the signed partner agreements) blocks everything that depends on them: profit distribution, capital rules, sweat
 * equity. What does not wait:
 *   register   each partner with a capital account (31xx) and a current account (32xx) — sensitive equity sub-accounts
 *              under 3000 Equity, created with the partner and never deleted
 *   balances   read straight from the ledger: what a partner put in (capital) and their current account (drawings and,
 *              once agreed, profit shares) — money in / out is an ordinary Treasury deposit / withdrawal against them
 *   summary    the balance sheet's own equity section, so the two always agree
 * The agreed share is a note, UNCONFIRMED until the agreement; nothing is computed from it.
 */
import type { Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { nextFinanceSequence } from "./suppliers.service";
import { balanceSheet } from "./statements.service";
import { resolveMappedAccount } from "./chart.service";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
/** A partner's role in the business (not an admin role): the owner keeps what is left and never shares. */
export const isBusinessOwner = (role: string) => role === BUSINESS_OWNER;
const BUSINESS_OWNER = "OWNER";
export const partnerNumber = (n: number) => `PT-${String(n).padStart(2, "0")}`;
const accountNames = (name: string) => ({ capital: `Partner capital — ${name}`, current: `Partner current — ${name}` });

export interface PartnerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  joinedOn: string;
  leftOn?: string | null;
  agreedSharePct?: number | null;
  agreementReference?: string | null;
  notes?: string | null;
  role?: "OWNER" | "WORKING" | "INVESTOR";
  profitSharePct?: number | null;
  shareFrom?: string | null;
  lossRule?: "ZERO_IN_LOSS_MONTHS" | "CARRY_LOSSES";
  shareConfirmedNote?: string | null;
}

/** The owner never shares profit (they keep what is left); a confirmed share needs a start and is stamped when set. */
function shareFields(input: Partial<PartnerInput>, role: string, joinedOn: string, before?: { profitSharePct: unknown; shareConfirmedAt: Date | null }) {
  if (input.profitSharePct === undefined && input.shareFrom === undefined && input.lossRule === undefined && input.shareConfirmedNote === undefined) return {};
  if (isBusinessOwner(role) && input.profitSharePct) throw financeError(400, "OWNER_NO_SHARE", "The owner keeps what is left — a profit share is for partners");
  const pct = input.profitSharePct === undefined ? (before?.profitSharePct == null ? null : Number(before.profitSharePct)) : input.profitSharePct;
  const changed = input.profitSharePct !== undefined && pct !== (before?.profitSharePct == null ? null : Number(before.profitSharePct));
  return {
    profitSharePct: pct === null || pct === 0 ? null : pct.toFixed(4),
    shareFrom: input.shareFrom === undefined ? undefined : input.shareFrom ? dateColumn(input.shareFrom) : dateColumn(joinedOn),
    lossRule: input.lossRule,
    shareConfirmedAt: pct ? (changed || !before?.shareConfirmedAt ? new Date() : undefined) : null,
    shareConfirmedNote: input.shareConfirmedNote,
  };
}

const INCLUDE = { capitalAccount: { select: { id: true, code: true, name: true } }, currentAccount: { select: { id: true, code: true, name: true } } } satisfies Prisma.PartnerInclude;
type PartnerRow = Prisma.PartnerGetPayload<{ include: typeof INCLUDE }>;

/** The first free code in [from, to] (31xx capital, 32xx current). */
async function freeCode(tx: AppTransactionClient, businessId: string, from: number, to: number) {
  const used = new Set((await tx.ledgerAccount.findMany({ where: { businessId, code: { gte: String(from), lte: String(to) } }, select: { code: true } })).map((a) => a.code));
  for (let c = from; c <= to; c++) if (!used.has(String(c))) return String(c);
  throw financeError(409, "NO_ACCOUNT_CODE", `No free account code between ${from} and ${to}`);
}

export async function createPartner(input: PartnerInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  if (input.leftOn && input.leftOn < input.joinedOn) throw financeError(400, "PARTNER_DATES", "The leaving date is on or after the joining date");
  return financeTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-partner:${business.id}`}))`;
    const name = input.name.trim();
    if (await tx.partner.findFirst({ where: { businessId: business.id, name: { equals: name, mode: "insensitive" } } })) throw financeError(409, "PARTNER_EXISTS", `${name} is already a partner`);
    const equity = await tx.ledgerAccount.findFirst({ where: { businessId: business.id, code: "3000" } });
    if (!equity || equity.isPostable || equity.type !== "EQUITY") throw financeError(409, "EQUITY_GROUP", "The chart needs the 3000 Equity group");
    const role = input.role ?? "INVESTOR";
    if (isBusinessOwner(role) && (await tx.partner.findFirst({ where: { businessId: business.id, role: "OWNER" } }))) throw financeError(409, "OWNER_EXISTS", "The business already has its owner");
    const names = accountNames(name);
    const audits: FinanceAuditInput[] = [];
    const make = async (code: string, accountName: string) => {
      const a = await tx.ledgerAccount.create({ data: { businessId: business.id, code, name: accountName, type: "EQUITY", normalBalance: "CREDIT", parentId: equity.id, isPostable: true, isSystem: true, isSensitive: true } });
      audits.push({ businessId: business.id, actor, action: "account.create", entityType: "LedgerAccount", entityId: a.id, after: a, reason: "Partner accounts" });
      return a;
    };
    let capital: { id: string; code: string };
    let current: { id: string; code: string };
    if (isBusinessOwner(role)) {
      await ensureOwnerBooksSetupInTx(tx, business, actor);
      capital = await resolveMappedAccount(tx, business.id, "equity.owner_capital");
      current = await resolveMappedAccount(tx, business.id, "equity.owner_drawings");
    } else {
      capital = await make(await freeCode(tx, business.id, 3101, 3199), names.capital);
      current = await make(await freeCode(tx, business.id, 3201, 3299), names.current);
    }
    const row = await tx.partner.create({
      data: {
        businessId: business.id, number: await nextFinanceSequence(tx, business.id, "partner"), name, phone: input.phone ?? null, email: input.email ?? null,
        joinedOn: dateColumn(input.joinedOn), leftOn: input.leftOn ? dateColumn(input.leftOn) : null, agreedSharePct: input.agreedSharePct === null || input.agreedSharePct === undefined ? null : input.agreedSharePct.toFixed(4),
        agreementReference: input.agreementReference ?? null, capitalAccountId: capital.id, currentAccountId: current.id, notes: input.notes ?? null, createdByAdminId: adminOf(actor),
        role, ...shareFields(input, role, input.joinedOn),
      },
      include: INCLUDE,
    });
    audits.push({ businessId: business.id, actor, action: "equity.partner_create", entityType: "Partner", entityId: row.id, after: { number: partnerNumber(row.number), name, capital: capital.code, current: current.code } });
    await recordFinanceAudit(tx, audits);
    return partnerDto(row, new Map(), business.baseCurrency);
  });
}

/** Details change; a rename renames the partner's two accounts too. */
export async function updatePartner(id: string, input: Partial<PartnerInput>, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const before = await tx.partner.findFirst({ where: { id, businessId: business.id }, include: INCLUDE });
    if (!before) throw financeError(404, "PARTNER_NOT_FOUND", "Partner not found");
    const joinedOn = input.joinedOn ?? businessDateOf(before.joinedOn);
    const leftOn = input.leftOn !== undefined ? input.leftOn : before.leftOn ? businessDateOf(before.leftOn) : null;
    if (leftOn && leftOn < joinedOn) throw financeError(400, "PARTNER_DATES", "The leaving date is on or after the joining date");
    const name = input.name?.trim() ?? before.name;
    const audits: FinanceAuditInput[] = [];
    if (input.role && input.role !== before.role) throw financeError(400, "PARTNER_ROLE_FIXED", "A partner's role is set when they are added");
    if (name !== before.name && !isBusinessOwner(before.role)) {
      if (await tx.partner.findFirst({ where: { businessId: business.id, id: { not: id }, name: { equals: name, mode: "insensitive" } } })) throw financeError(409, "PARTNER_EXISTS", `${name} is already a partner`);
      const names = accountNames(name);
      for (const [accountId, accountName] of [[before.capitalAccountId, names.capital], [before.currentAccountId, names.current]] as const) {
        const prior = await tx.ledgerAccount.findUniqueOrThrow({ where: { id: accountId } });
        await tx.ledgerAccount.update({ where: { id: accountId }, data: { name: accountName } });
        audits.push({ businessId: business.id, actor, action: "account.update", entityType: "LedgerAccount", entityId: accountId, before: { name: prior.name }, after: { name: accountName }, reason: "Partner renamed" });
      }
    }
    const row = await tx.partner.update({
      where: { id },
      data: {
        name, phone: input.phone, email: input.email, joinedOn: dateColumn(joinedOn), leftOn: leftOn ? dateColumn(leftOn) : null,
        agreedSharePct: input.agreedSharePct === undefined ? undefined : input.agreedSharePct === null ? null : input.agreedSharePct.toFixed(4),
        agreementReference: input.agreementReference, notes: input.notes,
        ...shareFields(input, before.role, joinedOn, before),
      },
      include: INCLUDE,
    });
    audits.push({ businessId: business.id, actor, action: "equity.partner_update", entityType: "Partner", entityId: id, before: partnerDto(before, new Map(), business.baseCurrency), after: partnerDto(row, new Map(), business.baseCurrency) });
    await recordFinanceAudit(tx, audits);
    return partnerDto(row, new Map(), business.baseCurrency);
  });
}

function partnerDto(p: PartnerRow, balances: Map<string, number>, cur: string) {
  const m = (id: string) => toMajorNumber(balances.get(id) ?? 0, cur);
  const capital = m(p.capitalAccountId);
  const current = m(p.currentAccountId);
  return {
    id: p.id, number: partnerNumber(p.number), name: p.name, phone: p.phone, email: p.email, joinedOn: businessDateOf(p.joinedOn), leftOn: p.leftOn ? businessDateOf(p.leftOn) : null,
    agreedSharePct: p.agreedSharePct === null ? null : Number(p.agreedSharePct), agreementReference: p.agreementReference, notes: p.notes,
    role: p.role, profitSharePct: p.profitSharePct === null ? null : Number(p.profitSharePct), shareFrom: p.shareFrom ? businessDateOf(p.shareFrom) : null, lossRule: p.lossRule,
    shareConfirmed: Boolean(p.shareConfirmedAt), shareConfirmedAt: p.shareConfirmedAt?.toISOString() ?? null, shareConfirmedNote: p.shareConfirmedNote,
    capitalAccount: p.capitalAccount, currentAccount: p.currentAccount,
    balances: { capital, current, total: toMajorNumber(Math.round(capital * 100) + Math.round(current * 100), cur) },
  };
}

/** Credit balances (minor units) of the given accounts, posted entries up to `asOf`. */
async function creditBalances(businessId: string, accountIds: string[], asOf: string, cur: string) {
  if (!accountIds.length) return new Map<string, number>();
  const rows = await prisma.$queryRaw<Array<{ accountId: string; d: Prisma.Decimal; c: Prisma.Decimal }>>`
    SELECT l."accountId", COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."businessId" = ${businessId} AND e.status = 'POSTED' AND e."entryDate" <= ${dateColumn(asOf)} AND l."accountId" = ANY(${accountIds})
    GROUP BY l."accountId"`;
  return new Map(rows.map((r) => [r.accountId, toMinor(r.c, cur) - toMinor(r.d, cur)]));
}

/** Partners with their balances, and the balance sheet's equity section (they agree by construction). */
export async function equityOverview(q: { asOf?: string } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const asOf = q.asOf ?? businessToday(business);
  const rows = await prisma.partner.findMany({ where: { businessId: business.id }, include: INCLUDE, orderBy: { number: "asc" } });
  const balances = await creditBalances(business.id, rows.flatMap((p) => [p.capitalAccountId, p.currentAccountId]), asOf, cur);
  const partners = rows.map((p) => partnerDto(p, balances, cur));
  const bs = await balanceSheet({ asOf });
  const equity = bs.sections.find((s) => s.key === "equity")!;
  const sum = (k: "capital" | "current" | "total") => toMajorNumber(partners.reduce((s, p) => s + Math.round(p.balances[k] * 100), 0), cur);
  const shares = partners.filter((p) => !p.leftOn && p.agreedSharePct !== null).reduce((s, p) => s + (p.agreedSharePct ?? 0), 0);
  return {
    asOf, currency: cur, partners,
    totals: { capital: sum("capital"), current: sum("current"), total: sum("total"), agreedSharesPct: Math.round(shares * 10_000) / 10_000 },
    equity: { lines: equity.lines, total: equity.total },
  };
}
