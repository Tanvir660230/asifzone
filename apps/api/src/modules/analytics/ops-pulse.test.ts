import { describe, it, expect } from "vitest";
import { compareOps, countOps, hourlyPlaced, type OpsEvent } from "./ops-pulse";

const TZ = "Asia/Dhaka"; // UTC+6, no DST
// Local Dhaka wall clock → UTC instant.
const at = (date: string, hhmm: string) => new Date(new Date(`${date}T${hhmm}:00+06:00`).toISOString());
const ev = (kind: OpsEvent["kind"], date: string, hhmm: string, extra: Partial<OpsEvent> = {}): OpsEvent => ({
  kind,
  at: at(date, hhmm),
  orderId: `${kind}-${date}-${hhmm}`,
  ...extra,
});

describe("countOps", () => {
  it("counts each kind on the business day it happened, splitting placed orders by source and summing booked COD", () => {
    const events: OpsEvent[] = [
      ev("placed", "2026-10-20", "00:10", { source: "web" }),
      ev("placed", "2026-10-20", "09:00", { source: "landing" }),
      ev("placed", "2026-10-20", "23:59", { source: "phone" }),
      ev("placed", "2026-10-21", "00:00", { source: "web" }), // next business day
      ev("booked", "2026-10-20", "12:00", { codValue: 125_000 }),
      ev("booked", "2026-10-20", "13:00", { codValue: 0 }),
      ev("delivered", "2026-10-20", "15:00"),
      ev("returned", "2026-10-20", "16:00"),
    ];
    const days = countOps(events, ["2026-10-20", "2026-10-21"], TZ);
    expect(days["2026-10-20"]).toMatchObject({
      placed: 3,
      placed_web: 1,
      placed_landing: 1,
      placed_phone: 1,
      booked: 2,
      booked_cod_value: 125_000,
      delivered: 1,
      returned: 1,
      confirmed: 0,
    });
    expect(days["2026-10-21"]).toMatchObject({ placed: 1, placed_web: 1, booked: 0 });
  });

  it("with a cutoff, only counts what happened before that time of day (a fair 'by this time' comparison)", () => {
    const events = [ev("placed", "2026-10-20", "10:00", { source: "web" }), ev("placed", "2026-10-20", "18:00", { source: "web" })];
    const elevenAm = 11 * 3_600_000;
    expect(countOps(events, ["2026-10-20"], TZ, elevenAm)["2026-10-20"]!.placed).toBe(1);
    expect(countOps(events, ["2026-10-20"], TZ)["2026-10-20"]!.placed).toBe(2);
  });
});

describe("compareOps", () => {
  it("compares the day with yesterday, the same weekday last week and the 4-week same-weekday average", () => {
    const placedOn = (date: string, n: number) => Array.from({ length: n }, (_, i) => ev("placed", date, `0${i % 10}:0${i % 6}`, { source: "web", orderId: `${date}-${i}` }));
    const events = [
      ...placedOn("2026-10-21", 10), // the day (Wednesday)
      ...placedOn("2026-10-20", 8), // yesterday
      ...placedOn("2026-10-14", 5), // −7
      ...placedOn("2026-10-07", 7), // −14
      ...placedOn("2026-09-30", 4), // −21
      ...placedOn("2026-09-23", 8), // −28
    ];
    const c = compareOps(events, "2026-10-21", TZ);
    expect(c.day.placed).toBe(10);
    expect(c.yesterday.placed).toBe(8);
    expect(c.lastWeek.placed).toBe(5);
    expect(c.typical.placed).toBe(6); // (5 + 7 + 4 + 8) / 4
  });
});

describe("hourlyPlaced", () => {
  it("buckets the day's placed orders by local hour against the same-weekday average", () => {
    const events = [
      ev("placed", "2026-10-21", "09:15", { source: "web" }),
      ev("placed", "2026-10-21", "09:45", { source: "web" }),
      ev("placed", "2026-10-14", "09:30", { source: "web" }),
      ev("placed", "2026-10-07", "21:00", { source: "web" }),
    ];
    const hours = hourlyPlaced(events, "2026-10-21", TZ);
    expect(hours).toHaveLength(24);
    expect(hours[9]).toEqual({ hour: 9, day: 2, typical: 0.25 });
    expect(hours[21]).toEqual({ hour: 21, day: 0, typical: 0.25 });
  });
});
