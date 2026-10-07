/**
 * Financial periods (Phase 1): monthly, created on demand for the date a journal is dated on. Status changes are explicit,
 * audited actions; posting rules per status live in journal.service (and the CLOSED rule in the database, F-5).
 */
import { fiscalYearOf, monthPeriod } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { businessDateOf, dateColumn, financeError } from "./finance-values";
import { financeTransaction } from "./finance-tx";

export async function ensurePeriod(tx: AppTransactionClient, business: Pick<FinanceBusinessInfo, "id" | "fiscalYearStartMonth">, date: string, actor: FinanceActor) {
  const bounds = monthPeriod(date);
  const existing = await tx.financialPeriod.findUnique({ where: { businessId_startDate: { businessId: business.id, startDate: dateColumn(bounds.startDate) } } });
  if (existing) return existing;
  // Concurrent first postings into a new month: the unique (businessId, startDate) index decides; ON CONFLICT keeps the
  // transaction alive (a raised unique violation would abort it).
  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "FinancialPeriod" ("id", "businessId", "startDate", "endDate", "fiscalYear", "status", "updatedAt")
    VALUES (${`fp_${business.id}_${bounds.startDate}`}, ${business.id}, ${bounds.startDate}::date, ${bounds.endDate}::date,
            ${fiscalYearOf(date, business.fiscalYearStartMonth)}, 'OPEN', now())
    ON CONFLICT ("businessId", "startDate") DO NOTHING RETURNING "id"`;
  const period = await tx.financialPeriod.findUniqueOrThrow({ where: { businessId_startDate: { businessId: business.id, startDate: dateColumn(bounds.startDate) } } });
  if (inserted.length) {
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "period.open", entityType: "FinancialPeriod", entityId: period.id, after: period });
  }
  return period;
}

export function periodDto(p: { id: string; startDate: Date; endDate: Date; fiscalYear: number; status: string; closedAt: Date | null; closedByAdminId: string | null }) {
  return { id: p.id, startDate: businessDateOf(p.startDate), endDate: businessDateOf(p.endDate), fiscalYear: p.fiscalYear, status: p.status, closedAt: p.closedAt, closedByAdminId: p.closedByAdminId };
}

export async function listPeriods() {
  const { business } = await getFinanceContext();
  const periods = await prisma.financialPeriod.findMany({ where: { businessId: business.id }, orderBy: { startDate: "desc" } });
  return periods.map(periodDto);
}

const TRANSITIONS = {
  "soft-close": { from: ["OPEN"], to: "SOFT_CLOSED", action: "period.soft_close" },
  close: { from: ["OPEN", "SOFT_CLOSED"], to: "CLOSED", action: "period.close" },
  reopen: { from: ["SOFT_CLOSED", "CLOSED"], to: "OPEN", action: "period.reopen" },
} as const;

export type PeriodTransition = keyof typeof TRANSITIONS;

export async function changePeriodStatus(periodId: string, transition: PeriodTransition, reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const rule = TRANSITIONS[transition];
  return financeTransaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "FinancialPeriod" WHERE id = ${periodId} AND "businessId" = ${business.id} FOR UPDATE`;
    if (!rows.length) throw financeError(404, "PERIOD_NOT_FOUND", "Period not found");
    const before = await tx.financialPeriod.findUniqueOrThrow({ where: { id: periodId } });
    if (!(rule.from as readonly string[]).includes(before.status)) {
      throw financeError(409, "PERIOD_TRANSITION_INVALID", `A ${before.status.toLowerCase().replace("_", "-")} period can't be ${transition === "reopen" ? "reopened" : transition === "close" ? "closed" : "soft-closed"}`);
    }
    if (rule.to === "CLOSED") {
      const drafts = await tx.journalEntry.count({ where: { periodId, status: "DRAFT" } });
      if (drafts > 0) throw financeError(409, "PERIOD_HAS_DRAFTS", `Post or delete the ${drafts} draft journal(s) in this period first`, { drafts });
    }
    const after = await tx.financialPeriod.update({
      where: { id: periodId },
      data: { status: rule.to, closedAt: rule.to === "OPEN" ? null : new Date(), closedByAdminId: rule.to === "OPEN" ? null : actor.type === "ADMIN" ? actor.adminId : null },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: rule.action, entityType: "FinancialPeriod", entityId: periodId, before, after, reason });
    return periodDto(after);
  });
}
