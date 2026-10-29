/**
 * Goods awaiting return (blueprint P0.4; owner decisions Q5 = A, Q13 = C, Q13b = B, Q-A, Q-B, Q-C; tab 11).
 *
 * While the store's returns rule is in force (FinanceBusiness.returnsReceiptRuleEffectiveAt set and reached), agreeing a
 * return — the order moved to Returned, a partial delivery reconciled, an exchange approved, an item return recorded —
 * no longer restocks: each line's units become a ReturnExpectation (inventory.service expectOrderLineReturns) and come back
 * only through Receive (good / damaged), or are written off as never returned after `returnLossDays`, with the owner's
 * approval at or above the count-loss limit. A return nothing of which came back yet may be withdrawn (S8). A request all
 * of whose expected units are closed becomes COMPLETED.
 *
 * The books follow these rows (commerce-accounting.service.ts): S1 at the agreement, S2/S3 at each receipt, S7 at the
 * write-off. Rule off (the default): none of this is written and every path restocks at approval as before.
 */
import type { Prisma } from "@prisma/client";
import { isAgreedReturnRequest, type ReceiveAwaitingReturnInput, type WithdrawReturnRequestInput, type WriteOffUnreturnedInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { FINANCE_BUSINESS_KEY } from "../../domain/finance/finance-context";
import { toMinor } from "../../domain/finance/finance-values";
import { closeExpectedUnitsAsLost, notifyReplenished, notifyStockMoved, receiveExpectedUnits, withdrawExpectedUnits } from "../inventory/inventory.service";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const RETURN_FOLLOW_UP_DAYS = 14;
export const RETURN_LOSS_DAYS = 30;
const DAY = 86_400_000;

/** The store's returns settings, read only (never creates the finance home). */
async function returnSettings(db: Db) {
  const biz = await db.financeBusiness.findUnique({
    where: { key: FINANCE_BUSINESS_KEY },
    select: { returnsReceiptRuleEffectiveAt: true, returnFollowUpDays: true, returnLossDays: true, countLossApprovalThreshold: true, baseCurrency: true },
  });
  return {
    effectiveAt: biz?.returnsReceiptRuleEffectiveAt ?? null,
    followUpDays: biz?.returnFollowUpDays ?? RETURN_FOLLOW_UP_DAYS,
    lossDays: biz?.returnLossDays ?? RETURN_LOSS_DAYS,
    lossApprovalThreshold: biz ? Number(biz.countLossApprovalThreshold) : null,
    currency: biz?.baseCurrency ?? null,
  };
}

/** Whether a return agreed at `at` waits for its goods (the rule in force) — else it restocks at once, as before. */
export async function returnsRuleActive(db: Db = prisma, at: Date = new Date()): Promise<boolean> {
  const { effectiveAt } = await returnSettings(db);
  return effectiveAt !== null && effectiveAt.getTime() <= at.getTime();
}

const open = (e: { quantity: number; receivedGood: number; receivedDamaged: number; lostQuantity: number }) => e.quantity - e.receivedGood - e.receivedDamaged - e.lostQuantity;

/** Requests every one of whose expected units is received or written off become COMPLETED (only from APPROVED). */
export async function completeSettledRequestsInTx(tx: Tx, requestIds: Array<string | null>) {
  for (const id of new Set(requestIds.filter((x): x is string => Boolean(x)))) {
    const left = await tx.returnExpectation.count({ where: { returnRequestId: id, status: "AWAITING" } });
    if (left === 0) await tx.returnRequest.updateMany({ where: { id, status: "APPROVED" }, data: { status: "COMPLETED" } });
  }
}

/** Closes expectations that have nothing left open. */
async function closeSettledInTx(tx: Tx, ids: string[]) {
  const rows = await tx.returnExpectation.findMany({ where: { id: { in: ids }, status: "AWAITING" } });
  for (const r of rows) if (open(r) === 0) await tx.returnExpectation.update({ where: { id: r.id }, data: { status: "CLOSED", closedAt: new Date() } });
}

/**
 * Receive (S2, S3, S4, S6): the goods a return agreed back are at the shop. Per line, `good` units go back on the shelf and
 * `damaged` ones are written off at the line's cost; the units are taken from the line's open expectations oldest first.
 * Never more than the line still awaits (S4: the rest stays awaiting). Row-locked: two receipts at once can't take the
 * same units.
 */
export async function receiveAwaitingReturn(orderId: string, adminId: string, input: ReceiveAwaitingReturnInput) {
  const { order, replenished, moved } = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ orderNumber: string; deletedAt: Date | null }>>`SELECT "orderNumber", "deletedAt" FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    if (!locked) throw AppError.notFound("Order not found");
    if (locked.deletedAt) throw AppError.badRequest("Restore this order before making changes");
    const expectations = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "ReturnExpectation" WHERE "orderId" = ${orderId} AND status = 'AWAITING' ORDER BY "approvedAt" ASC, id ASC FOR UPDATE`;
    const rows = await tx.returnExpectation.findMany({ where: { id: { in: expectations.map((e) => e.id) } }, orderBy: [{ approvedAt: "asc" }, { id: "asc" }] });
    if (!rows.length) throw new AppError(409, "Nothing on this order is waiting to come back", { code: "NOTHING_TO_RECEIVE" });
    const costs = new Map((await tx.orderItem.findMany({ where: { orderId }, select: { id: true, unitCostSnapshot: true } })).map((i) => [i.id, i.unitCostSnapshot]));
    const parts: Array<{ expectationId: string; orderItemId: string; variantId: string; good: number; damaged: number; unitCostMinor: number | null }> = [];
    let good = 0;
    let damaged = 0;
    for (const line of input.lines) {
      const mine = rows.filter((r) => r.orderItemId === line.orderItemId);
      const awaiting = mine.reduce((s, r) => s + open(r), 0);
      if (!mine.length) throw new AppError(400, "That item isn't waiting to come back on this order", { code: "NOT_AWAITING_RETURN" });
      if (line.good + line.damaged > awaiting) throw new AppError(400, `Only ${awaiting} unit(s) of this item are waiting to come back`, { code: "MORE_THAN_AWAITING" });
      let g = line.good;
      let d = line.damaged;
      for (const r of mine) {
        const room = open(r);
        const tg = Math.min(g, room);
        const td = Math.min(d, room - tg);
        if (tg + td === 0) continue;
        g -= tg;
        d -= td;
        await tx.returnExpectation.update({ where: { id: r.id }, data: { receivedGood: { increment: tg }, receivedDamaged: { increment: td } } });
        parts.push({ expectationId: r.id, orderItemId: r.orderItemId, variantId: r.variantId, good: tg, damaged: td, unitCostMinor: costs.get(r.orderItemId) ?? null });
      }
      good += line.good;
      damaged += line.damaged;
    }
    const stock = await receiveExpectedUnits(tx, { id: orderId, orderNumber: locked.orderNumber }, parts, { adminId, note: input.note?.trim() || null });
    await closeSettledInTx(tx, parts.map((p) => p.expectationId));
    await completeSettledRequestsInTx(tx, rows.filter((r) => parts.some((p) => p.expectationId === r.id)).map((r) => r.returnRequestId));
    const stillAwaiting = (await tx.returnExpectation.findMany({ where: { orderId, status: "AWAITING" } })).reduce((s, r) => s + open(r), 0);
    const status = (await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status;
    const parts2 = [`${good} good`, damaged ? `${damaged} damaged` : "", stillAwaiting ? `${stillAwaiting} still to come back` : ""].filter(Boolean);
    const updated = await tx.order.update({
      where: { id: orderId },
      data: { statusHistory: { create: { status, note: `Return received — ${parts2.join(", ")}${input.note?.trim() ? ` (${input.note.trim()})` : ""}`, changedByAdminId: adminId } } },
      select: { id: true, orderNumber: true, status: true },
    });
    return { order: updated, ...stock };
  });
  notifyReplenished(replenished);
  notifyStockMoved(moved);
  return order;
}

/**
 * Write-off of units agreed back that never arrived (S7; owner decisions Q-B, Q-C): only `returnLossDays` after the
 * agreement, every unit still open on that agreed line at once (one write-off per line), with a reason ("customer kept the
 * item" for an exchange original). At or above the store's count-loss limit — or when the line's cost is unknown — only
 * someone holding inventory.approve (the owner) may do it.
 */
export async function writeOffUnreturned(expectationId: string, input: WriteOffUnreturnedInput, actor: { adminId: string; permissions: readonly string[] }, now: Date = new Date()) {
  const settings = await returnSettings(prisma);
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ReturnExpectation" WHERE id = ${expectationId} FOR UPDATE`;
    if (!row) throw AppError.notFound("That return isn't on record");
    const e = await tx.returnExpectation.findUniqueOrThrow({ where: { id: expectationId }, include: { orderItem: { select: { unitCostSnapshot: true } }, order: { select: { orderNumber: true, status: true } } } });
    if (e.status !== "AWAITING" || open(e) <= 0) throw new AppError(409, "Nothing of this return is still waiting to come back", { code: "NOT_AWAITING_RETURN" });
    const daysOut = Math.floor((now.getTime() - e.approvedAt.getTime()) / DAY);
    if (daysOut < settings.lossDays) {
      throw new AppError(409, `It can be written off as never returned ${settings.lossDays} days after the return was agreed — ${settings.lossDays - daysOut} more day(s)`, { code: "TOO_EARLY_TO_WRITE_OFF", daysOut, lossDays: settings.lossDays });
    }
    const units = open(e);
    const unit = e.orderItem.unitCostSnapshot;
    const costMinor = unit === null ? null : unit * units;
    const thresholdMinor = settings.lossApprovalThreshold === null || !settings.currency ? null : toMinor(settings.lossApprovalThreshold, settings.currency);
    const needsOwner = costMinor === null || thresholdMinor === null || costMinor >= thresholdMinor;
    if (needsOwner && !actor.permissions.includes("inventory.approve")) {
      throw new AppError(403, costMinor === null ? "This item has no recorded cost — the owner writes it off" : "Writing off this much needs the owner's approval", { code: "OWNER_APPROVAL_REQUIRED" });
    }
    await closeExpectedUnitsAsLost(tx, e.orderItemId, units);
    const updated = await tx.returnExpectation.update({
      where: { id: e.id },
      data: { lostQuantity: { increment: units }, lostReason: input.reason, lostAt: now, lostByAdminId: actor.adminId, status: "CLOSED", closedAt: now },
    });
    await completeSettledRequestsInTx(tx, [e.returnRequestId]);
    await tx.orderStatusHistory.create({ data: { orderId: e.orderId, status: e.order.status, note: `${units} unit(s) never came back — written off (${input.reason})`, changedByAdminId: actor.adminId } });
    return updated;
  });
}

/**
 * S8: the customer keeps the items and pays after all. Only an item return (the order itself was not moved to Returned —
 * a returned order is closed and can't reopen) with nothing received or written off yet, and with no store credit or refund
 * recorded for it (take that back first). The request ends REJECTED with the reason; the units are the customer's again.
 */
export async function withdrawReturnRequest(requestId: string, input: WithdrawReturnRequestInput, adminId: string) {
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ReturnRequest" WHERE id = ${requestId} FOR UPDATE`;
    if (!row) throw AppError.notFound("Return request not found");
    const rr = await tx.returnRequest.findUniqueOrThrow({ where: { id: requestId }, include: { order: { select: { status: true } }, returnExpectations: true } });
    if (rr.type !== "RETURN" || !isAgreedReturnRequest(rr.status)) throw new AppError(409, "Only an approved return can be withdrawn", { code: "RETURN_NOT_WITHDRAWABLE" });
    if (!rr.returnExpectations.length) throw new AppError(409, "This return was restocked when it was approved — it can't be withdrawn", { code: "RETURN_NOT_WITHDRAWABLE" });
    if (rr.order.status === "RETURNED") throw new AppError(409, "A returned order can't be reopened — write off what never comes back instead", { code: "RETURN_NOT_WITHDRAWABLE" });
    if (rr.returnExpectations.some((e) => e.receivedGood + e.receivedDamaged + e.lostQuantity > 0 || e.status !== "AWAITING")) {
      throw new AppError(409, "Part of this return already came back or was written off", { code: "RETURN_PARTLY_RECEIVED" });
    }
    if (Number(rr.compensationAmount ?? 0) > 0) throw new AppError(409, "Take back the store credit or refund given for this return first", { code: "RETURN_COMPENSATED" });
    for (const e of rr.returnExpectations) await withdrawExpectedUnits(tx, e.orderItemId, e.quantity);
    const now = new Date();
    await tx.returnExpectation.updateMany({ where: { returnRequestId: requestId }, data: { status: "WITHDRAWN", withdrawnAt: now } });
    await tx.orderStatusHistory.create({ data: { orderId: rr.orderId, status: rr.order.status, note: `Return withdrawn — the customer keeps the items (${input.reason})`, changedByAdminId: adminId } });
    return tx.returnRequest.update({ where: { id: requestId }, data: { status: "REJECTED", adminNote: `Withdrawn after approval: ${input.reason}`, reviewedAt: now, reviewedByAdminId: adminId } });
  });
}

/** Lines waiting to come back (Returns & refused parcels), oldest first: how long each has been out, whether it is due a
 * follow-up (Q-B: 14 days) and whether it may be written off as never returned (Q-B: 30 days). */
export async function listAwaitingReturns(now: Date = new Date()) {
  const settings = await returnSettings(prisma);
  const rows = await prisma.returnExpectation.findMany({
    where: { status: "AWAITING" },
    orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
    include: {
      order: { select: { orderNumber: true, customerName: true, customerPhone: true, trackingNumber: true } },
      orderItem: { select: { productNameSnapshot: true, skuSnapshot: true, sizeSnapshot: true, colorSnapshot: true, priceSnapshot: true } },
    },
    take: 500,
  });
  const lines = rows.map((r) => {
    const daysOut = Math.floor((now.getTime() - r.approvedAt.getTime()) / DAY);
    return {
      expectationId: r.id, orderId: r.orderId, orderItemId: r.orderItemId, orderNumber: r.order.orderNumber, customerName: r.order.customerName, customerPhone: r.order.customerPhone,
      trackingNumber: r.order.trackingNumber, source: r.sourceType, returnRequestId: r.returnRequestId,
      productName: r.orderItem.productNameSnapshot, sku: r.orderItem.skuSnapshot, size: r.orderItem.sizeSnapshot, color: r.orderItem.colorSnapshot,
      units: open(r), value: Number(r.orderItem.priceSnapshot) * open(r), agreedAt: r.approvedAt, daysOut,
      overdue: daysOut >= settings.followUpDays, canWriteOff: daysOut >= settings.lossDays,
    };
  });
  return { ruleActive: settings.effectiveAt !== null && settings.effectiveAt <= now, effectiveAt: settings.effectiveAt, followUpDays: settings.followUpDays, lossDays: settings.lossDays, lines, overdue: lines.filter((l) => l.overdue).length };
}
