/**
 * How often a booked parcel's courier status is re-checked, and when the Steadfast webhook has earned less polling
 * (Order Operations plan, Phase 0). Pure — the numbers come from courier-health.service.ts.
 *
 * Polling is the backstop and never stops: every open parcel is re-checked at least every MAX_INTERVAL. Its pace depends on
 * two things only. The parcel's age — a fresh parcel changes within days (median 2.3 days from booking to a final status in
 * production data, Oct 2026), an old one rarely changes at all. And the poll level — 0 until the webhook has been measured healthy
 * for a full 48 hours, 1 after that, 2 after a healthy week — capped by COURIER_POLL_MAX_LEVEL, which an operator raises by
 * hand once the observation gate is passed (default 0: webhook events arriving never reduce polling on their own).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const MAX_INTERVAL_MS = 6 * HOUR;
export const MAX_POLL_LEVEL = 2;

/** Level-0 interval by parcel age: the pace before the webhook has proven anything. */
export function basePollIntervalMs(ageMs: number): number {
  if (ageMs < 3 * DAY) return 15 * MINUTE;
  if (ageMs < 10 * DAY) return HOUR;
  return MAX_INTERVAL_MS;
}

/** Each level doubles the interval, never past MAX_INTERVAL_MS. */
export function pollIntervalMs(ageMs: number, level: number): number {
  const lv = Math.max(0, Math.min(MAX_POLL_LEVEL, Math.floor(level)));
  return Math.min(MAX_INTERVAL_MS, basePollIntervalMs(ageMs) * 2 ** lv);
}

/** What was observed over one window (courier-health.service.ts `courierHealthStats`). */
export interface CourierHealthStats {
  windowHours: number;
  /** Webhook calls that passed the token check, by outcome (APPLIED, DUPLICATE, NO_ORDER, NO_CONSIGNMENT, FAILED). */
  events: Record<string, number>;
  lastValidEventAt: Date | null;
  /** Webhook calls refused at the token check. */
  rejections: number;
  /** Events whose body named a status that Steadfast's status API also answered, and how many of those disagreed. */
  compared: number;
  disagreed: number;
  /** Courier status changes, by how we learned of them: WEBHOOK, or POLL / ON_DEMAND (the webhook didn't bring it first). */
  changes: Record<string, number>;
  /** Booked parcels still open, and how many of them are overdue for a re-check (polling has fallen behind). */
  openParcels: number;
  overdueParcels: number;
}

export type WebhookHealthState = "HEALTHY" | "NOT_PROVEN" | "DEGRADED";

export interface WebhookHealthCheck {
  id: "events" | "recent" | "rejections" | "failures" | "agreement" | "coverage" | "polling";
  ok: boolean;
  detail: string;
}

/** The evidence a healthy webhook must show before polling may slow down. A check that lacks data counts as not passed. */
export const HEALTH_RULES = {
  minEvents: 20,
  maxSilenceHours: 6,
  maxFailureShare: 0.02,
  maxDisagreementShare: 0.05,
  minChangesForCoverage: 10,
  minWebhookShareOfChanges: 0.9,
} as const;

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** NOT_PROVEN: not enough evidence yet (no events, too few to judge). DEGRADED: evidence of a problem. */
export function evaluateWebhookHealth(s: CourierHealthStats, now: Date): { state: WebhookHealthState; checks: WebhookHealthCheck[] } {
  const total = Object.values(s.events).reduce((a, b) => a + b, 0);
  const failed = s.events.FAILED ?? 0;
  const viaWebhook = s.changes.WEBHOOK ?? 0;
  const allChanges = Object.values(s.changes).reduce((a, b) => a + b, 0);
  const silentHours = s.lastValidEventAt ? (now.getTime() - s.lastValidEventAt.getTime()) / HOUR : Infinity;

  const checks: WebhookHealthCheck[] = [
    { id: "events", ok: total >= HEALTH_RULES.minEvents, detail: `${total} authenticated webhook call(s) in ${s.windowHours} h (need ${HEALTH_RULES.minEvents})` },
    {
      id: "recent",
      ok: s.openParcels === 0 || silentHours <= HEALTH_RULES.maxSilenceHours,
      detail: s.lastValidEventAt ? `last authenticated call ${Math.round(silentHours * 10) / 10} h ago` : "no authenticated call yet",
    },
    { id: "rejections", ok: s.rejections === 0, detail: `${s.rejections} call(s) refused at the token check` },
    { id: "failures", ok: total > 0 && share(failed, total) <= HEALTH_RULES.maxFailureShare, detail: `${failed} failed of ${total} (${pct(share(failed, total))})` },
    {
      id: "agreement",
      ok: s.compared > 0 && share(s.disagreed, s.compared) <= HEALTH_RULES.maxDisagreementShare,
      detail: `${s.disagreed} of ${s.compared} webhook status(es) differed from Steadfast's status API`,
    },
    {
      id: "coverage",
      ok: allChanges >= HEALTH_RULES.minChangesForCoverage && share(viaWebhook, allChanges) >= HEALTH_RULES.minWebhookShareOfChanges,
      detail: `${viaWebhook} of ${allChanges} status change(s) arrived by webhook first (${pct(share(viaWebhook, allChanges))})`,
    },
    { id: "polling", ok: s.overdueParcels === 0, detail: `${s.overdueParcels} of ${s.openParcels} open parcel(s) overdue for a re-check` },
  ];

  const problem =
    s.rejections > 0 ||
    (total > 0 && share(failed, total) > HEALTH_RULES.maxFailureShare) ||
    (s.compared > 0 && share(s.disagreed, s.compared) > HEALTH_RULES.maxDisagreementShare) ||
    s.overdueParcels > 0 ||
    (s.lastValidEventAt !== null && s.openParcels > 0 && silentHours > HEALTH_RULES.maxSilenceHours);
  const state: WebhookHealthState = checks.every((c) => c.ok) ? "HEALTHY" : problem ? "DEGRADED" : "NOT_PROVEN";
  return { state, checks };
}

/** The level polling may run at: 1 after a healthy 48 h, 2 after a healthy week — never above the operator's cap. Any
 * check failing in the last 48 h drops straight back to 0. */
export function allowedPollLevel(last48h: WebhookHealthState, lastWeek: WebhookHealthState, maxLevel: number): number {
  const cap = Math.max(0, Math.min(MAX_POLL_LEVEL, Math.floor(maxLevel)));
  if (last48h !== "HEALTHY") return 0;
  return Math.min(cap, lastWeek === "HEALTHY" ? 2 : 1);
}
