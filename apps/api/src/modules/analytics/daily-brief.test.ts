import { describe, it, expect } from "vitest";
import { composeBrief, type BriefInput } from "./daily-brief";

const counts = (p: Partial<BriefInput["day"]> = {}): BriefInput["day"] => ({
  placed: 0,
  placed_web: 0,
  placed_landing: 0,
  placed_phone: 0,
  confirmed: 0,
  cancelled: 0,
  booked: 0,
  booked_cod_value: 0,
  shipped: 0,
  delivered: 0,
  partially_delivered: 0,
  returned: 0,
  ...p,
});

const base: BriefInput = {
  date: "2026-10-20", // a Tuesday
  currency: "BDT",
  day: counts({ placed: 34, confirmed: 30, booked: 30, delivered: 25, partially_delivered: 1, returned: 2, cancelled: 3 }),
  typical: counts({ placed: 28, confirmed: 25, booked: 24, delivered: 22, returned: 2, cancelled: 2 }),
  netSales: 18400,
  cashIn: 20100,
  topChannel: { label: "Facebook ads", orders: 12, conversionRate: 0.031 },
  queues: { awaitingConfirmation: 5, onHold: 2, holdsDue: 3, readyToBook: 7, withCourier: 40, withCourierCod: 31000, stuckWithCourier: 0, partialToReconcile: 0 },
  anomalies: [],
};

describe("composeBrief", () => {
  it("leads with orders and sales against the usual weekday", () => {
    const b = composeBrief(base);
    expect(b.headline).toBe("Tuesday: 34 orders (usual 28, +21%) · ৳18,400 net sales");
    expect(b.lines).toEqual([
      "30 sent to the courier · 25 delivered · 2 refused — 89% delivered in full",
      "৳20,100 cash in · 3 cancelled before sending",
      "Best channel: Facebook ads — 12 orders, 3.1% of visits ordered",
    ]);
  });

  it("lists what needs doing now, most urgent first, and skips empty queues", () => {
    expect(composeBrief(base).watch).toEqual(["3 call-backs are due", "7 confirmed orders not sent to the courier yet", "5 orders waiting to be confirmed"]);
  });

  it("puts anomalies first, in plain words", () => {
    const b = composeBrief({
      ...base,
      anomalies: [{ key: "returned", label: "Refused parcels", direction: "up", value: 9, expected: 2, changePct: 350, score: 4 }],
      queues: { ...base.queues, holdsDue: 0, readyToBook: 0, awaitingConfirmation: 0, stuckWithCourier: 12, partialToReconcile: 2 },
    });
    expect(b.watch).toEqual(["Refused parcels were up: 9 against a usual 2", "12 parcels with the courier for over 5 days", "2 part deliveries to reconcile"]);
    expect(b.unusual).toEqual(["Refused parcels were up: 9 against a usual 2"]);
    expect(b.todo).toEqual(["12 parcels with the courier for over 5 days", "2 part deliveries to reconcile"]);
  });

  it("a quiet day says so instead of inventing concerns", () => {
    const b = composeBrief({
      ...base,
      day: counts(),
      typical: counts(),
      netSales: 0,
      cashIn: 0,
      topChannel: null,
      queues: { awaitingConfirmation: 0, onHold: 0, holdsDue: 0, readyToBook: 0, withCourier: 0, withCourierCod: 0, stuckWithCourier: 0, partialToReconcile: 0 },
    });
    expect(b.headline).toBe("Tuesday: no orders");
    expect(b.lines).toEqual([]);
    expect(b.watch).toEqual([]);
  });
});
