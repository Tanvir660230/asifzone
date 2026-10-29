import { z } from "zod";

/**
 * Customer confirmation calls (Order Operations plan, phase 3). An unconfirmed order stays PENDING — no new order status —
 * and every call is one append-only attempt with an outcome. "I'll confirm tomorrow" is a callback, never a confirmation.
 * Unanswered calls are retried on a schedule; a wrong number, too many unanswered calls or an order left too long goes
 * to the Escalated queue, where an owner or manager decides. Nothing here ever cancels an order on its own.
 */

export const CONFIRMATION_OUTCOMES = [
  "CONFIRMED",
  "NO_ANSWER",
  "SWITCHED_OFF",
  "BUSY",
  "CALLBACK_REQUESTED",
  "WILL_CONFIRM_LATER",
  "WRONG_NUMBER",
  "DECLINED",
  "OTHER",
] as const;
export type ConfirmationOutcome = (typeof CONFIRMATION_OUTCOMES)[number];

export const CONFIRMATION_OUTCOME_LABELS: Record<ConfirmationOutcome, string> = {
  CONFIRMED: "Confirmed",
  NO_ANSWER: "No answer",
  SWITCHED_OFF: "Phone off",
  BUSY: "Busy",
  CALLBACK_REQUESTED: "Call back later",
  WILL_CONFIRM_LATER: "Will confirm later",
  WRONG_NUMBER: "Wrong number",
  DECLINED: "Declined",
  OTHER: "Other",
};

/** The customer wasn't reached: these count toward the retry limit. */
export const UNREACHED_OUTCOMES: readonly ConfirmationOutcome[] = ["NO_ANSWER", "SWITCHED_OFF", "BUSY"];
/** The customer was reached and set a time: a callback time is required. */
export const CALLBACK_OUTCOMES: readonly ConfirmationOutcome[] = ["CALLBACK_REQUESTED", "WILL_CONFIRM_LATER"];

export const CONFIRMATION_ESCALATION_REASONS = ["UNREACHED_LIMIT", "WRONG_NUMBER", "STALE"] as const;
export type ConfirmationEscalationReason = (typeof CONFIRMATION_ESCALATION_REASONS)[number];
export const CONFIRMATION_ESCALATION_LABELS: Record<ConfirmationEscalationReason, string> = {
  UNREACHED_LIMIT: "Not reached after every try",
  WRONG_NUMBER: "Wrong number",
  STALE: "Unconfirmed too long",
};

/** Per-store settings (StoreSetting), each with the plan's default. */
export interface ConfirmationPolicy {
  /** Unanswered calls before the order is escalated (plan: 4). */
  maxUnreached: number;
  /** Hours an order may stay unconfirmed before it is escalated (plan: 72). */
  escalateAfterHours: number;
  /** Minutes until the suggested retry after the 1st and 2nd unanswered call (plan: 120). */
  retryMinutes: number;
  /** Store-local hour of the next-day retry from the 3rd unanswered call on (plan: 10). */
  nextDayHour: number;
}
export const DEFAULT_CONFIRMATION_POLICY: ConfirmationPolicy = { maxUnreached: 4, escalateAfterHours: 72, retryMinutes: 120, nextDayHour: 10 };

/** The claim on "Take next call" — one operator at a time, released by recording the call or after this long. */
export const CONFIRMATION_CLAIM_MINUTES = 15;

/** The wall-clock parts of an instant in an IANA timezone. */
function zonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(at)
    .reduce<Record<string, number>>((acc, p) => (p.type === "literal" ? acc : { ...acc, [p.type]: Number(p.value) }), {});
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour! % 24, minute: parts.minute!, second: parts.second! };
}

/** The instant at `hour`:00 store time on the day after `now` (store calendar). */
export function nextDayAt(now: Date, timeZone: string, hour: number): Date {
  const p = zonedParts(now, timeZone);
  const wallUtc = Date.UTC(p.year, p.month - 1, p.day + 1, hour, 0, 0);
  // The zone's offset at that wall time, found by reading the wall time back (exact outside a DST jump).
  const back = zonedParts(new Date(wallUtc), timeZone);
  const offset = Date.UTC(back.year, back.month - 1, back.day, back.hour, back.minute, back.second) - wallUtc;
  return new Date(wallUtc - offset);
}

/**
 * The suggested retry after an unanswered call: +retryMinutes after the 1st and 2nd, then the next day at nextDayHour.
 * `unreachedAfter` counts this call. The operator may pick another time.
 */
export function suggestedRetryAt(unreachedAfter: number, now: Date, timeZone: string, policy: ConfirmationPolicy = DEFAULT_CONFIRMATION_POLICY): Date {
  if (unreachedAfter <= 2) return new Date(now.getTime() + policy.retryMinutes * 60_000);
  return nextDayAt(now, timeZone, policy.nextDayHour);
}

/** What an attempt does to the order's confirmation state. Pure — the service applies it inside the order's lock. */
export interface ConfirmationEffect {
  /** New unanswered count (only unanswered outcomes add one). */
  unreached: number;
  /** The next callback (Order.followUpAt); null clears it. */
  followUpAt: Date | null;
  /** Escalate now, and why (null: no change to escalation). */
  escalate: ConfirmationEscalationReason | null;
  /** Hand off to the order state machine. */
  transition: "CONFIRMED" | "CANCELLED" | null;
}

export function confirmationEffect(
  input: { outcome: ConfirmationOutcome; callbackAt?: Date | null },
  state: { unreached: number; extraAttempts: number },
  ctx: { now: Date; timeZone: string; policy: ConfirmationPolicy },
): ConfirmationEffect {
  const { outcome } = input;
  if (outcome === "CONFIRMED") return { unreached: state.unreached, followUpAt: null, escalate: null, transition: "CONFIRMED" };
  if (outcome === "DECLINED") return { unreached: state.unreached, followUpAt: null, escalate: null, transition: "CANCELLED" };
  if (outcome === "WRONG_NUMBER") return { unreached: state.unreached, followUpAt: null, escalate: "WRONG_NUMBER", transition: null };
  if (UNREACHED_OUTCOMES.includes(outcome)) {
    const unreached = state.unreached + 1;
    if (unreached >= ctx.policy.maxUnreached + state.extraAttempts) return { unreached, followUpAt: null, escalate: "UNREACHED_LIMIT", transition: null };
    return { unreached, followUpAt: input.callbackAt ?? suggestedRetryAt(unreached, ctx.now, ctx.timeZone, ctx.policy), escalate: null, transition: null };
  }
  // Callback / will-confirm-later (time required) and Other (time optional): the customer was reached.
  return { unreached: state.unreached, followUpAt: input.callbackAt ?? null, escalate: null, transition: null };
}

export const recordConfirmationAttemptSchema = z
  .object({
    outcome: z.enum(CONFIRMATION_OUTCOMES),
    note: z.string().trim().max(500).optional(),
    callbackAt: z.coerce.date().optional(),
  })
  .superRefine((v, ctx) => {
    if (CALLBACK_OUTCOMES.includes(v.outcome) && !v.callbackAt) ctx.addIssue({ code: "custom", path: ["callbackAt"], message: "Pick when to call back" });
    if ((v.outcome === "OTHER" || v.outcome === "DECLINED") && (v.note ?? "").length < 3) {
      ctx.addIssue({ code: "custom", path: ["note"], message: v.outcome === "DECLINED" ? "Say why the customer declined" : "Add a note about the call" });
    }
    if (v.callbackAt && v.outcome !== "OTHER" && !CALLBACK_OUTCOMES.includes(v.outcome) && !UNREACHED_OUTCOMES.includes(v.outcome)) {
      ctx.addIssue({ code: "custom", path: ["callbackAt"], message: "This outcome takes no callback time" });
    }
  });
export type RecordConfirmationAttemptInput = z.infer<typeof recordConfirmationAttemptSchema>;

/** Owner / manager decisions on an escalated order, and assigning an order's calls to an operator. */
export const confirmationDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), assigneeId: z.string().cuid().nullable() }),
  /** One more try past the limit: escalation lifted, the limit raised by one, a reprieve on the age rule. */
  z.object({ action: z.literal("retry"), reason: z.string().trim().min(3).max(300), callbackAt: z.coerce.date().optional() }),
  /** The phone was corrected (via the order's details): escalation lifted, unanswered count back to 0. */
  z.object({ action: z.literal("phone_fixed"), reason: z.string().trim().min(3).max(300) }),
]);
export type ConfirmationDecisionInput = z.infer<typeof confirmationDecisionSchema>;

export interface ConfirmationAttemptRow {
  id: string;
  outcome: ConfirmationOutcome;
  note: string | null;
  callbackAt: string | null;
  createdAt: string;
  admin: { id: string; name: string } | null;
}

/** The order's confirmation state, as the call panel shows it. */
export interface OrderConfirmationState {
  attempts: ConfirmationAttemptRow[];
  unreached: number;
  /** maxUnreached + extra tries granted. */
  limit: number;
  callbackAt: string | null;
  escalatedAt: string | null;
  escalationReason: ConfirmationEscalationReason | null;
  /** Escalated by age right now (unconfirmed longer than the policy allows, no reprieve). */
  staleEscalated: boolean;
  assignee: { id: string; name: string } | null;
  claimedBy: { id: string; name: string } | null;
  claimExpiresAt: string | null;
  /** The suggested retry if the next call goes unanswered (for the panel's default). */
  suggestedRetryAt: string;
  policy: ConfirmationPolicy;
}
