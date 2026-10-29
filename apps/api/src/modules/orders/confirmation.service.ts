import type { Prisma } from "@prisma/client";
import {
  CONFIRMATION_CLAIM_MINUTES,
  CONFIRMATION_ESCALATION_LABELS,
  CONFIRMATION_OUTCOME_LABELS,
  UNREACHED_OUTCOMES,
  confirmationEffect,
  formatDateTime,
  suggestedRetryAt,
  type ConfirmationDecisionInput,
  type ConfirmationEscalationReason,
  type ConfirmationOutcome,
  type OrderConfirmationState,
  type RecordConfirmationAttemptInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { getTimezone } from "../../domain/config/commerce-settings";
import { applyOrderTransition, runTransitionSideEffects } from "./order.service";
import { callNowWhere, getConfirmationPolicy, staleWhere } from "./confirmation-queues";

/**
 * Customer confirmation calls (Order Operations plan, phase 3). Every call is one append-only OrderConfirmationAttempt;
 * the order stays PENDING until a call confirms it (the existing PENDING → CONFIRMED transition, its SMS and side
 * effects) or a person cancels it with a reason (the existing cancel path — stock released there). "I'll confirm tomorrow"
 * sets a callback and never confirms. Unanswered calls are retried on the store's schedule; a wrong number, the last
 * allowed unanswered call, or an order unconfirmed too long goes to the Escalated queue. Nothing here cancels on its own.
 *
 * Every write runs under the order's row lock, so two operators recording a call on one order are serialised, and a
 * claim ("Take next call") is a conditional update — two operators asking at once get different orders.
 */

const claimTtlMs = CONFIRMATION_CLAIM_MINUTES * 60_000;
type Tx = Prisma.TransactionClient;

async function lockOrder(tx: Tx, orderId: string) {
  const [row] = await tx.$queryRaw<
    Array<{
      status: string;
      deletedAt: Date | null;
      createdAt: Date;
      confirmationUnreached: number;
      confirmationExtraAttempts: number;
      confirmationClaimedById: string | null;
      confirmationClaimedAt: Date | null;
      confirmationEscalatedAt: Date | null;
      confirmationEscalationReason: string | null;
      confirmationReprieveUntil: Date | null;
    }>
  >`SELECT status, "deletedAt", "createdAt", "confirmationUnreached", "confirmationExtraAttempts", "confirmationClaimedById",
       "confirmationClaimedAt", "confirmationEscalatedAt", "confirmationEscalationReason", "confirmationReprieveUntil"
     FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  if (!row) throw AppError.notFound("Order not found");
  if (row.deletedAt) throw AppError.badRequest("Restore this order before making changes");
  return row;
}

function claimHeldByOther(row: { confirmationClaimedById: string | null; confirmationClaimedAt: Date | null }, adminId: string, now: Date) {
  return Boolean(row.confirmationClaimedById && row.confirmationClaimedById !== adminId && row.confirmationClaimedAt && now.getTime() - row.confirmationClaimedAt.getTime() < claimTtlMs);
}

async function adminName(id: string | null) {
  if (!id) return null;
  return (await prisma.adminUser.findUnique({ where: { id }, select: { name: true } }))?.name ?? null;
}

/**
 * Record one call. `canCancel` = the caller holds orders.cancel (a declined order is cancelled through the existing
 * path, which needs it). Refused while another operator's claim on the order is live.
 */
export async function recordConfirmationAttempt(orderId: string, adminId: string, input: RecordConfirmationAttemptInput, opts: { canCancel: boolean }) {
  if (input.outcome === "DECLINED" && !opts.canCancel) throw AppError.forbidden("Cancelling an order needs the cancel permission — ask an owner or manager");
  const [policy, timeZone] = await Promise.all([getConfirmationPolicy(), getTimezone()]);
  const now = new Date();
  if (input.callbackAt && input.callbackAt.getTime() < now.getTime() - 60_000) throw AppError.badRequest("The callback time is in the past");

  const outcome = await prisma.$transaction(async (tx) => {
    const row = await lockOrder(tx, orderId);
    if (row.status !== "PENDING") {
      throw new AppError(409, `This order is already ${row.status.toLowerCase()} — the confirmation call is over`, { code: "ORDER_NOT_PENDING" });
    }
    if (claimHeldByOther(row, adminId, now)) {
      const who = (await adminName(row.confirmationClaimedById)) ?? "another operator";
      throw new AppError(409, `${who} is on this call right now`, { code: "CONFIRMATION_CLAIMED" });
    }

    const effect = confirmationEffect(
      { outcome: input.outcome, callbackAt: input.callbackAt ?? null },
      { unreached: row.confirmationUnreached, extraAttempts: row.confirmationExtraAttempts },
      { now, timeZone, policy },
    );
    await tx.orderConfirmationAttempt.create({
      data: { orderId, adminId, outcome: input.outcome, note: input.note || null, callbackAt: effect.followUpAt ?? input.callbackAt ?? null },
    });

    const limit = policy.maxUnreached + row.confirmationExtraAttempts;
    const label = CONFIRMATION_OUTCOME_LABELS[input.outcome];
    const parts = [`Confirmation call: ${label}`];
    if (UNREACHED_OUTCOMES.includes(input.outcome)) parts[0] += ` (${effect.unreached} of ${limit} unanswered)`;
    if (effect.followUpAt) parts.push(`call back ${formatDateTime(effect.followUpAt, timeZone)}`);
    if (effect.escalate) parts.push(`escalated — ${CONFIRMATION_ESCALATION_LABELS[effect.escalate].toLowerCase()}`);
    const historyNote = [parts.join(" — "), input.note].filter(Boolean).join(": ");

    await tx.order.update({
      where: { id: orderId },
      data: {
        callAttempts: { increment: 1 },
        confirmationUnreached: effect.unreached,
        // The call is over: the claim is released whatever the outcome.
        confirmationClaimedById: null,
        confirmationClaimedAt: null,
        ...(effect.transition ? {} : { followUpAt: effect.followUpAt }),
        ...(effect.escalate ? { confirmationEscalatedAt: now, confirmationEscalationReason: effect.escalate } : {}),
        // A transition writes its own timeline entry (with this note); every other call is a note on the current status.
        ...(effect.transition ? {} : { statusHistory: { create: { status: "PENDING", note: historyNote, changedByAdminId: adminId } } }),
      },
    });

    if (effect.transition === "CONFIRMED") {
      const t = await applyOrderTransition(tx, orderId, { status: "CONFIRMED", note: input.note ? `Confirmed on call: ${input.note}` : "Confirmed on call" }, { adminId });
      await tx.order.update({ where: { id: orderId }, data: { followUpAt: null, confirmationEscalatedAt: null, confirmationEscalationReason: null } });
      return t;
    }
    if (effect.transition === "CANCELLED") {
      const t = await applyOrderTransition(tx, orderId, { status: "CANCELLED", note: `Declined on call: ${input.note}` }, { adminId });
      await tx.order.update({ where: { id: orderId }, data: { followUpAt: null } });
      return t;
    }
    return null;
  });
  // Confirmation SMS, stock release on cancel, … — the existing side effects of the transition, after commit.
  if (outcome) await runTransitionSideEffects(outcome);
  return getConfirmationState(orderId);
}

/** "Take next call": claim the next order in Call now for this operator — their assigned orders first, then unassigned
 * ones; never one another operator holds. A claim this operator already holds on a Call-now order is returned again. */
export async function claimNextConfirmation(adminId: string): Promise<{ orderId: string; orderNumber: string } | null> {
  const [policy, now] = [await getConfirmationPolicy(), new Date()];
  const queue = callNowWhere(now, policy);
  const live = { deletedAt: null, ...queue };

  const mine = await prisma.order.findFirst({
    where: { ...live, confirmationClaimedById: adminId, confirmationClaimedAt: { gt: new Date(now.getTime() - claimTtlMs) } },
    select: { id: true, orderNumber: true },
  });
  if (mine) return { orderId: mine.id, orderNumber: mine.orderNumber };

  const free: Prisma.OrderWhereInput = { OR: [{ confirmationClaimedAt: null }, { confirmationClaimedAt: { lt: new Date(now.getTime() - claimTtlMs) } }] };
  for (const assignee of [{ confirmationAssigneeId: adminId }, { confirmationAssigneeId: null }]) {
    const candidates = await prisma.order.findMany({
      where: { AND: [live, free, assignee] },
      orderBy: [{ followUpAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
      take: 10,
      select: { id: true, orderNumber: true },
    });
    for (const c of candidates) {
      // The same conditions again, atomically: whoever's update lands first holds the claim.
      const { count } = await prisma.order.updateMany({
        where: { AND: [{ id: c.id }, live, free] },
        data: { confirmationClaimedById: adminId, confirmationClaimedAt: now },
      });
      if (count === 1) return { orderId: c.id, orderNumber: c.orderNumber };
    }
  }
  return null;
}

/** Release this operator's claim without recording a call (they put the phone down / opened the wrong order). */
export async function releaseConfirmationClaim(orderId: string, adminId: string) {
  await prisma.order.updateMany({ where: { id: orderId, confirmationClaimedById: adminId }, data: { confirmationClaimedById: null, confirmationClaimedAt: null } });
  return getConfirmationState(orderId);
}

/**
 * Assign an order's calls to an operator (orders.manage), or an owner/manager's decision on an escalated order
 * (orders.escalations): one more try (the limit raised by one, the age rule held off for a day) or "phone fixed"
 * (unanswered count back to 0). Cancelling is the existing cancel action, with its reason.
 */
export async function decideConfirmation(orderId: string, adminId: string, input: ConfirmationDecisionInput, opts: { canDecideEscalations: boolean }) {
  if (input.action !== "assign" && !opts.canDecideEscalations) throw AppError.forbidden("Only an owner or manager decides on an escalated confirmation");
  const [policy, timeZone] = await Promise.all([getConfirmationPolicy(), getTimezone()]);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const row = await lockOrder(tx, orderId);
    if (row.status !== "PENDING") throw new AppError(409, `This order is already ${row.status.toLowerCase()}`, { code: "ORDER_NOT_PENDING" });

    if (input.action === "assign") {
      if (input.assigneeId) {
        const a = await tx.adminUser.findUnique({ where: { id: input.assigneeId }, select: { isActive: true } });
        if (!a?.isActive) throw AppError.badRequest("That admin can't take calls");
      }
      const name = input.assigneeId ? await adminName(input.assigneeId) : null;
      await tx.order.update({
        where: { id: orderId },
        data: {
          confirmationAssigneeId: input.assigneeId,
          statusHistory: { create: { status: "PENDING", note: name ? `Confirmation calls assigned to ${name}` : "Confirmation calls unassigned", changedByAdminId: adminId } },
        },
      });
      return;
    }

    const stale = row.createdAt.getTime() < now.getTime() - policy.escalateAfterHours * 3_600_000 && !(row.confirmationReprieveUntil && row.confirmationReprieveUntil > now);
    if (!row.confirmationEscalatedAt && !stale) throw new AppError(409, "This order isn't escalated", { code: "NOT_ESCALATED" });

    if (input.action === "retry") {
      const callbackAt = input.callbackAt ?? now;
      const limit = policy.maxUnreached + row.confirmationExtraAttempts;
      await tx.order.update({
        where: { id: orderId },
        data: {
          confirmationEscalatedAt: null,
          confirmationEscalationReason: null,
          // Past the limit already: one more unanswered call is allowed before it escalates again.
          ...(row.confirmationUnreached >= limit ? { confirmationExtraAttempts: { increment: 1 } } : {}),
          confirmationReprieveUntil: new Date(now.getTime() + 24 * 3_600_000),
          followUpAt: callbackAt,
          statusHistory: {
            create: { status: "PENDING", note: `One more confirmation try — call ${formatDateTime(callbackAt, timeZone)}: ${input.reason}`, changedByAdminId: adminId },
          },
        },
      });
      return;
    }

    // phone_fixed
    await tx.order.update({
      where: { id: orderId },
      data: {
        confirmationEscalatedAt: null,
        confirmationEscalationReason: null,
        confirmationUnreached: 0,
        confirmationReprieveUntil: new Date(now.getTime() + 24 * 3_600_000),
        followUpAt: null,
        statusHistory: { create: { status: "PENDING", note: `Phone fixed — confirmation calls start again: ${input.reason}`, changedByAdminId: adminId } },
      },
    });
  });
  return getConfirmationState(orderId);
}

/** The phone changed (order details edit): the unanswered count starts again and an escalation the old number caused
 * is lifted — the calls already made stay in the history. Runs inside the edit's own write. */
export function phoneChangedConfirmationData(previousReason: string | null): Prisma.OrderUpdateInput {
  const byPhone: ConfirmationEscalationReason[] = ["WRONG_NUMBER", "UNREACHED_LIMIT"];
  return {
    confirmationUnreached: 0,
    ...(previousReason && byPhone.includes(previousReason as ConfirmationEscalationReason) ? { confirmationEscalatedAt: null, confirmationEscalationReason: null, followUpAt: null } : {}),
  };
}

/** The old "Hold for follow-up" also writes a "call back later" attempt, so its calls show in the same history. */
export function holdAttemptData(adminId: string | undefined, followUpAt: Date, note: string | null | undefined): Prisma.OrderConfirmationAttemptCreateWithoutOrderInput {
  return { outcome: "CALLBACK_REQUESTED", callbackAt: followUpAt, note: note || null, ...(adminId ? { admin: { connect: { id: adminId } } } : {}) };
}

export async function getConfirmationState(orderId: string): Promise<OrderConfirmationState> {
  const [policy, timeZone] = await Promise.all([getConfirmationPolicy(), getTimezone()]);
  const now = new Date();
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      createdAt: true,
      followUpAt: true,
      confirmationUnreached: true,
      confirmationExtraAttempts: true,
      confirmationEscalatedAt: true,
      confirmationEscalationReason: true,
      confirmationReprieveUntil: true,
      confirmationClaimedAt: true,
      confirmationAssignee: { select: { id: true, name: true } },
      confirmationClaimedBy: { select: { id: true, name: true } },
      confirmationAttempts: { orderBy: { createdAt: "desc" }, include: { admin: { select: { id: true, name: true } } } },
    },
  });
  if (!order) throw AppError.notFound("Order not found");
  const staleCount = await prisma.order.count({ where: { id: orderId, status: "PENDING", ...staleWhere(now, policy) } });
  const claimLive = order.confirmationClaimedAt && now.getTime() - order.confirmationClaimedAt.getTime() < claimTtlMs;
  return {
    attempts: order.confirmationAttempts.map((a) => ({
      id: a.id,
      outcome: a.outcome as ConfirmationOutcome,
      note: a.note,
      callbackAt: a.callbackAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      admin: a.admin,
    })),
    unreached: order.confirmationUnreached,
    limit: policy.maxUnreached + order.confirmationExtraAttempts,
    callbackAt: order.followUpAt?.toISOString() ?? null,
    escalatedAt: order.confirmationEscalatedAt?.toISOString() ?? null,
    escalationReason: (order.confirmationEscalationReason as ConfirmationEscalationReason | null) ?? null,
    staleEscalated: staleCount > 0 && !order.confirmationEscalatedAt,
    assignee: order.confirmationAssignee,
    claimedBy: claimLive ? order.confirmationClaimedBy : null,
    claimExpiresAt: claimLive ? new Date(order.confirmationClaimedAt!.getTime() + claimTtlMs).toISOString() : null,
    suggestedRetryAt: suggestedRetryAt(order.confirmationUnreached + 1, now, timeZone, policy).toISOString(),
    policy,
  };
}
