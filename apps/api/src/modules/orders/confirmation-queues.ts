import type { Prisma } from "@prisma/client";
import { DEFAULT_CONFIRMATION_POLICY, type ConfirmationPolicy } from "@clothing-brand/shared";
import { getSettings } from "../settings/settings.service";

/**
 * The customer-confirmation queues (Order Operations phase 3) as Order `where` clauses — one definition for the list, its
 * badge counts, "Needs action" and "Take next call", so a badge always equals what its queue shows.
 *
 *   Call now   PENDING, not escalated, no callback set or the callback is due   (callback time, then oldest first)
 *   Call later PENDING, not escalated, callback in the future                   (callback time)
 *   Escalated  PENDING and escalated: flagged (wrong number / every try used), or unconfirmed longer than the store
 *              allows with no owner reprieve running                               (oldest first)
 */

/** This store's confirmation policy (StoreSetting, cached), each value the plan's default when unset. */
export async function getConfirmationPolicy(): Promise<ConfirmationPolicy> {
  const s = (await getSettings()) as Partial<Record<string, unknown>>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    maxUnreached: num(s.confirmationMaxUnreached, DEFAULT_CONFIRMATION_POLICY.maxUnreached),
    escalateAfterHours: num(s.confirmationEscalateHours, DEFAULT_CONFIRMATION_POLICY.escalateAfterHours),
    retryMinutes: num(s.confirmationRetryMinutes, DEFAULT_CONFIRMATION_POLICY.retryMinutes),
    nextDayHour: num(s.confirmationNextDayHour, DEFAULT_CONFIRMATION_POLICY.nextDayHour),
  };
}

/** Unconfirmed longer than the policy allows, with no "one more try" reprieve running. */
export function staleWhere(now: Date, policy: ConfirmationPolicy): Prisma.OrderWhereInput {
  return {
    createdAt: { lt: new Date(now.getTime() - policy.escalateAfterHours * 3_600_000) },
    OR: [{ confirmationReprieveUntil: null }, { confirmationReprieveUntil: { lt: now } }],
  };
}

export function escalatedWhere(now: Date, policy: ConfirmationPolicy): Prisma.OrderWhereInput {
  return { status: "PENDING", OR: [{ confirmationEscalatedAt: { not: null } }, staleWhere(now, policy)] };
}

function notEscalated(now: Date, policy: ConfirmationPolicy): Prisma.OrderWhereInput {
  return { confirmationEscalatedAt: null, NOT: staleWhere(now, policy) };
}

export function callNowWhere(now: Date, policy: ConfirmationPolicy): Prisma.OrderWhereInput {
  return { status: "PENDING", AND: [notEscalated(now, policy), { OR: [{ followUpAt: null }, { followUpAt: { lte: now } }] }] };
}

export function callLaterWhere(now: Date, policy: ConfirmationPolicy): Prisma.OrderWhereInput {
  return { status: "PENDING", followUpAt: { gt: now }, AND: [notEscalated(now, policy)] };
}

export type ConfirmQueue = "callNow" | "callLater" | "escalated";

export function confirmQueueWhere(queue: ConfirmQueue, now: Date, policy: ConfirmationPolicy): Prisma.OrderWhereInput {
  if (queue === "callNow") return callNowWhere(now, policy);
  if (queue === "callLater") return callLaterWhere(now, policy);
  return escalatedWhere(now, policy);
}

/** Each queue's own order when the admin hasn't picked a column. */
export function confirmQueueOrderBy(queue: ConfirmQueue): Prisma.OrderOrderByWithRelationInput[] {
  if (queue === "escalated") return [{ createdAt: "asc" }, { id: "asc" }];
  return [{ followUpAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }];
}
