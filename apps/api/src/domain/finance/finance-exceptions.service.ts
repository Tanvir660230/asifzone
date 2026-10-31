/**
 * Finance exceptions (Financial Core Phase 3, docs/FINANCE_PHASE_3.md §6): accounting problems the Finance Core will not
 * guess about — a sale line with no recorded cost, stock that moved without a value, a store-credit entry with no
 * accounting meaning, a settlement line with no order, an order whose totals don't add up. Each names its source record
 * and is found again (never duplicated) by its key. They are never deleted:
 *   OPEN → ACKNOWLEDGED  accepted as is (a missing cost stays missing: no cost is booked, reports keep saying so)
 *   OPEN | ACKNOWLEDGED → RESOLVED  an approved estimate was posted — only under the APPROVED_ESTIMATES cost policy,
 *                                   by someone allowed to post, and always labelled ESTIMATED.
 */
import type { FinanceException, FinanceExceptionKind, FinanceExceptionStatus, Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";

export interface ExceptionSpec {
  kind: FinanceExceptionKind;
  key: string;
  sourceType: string;
  sourceId: string;
  orderId?: string | null;
  orderNumber?: string | null;
  title: string;
  details: Record<string, unknown>;
  /** Minor units. */
  amountMinor?: number | null;
}

const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Finds the exception by its key or opens it; an OPEN one is refreshed when its facts changed. Audited. */
export async function upsertException(tx: AppTransactionClient, business: Pick<FinanceBusinessInfo, "id" | "baseCurrency">, brandId: string | null, spec: ExceptionSpec, actor: FinanceActor): Promise<FinanceException> {
  const cur = business.baseCurrency;
  const amount = spec.amountMinor == null ? null : toDecimal(spec.amountMinor, cur);
  const existing = await tx.financeException.findUnique({ where: { businessId_key: { businessId: business.id, key: spec.key } } });
  if (!existing) {
    const created = await tx.financeException.create({
      data: { businessId: business.id, brandId, kind: spec.kind, key: spec.key, sourceType: spec.sourceType, sourceId: spec.sourceId, orderId: spec.orderId ?? null, orderNumber: spec.orderNumber ?? null, title: spec.title, details: spec.details as Prisma.InputJsonValue, amount },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "exception.open", entityType: "FinanceException", entityId: created.id, after: created, sourceType: spec.sourceType, sourceRef: spec.sourceId });
    return created;
  }
  const changed = existing.status === "OPEN" && (stable(existing.details) !== stable(spec.details) || existing.title !== spec.title || (existing.amount?.toString() ?? null) !== (amount?.toString() ?? null));
  if (!changed) return existing;
  const updated = await tx.financeException.update({ where: { id: existing.id }, data: { title: spec.title, details: spec.details as Prisma.InputJsonValue, amount } });
  await recordFinanceAudit(tx, { businessId: business.id, actor, action: "exception.refresh", entityType: "FinanceException", entityId: existing.id, before: { title: existing.title, details: existing.details }, after: { title: updated.title, details: updated.details } });
  return updated;
}

export function exceptionDto(e: FinanceException, currency: string) {
  return {
    ...e,
    amount: e.amount === null ? null : toMajorNumber(toMinor(e.amount, currency), currency),
    estimatedUnitCost: e.estimatedUnitCost === null ? null : toMajorNumber(toMinor(e.estimatedUnitCost, currency), currency),
  };
}

export async function listExceptions(q: { status?: FinanceExceptionStatus; kind?: FinanceExceptionKind; orderId?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where: Prisma.FinanceExceptionWhereInput = { businessId: business.id, status: q.status, kind: q.kind, orderId: q.orderId };
  const [total, rows, open] = await Promise.all([
    prisma.financeException.count({ where }),
    prisma.financeException.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.financeException.groupBy({ by: ["kind"], where: { businessId: business.id, status: "OPEN" }, _count: { _all: true } }),
  ]);
  return {
    total, page: q.page, pageSize: q.pageSize,
    openByKind: Object.fromEntries(open.map((g) => [g.kind, g._count._all])),
    exceptions: rows.map((e) => exceptionDto(e, business.baseCurrency)),
  };
}

async function lockException(tx: AppTransactionClient, businessId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "FinanceException" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "EXCEPTION_NOT_FOUND", "Exception not found");
  return tx.financeException.findUniqueOrThrow({ where: { id } });
}

/**
 * A stock movement was reversed exactly (docs/STOCK_HUB.md §10): the open "stock received / removed without a value"
 * exception of the reversed movement has nothing left to decide — the pair nets to nothing — so it is acknowledged with the
 * correction named, in the caller's transaction. Exceptions already decided stay as they are.
 */
export async function settleReversedStockExceptionsInTx(tx: AppTransactionClient, movementId: string, reversalId: string, note: string, actor: FinanceActor) {
  const open = await tx.financeException.findMany({ where: { key: `stock:${movementId}`, status: "OPEN" }, select: { id: true, businessId: true } });
  for (const e of open) {
    const resolutionNote = `Reversed by stock correction ${reversalId}: ${note}`;
    await tx.financeException.update({ where: { id: e.id }, data: { status: "ACKNOWLEDGED", resolution: "ACKNOWLEDGED", resolutionNote, resolvedByAdminId: actor.type === "ADMIN" ? actor.adminId : null, resolvedAt: new Date() } });
    await recordFinanceAudit(tx, { businessId: e.businessId, actor, action: "exception.acknowledge", entityType: "FinanceException", entityId: e.id, before: { status: "OPEN" }, after: { status: "ACKNOWLEDGED" }, reason: resolutionNote });
  }
  return open.length;
}

export async function acknowledgeException(id: string, note: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const e = await lockException(tx, business.id, id);
    if (e.status !== "OPEN") throw financeError(409, "EXCEPTION_NOT_OPEN", `This exception is already ${e.status.toLowerCase()}`);
    const after = await tx.financeException.update({ where: { id }, data: { status: "ACKNOWLEDGED", resolution: "ACKNOWLEDGED", resolutionNote: note, resolvedByAdminId: actor.type === "ADMIN" ? actor.adminId : null, resolvedAt: new Date() } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "exception.acknowledge", entityType: "FinanceException", entityId: id, before: { status: e.status }, after: { status: after.status }, reason: note });
    return exceptionDto(after, business.baseCurrency);
  });
}

/** Records an approved estimated unit cost on a cost exception, with the event that posts it when the caller already has
 * it (a RESOLVED exception is final, so nothing is written to it afterwards). */
export async function markEstimateApproved(tx: AppTransactionClient, business: FinanceBusinessInfo, id: string, unitCostMinor: number, note: string, actor: FinanceActor, financialEventId: string | null = null) {
  const policy = (await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { costPolicy: true } })).costPolicy;
  if (policy !== "APPROVED_ESTIMATES" && policy !== "AUTO_ESTIMATE") {
    throw financeError(409, "ESTIMATES_NOT_PERMITTED", "The accounting policy books known costs only — an estimate can't be posted (change the cost policy first)");
  }
  const e = await lockException(tx, business.id, id);
  if (e.kind !== "MISSING_COST" && e.kind !== "UNVALUED_STOCK_WRITE_OFF") throw financeError(409, "EXCEPTION_NOT_ESTIMABLE", "Only a missing cost can be resolved with an estimate");
  if (e.status === "RESOLVED") throw financeError(409, "EXCEPTION_NOT_OPEN", "This exception is already resolved");
  if (unitCostMinor <= 0) throw financeError(400, "ESTIMATE_INVALID", "An estimate must be more than zero");
  const after = await tx.financeException.update({
    where: { id },
    data: { status: "RESOLVED", resolution: "ESTIMATE_APPROVED", resolutionNote: note, estimatedUnitCost: toDecimal(unitCostMinor, business.baseCurrency), financialEventId, resolvedByAdminId: actor.type === "ADMIN" ? actor.adminId : null, resolvedAt: new Date() },
  });
  await recordFinanceAudit(tx, { businessId: business.id, actor, action: "exception.approve_estimate", entityType: "FinanceException", entityId: id, before: { status: e.status }, after: { status: after.status, estimatedUnitCost: unitCostMinor }, reason: note });
  return after;
}
