import { describe, it, expect } from "vitest";
import { allowedPollLevel, basePollIntervalMs, compareCourierStatuses, evaluateWebhookHealth, isPushedTransition, MAX_INTERVAL_MS, pollIntervalMs, type CourierHealthStats } from "./courier-sync-policy";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = new Date("2026-10-29T12:00:00Z");

const healthy = (over: Partial<CourierHealthStats> = {}): CourierHealthStats => ({
  windowHours: 48,
  events: { APPLIED: 180, DUPLICATE: 15, NO_ORDER: 5 },
  lastValidEventAt: new Date(now.getTime() - 20 * MIN),
  rejections: 0,
  compared: 150,
  disagreed: 2,
  changes: { WEBHOOK: 95, POLL: 3, ON_DEMAND: 2 },
  openParcels: 190,
  overdueParcels: 0,
  ...over,
});

describe("poll interval", () => {
  it("re-checks fresh parcels every 15 minutes and slows down with age", () => {
    expect(basePollIntervalMs(2 * HOUR)).toBe(15 * MIN);
    expect(basePollIntervalMs(5 * DAY)).toBe(HOUR);
    expect(basePollIntervalMs(74 * DAY)).toBe(6 * HOUR);
  });

  it("doubles per level and never goes past six hours (polling is never switched off)", () => {
    expect(pollIntervalMs(HOUR, 0)).toBe(15 * MIN);
    expect(pollIntervalMs(HOUR, 1)).toBe(30 * MIN);
    expect(pollIntervalMs(HOUR, 2)).toBe(60 * MIN);
    expect(pollIntervalMs(5 * DAY, 2)).toBe(4 * HOUR);
    expect(pollIntervalMs(40 * DAY, 2)).toBe(MAX_INTERVAL_MS);
    expect(pollIntervalMs(HOUR, 99)).toBe(60 * MIN); // clamped to the top level
    expect(pollIntervalMs(HOUR, -3)).toBe(15 * MIN);
  });
});

describe("webhook health", () => {
  it("is healthy only when every check passes", () => {
    const r = evaluateWebhookHealth(healthy(), now);
    expect(r.state).toBe("HEALTHY");
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("is not proven with no events — receiving none is never treated as healthy", () => {
    const r = evaluateWebhookHealth(healthy({ events: {}, lastValidEventAt: null, compared: 0, disagreed: 0, changes: { POLL: 40 } }), now);
    expect(r.state).toBe("NOT_PROVEN");
  });

  it("is not proven on a handful of events, even if each was fine", () => {
    expect(evaluateWebhookHealth(healthy({ events: { APPLIED: 3 } }), now).state).toBe("NOT_PROVEN");
  });

  it("is degraded by rejected calls, failures, disagreement with the status API, silence or polling falling behind", () => {
    expect(evaluateWebhookHealth(healthy({ rejections: 1 }), now).state).toBe("DEGRADED");
    expect(evaluateWebhookHealth(healthy({ events: { APPLIED: 100, FAILED: 10 } }), now).state).toBe("DEGRADED");
    expect(evaluateWebhookHealth(healthy({ compared: 100, disagreed: 20 }), now).state).toBe("DEGRADED");
    expect(evaluateWebhookHealth(healthy({ lastValidEventAt: new Date(now.getTime() - 9 * HOUR) }), now).state).toBe("DEGRADED");
    expect(evaluateWebhookHealth(healthy({ overdueParcels: 4 }), now).state).toBe("DEGRADED");
  });

  it("does not count as healthy while polling still catches most status changes first", () => {
    const r = evaluateWebhookHealth(healthy({ changes: { WEBHOOK: 30, POLL: 30 } }), now);
    expect(r.state).not.toBe("HEALTHY");
    expect(r.checks.find((c) => c.id === "coverage")?.ok).toBe(false);
  });
});

describe("poll level", () => {
  it("stays at 0 by default, whatever the webhook does (the operator's cap)", () => {
    expect(allowedPollLevel("HEALTHY", "HEALTHY", 0)).toBe(0);
  });

  it("steps down gradually: 1 after a healthy 48 h, 2 after a healthy week", () => {
    expect(allowedPollLevel("HEALTHY", "NOT_PROVEN", 2)).toBe(1);
    expect(allowedPollLevel("HEALTHY", "HEALTHY", 2)).toBe(2);
    expect(allowedPollLevel("HEALTHY", "HEALTHY", 1)).toBe(1);
  });

  it("returns to full polling the moment the last 48 h are not healthy", () => {
    expect(allowedPollLevel("DEGRADED", "HEALTHY", 2)).toBe(0);
    expect(allowedPollLevel("NOT_PROVEN", "HEALTHY", 2)).toBe(0);
  });
});

describe("how Steadfast actually reports (first live day, 2026-10-30)", () => {
  it("a rider's report awaiting Steadfast's approval, or ahead of the status API, is not a contradiction", () => {
    expect(compareCourierStatuses("cancelled", "cancelled")).toBe("SAME");
    expect(compareCourierStatuses("delivered", "delivered_approval_pending")).toBe("AWAITING_APPROVAL");
    expect(compareCourierStatuses("partial_delivered", "partial_delivered_approval_pending")).toBe("AWAITING_APPROVAL");
    expect(compareCourierStatuses("partial_delivered", "pending")).toBe("API_BEHIND");
    expect(compareCourierStatuses("delivered", "cancelled")).toBe("CONTRADICTION");
    expect(compareCourierStatuses("delivered", "hold")).toBe("CONTRADICTION");
    expect(compareCourierStatuses("pending", "delivered")).toBe("CONTRADICTION");
  });

  it("approvals and accepted bookings are never pushed, so they don't count against the webhook", () => {
    expect(isPushedTransition("delivered_approval_pending", "delivered")).toBe(false);
    expect(isPushedTransition("partial_delivered_approval_pending", "partial_delivered")).toBe(false);
    expect(isPushedTransition("in_review", "pending")).toBe(false);
    expect(isPushedTransition("pending", "delivered_approval_pending")).toBe(true);
    expect(isPushedTransition("pending", "cancelled")).toBe(true);
    expect(isPushedTransition(null, "pending")).toBe(true);
  });

  it("the live day's numbers read as healthy once the test call has left the window, and still fail on a real contradiction", () => {
    // 2026-10-30, Asif Zone: 357 calls, none failed; 56 compared — 14 same, 35 awaiting approval, 7 ahead of the API;
    // pushed changes 50 by webhook, 6 by poll (89%); 114 approvals / accepted bookings caught by poll, left out.
    const day = healthy({
      events: { APPLIED: 352, NO_ORDER: 3, NO_CONSIGNMENT: 2 },
      rejections: 0,
      compared: 56,
      disagreed: 0,
      awaitingApproval: 35,
      apiBehind: 7,
      changes: { WEBHOOK: 50, POLL: 6 },
      notPushed: 114,
      openParcels: 179,
    });
    expect(evaluateWebhookHealth(day, now).state).toBe("HEALTHY");
    expect(evaluateWebhookHealth({ ...day, disagreed: 5 }, now).state).toBe("DEGRADED");
    expect(evaluateWebhookHealth({ ...day, rejections: 1 }, now).state).toBe("DEGRADED");
    expect(evaluateWebhookHealth({ ...day, changes: { WEBHOOK: 40, POLL: 16 } }, now).state).not.toBe("HEALTHY");
  });
});
