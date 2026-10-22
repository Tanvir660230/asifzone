import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { OrderStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { getOpsDaily, getOpsPulse } from "./ops-pulse.service";

// A fixed Dhaka business day long ago (UTC+6), so no other test's orders fall inside it.
const DAY = "2004-03-10";
const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+06:00`);
const RUN = `vt-ops-${Date.now()}`;
let admin: string;
const ids: Record<string, string> = {};

/** An order placed at `placedAt` whose history is exactly `history` (status, local time, by admin?). */
async function order(key: string, opts: { placedAt: Date; source: "phone" | "web" | "landing"; history: Array<[OrderStatus, Date, boolean]>; status: OrderStatus; bookedAt?: Date; trashed?: boolean }) {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
  const o = await createManualOrder(
    {
      items: [{ variantId: variants[0]!.id, quantity: 1 }],
      customerName: "Vitest Ops",
      customerPhone: `0171${String(Object.keys(ids).length).padStart(7, "0")}`,
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
    } as never,
    admin,
  );
  trackOrder(o.id);
  ids[key] = o.id;
  const sessionId = opts.source === "phone" ? null : `${RUN}-${key}`;
  if (opts.source === "landing") await prisma.pageView.create({ data: { sessionId: sessionId!, path: "/lp/summer-panjabi", createdAt: opts.placedAt } });
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } });
  await prisma.orderStatusHistory.createMany({
    data: [
      { orderId: o.id, status: "PENDING", createdAt: opts.placedAt, changedByAdminId: opts.source === "phone" ? admin : null },
      ...opts.history.map(([status, createdAt, byAdmin]) => ({ orderId: o.id, status, createdAt, changedByAdminId: byAdmin ? admin : null })),
    ],
  });
  await prisma.order.update({
    where: { id: o.id },
    data: { createdAt: opts.placedAt, sessionId, status: opts.status, courierBookedAt: opts.bookedAt ?? null, deletedAt: opts.trashed ? new Date() : null },
  });
  return o;
}

let bookedTotal = 0;

beforeAll(async () => {
  admin = await ownerId();
  await order("phone", { placedAt: local(DAY, "09:00"), source: "phone", status: "CONFIRMED", history: [["CONFIRMED", local(DAY, "09:00"), true]] });
  await order("web", {
    placedAt: local(DAY, "10:00"),
    source: "web",
    status: "SHIPPED",
    history: [
      ["CONFIRMED", local(DAY, "11:00"), true],
      ["CONFIRMED", local(DAY, "11:30"), true], // a second CONFIRMED entry is not a second confirmation
      ["SHIPPED", local(DAY, "18:00"), false],
    ],
    bookedAt: local(DAY, "15:00"),
  });
  await order("landing", { placedAt: local(DAY, "23:30"), source: "landing", status: "CANCELLED", history: [["CANCELLED", local(DAY, "23:45"), true]] });
  // Booked, then the courier brought it back (Steadfast "cancelled" after booking) — a refusal, not a cancellation.
  await order("refused", {
    placedAt: local(DAY, "08:00"),
    source: "web",
    status: "CANCELLED",
    history: [
      ["PACKED", local(DAY, "09:00"), false],
      ["CANCELLED", local(DAY, "20:00"), false],
    ],
    bookedAt: local(DAY, "09:00"),
  });
  // PENDING → PACKED with no CONFIRMED entry (the usual COD path): still confirmed, once.
  await order("packed", { placedAt: local(DAY, "08:30"), source: "web", status: "PACKED", history: [["PACKED", local(DAY, "12:00"), false]] });
  // Placed the day before, delivered on DAY — counts as a delivery on DAY, not as an order placed or confirmed.
  await order("old", {
    placedAt: local("2004-03-09", "12:00"),
    source: "web",
    status: "DELIVERED",
    history: [
      ["PACKED", local("2004-03-09", "13:00"), false],
      ["DELIVERED", local(DAY, "14:00"), false],
    ],
  });
  // Trashed: never counted.
  await order("trashed", { placedAt: local(DAY, "12:00"), source: "web", status: "PENDING", history: [], trashed: true });
  // Same weekday a week earlier: 2 orders, for the comparison.
  await order("lastweek-a", { placedAt: local("2004-03-03", "09:30"), source: "web", status: "PENDING", history: [] });
  await order("lastweek-b", { placedAt: local("2004-03-03", "20:00"), source: "web", status: "PENDING", history: [] });
  for (const key of ["web", "refused"]) bookedTotal += Number((await prisma.order.findUniqueOrThrow({ where: { id: ids[key]! } })).total);
});

afterAll(async () => {
  await prisma.pageView.deleteMany({ where: { sessionId: { startsWith: RUN } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("daily pulse", () => {
  it("counts the day's operations, each order once per stage, by business day and source", async () => {
    const { days } = await getOpsDaily(DAY, DAY);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      date: DAY,
      placed: 5,
      placed_phone: 1,
      placed_web: 3,
      placed_landing: 1,
      confirmed: 4, // phone, web (two CONFIRMED entries = one), refused and packed (PACKED with no CONFIRMED)
      cancelled: 1, // the landing order, cancelled before any booking
      booked: 2,
      booked_cod_value: bookedTotal,
      shipped: 1,
      delivered: 1,
      returned: 1, // the refused parcel
    });
  });

  it("compares with last week's same weekday and reports the day's staff work and where its orders stand", async () => {
    const pulse = await getOpsPulse(DAY);
    expect(pulse.partialDay).toBe(false);
    expect(pulse.day.placed).toBe(5);
    expect(pulse.lastWeek.placed).toBe(2);
    expect(pulse.typical.placed).toBe(0.5); // 2 + 0 + 0 + 0 over four weeks
    expect(pulse.hourly[9]).toMatchObject({ day: 1, typical: 0.25 });
    // phone + packed confirmed (not booked), web with the courier, landing cancelled before booking, refused returned
    expect(pulse.cohort).toMatchObject({ placed: 5, confirmed: 2, withCourier: 1, cancelled: 1, returned: 1, delivered: 0 });
    const me = pulse.staff.find((s) => s.adminId === admin)!;
    expect(me).toMatchObject({ confirmed: 3, cancelled: 1 }); // every entry an admin made counts as work done
    expect(pulse.queues.withCourier).toBeGreaterThanOrEqual(1); // the web order: booked, shipped, not delivered
  });

  it("is reachable over the API and rejects bad dates", async () => {
    const agent = await asOwner();
    const ok = await agent.get(`/api/analytics/ops-pulse?date=${DAY}`);
    expect(ok.status).toBe(200);
    expect(ok.body.day.placed).toBe(5);
    const daily = await agent.get(`/api/analytics/ops-daily?from=2004-03-03&to=${DAY}`);
    expect(daily.status).toBe(200);
    expect(daily.body.days).toHaveLength(8);
    expect(daily.body.totals.placed).toBe(8); // 5 on DAY + 1 the day before + 2 a week earlier
    expect((await agent.get("/api/analytics/ops-pulse?date=10-03-2004")).status).toBe(400);
    expect((await agent.get("/api/analytics/ops-daily?from=2004-03-10")).status).toBe(400);
    expect((await agent.get("/api/analytics/ops-pulse?date=2999-01-01")).status).toBe(400);
  });
});
