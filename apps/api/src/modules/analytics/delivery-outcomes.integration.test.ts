import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { OrderStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { getDeliveryOutcomes } from "./delivery-outcomes.service";

// A fixed Dhaka business week long ago, so no other test's parcels finish inside it.
const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+06:00`);
const FROM = local("2006-07-03", "00:00");
const TO = local("2006-07-09", "12:00");
let n = 0;

async function parcel(opts: { district: string; phone?: string; history: Array<[OrderStatus, Date]>; status: OrderStatus; bookedAt: Date | null; placedAt?: Date }) {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 800 });
  const o = await createManualOrder(
    {
      items: [{ variantId: variants[0]!.id, quantity: 1 }],
      customerName: "Vitest Delivery",
      customerPhone: opts.phone ?? `0191${String(++n).padStart(7, "0")}`,
      shippingDivision: "Dhaka",
      shippingDistrict: opts.district,
      shippingArea: "Area",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
    } as never,
    await ownerId(),
  );
  trackOrder(o.id);
  const placed = opts.placedAt ?? local("2006-07-01", "10:00");
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } });
  await prisma.orderStatusHistory.createMany({
    data: [{ orderId: o.id, status: "PENDING" as OrderStatus, createdAt: placed }, ...opts.history.map(([status, createdAt]) => ({ orderId: o.id, status, createdAt }))],
  });
  await prisma.order.update({ where: { id: o.id }, data: { createdAt: placed, status: opts.status, courierBookedAt: opts.bookedAt } });
  return o;
}

const booked = local("2006-07-02", "12:00");
let refusedTotal = 0;

beforeAll(async () => {
  await parcel({ district: "Bogura", status: "DELIVERED", bookedAt: booked, history: [["PACKED", booked], ["DELIVERED", local("2006-07-04", "12:00")]] });
  await parcel({ district: "Bogura", status: "DELIVERED", bookedAt: booked, history: [["PACKED", booked], ["DELIVERED", local("2006-07-05", "12:00")]] });
  // Delivered, later returned by the customer: still a delivery.
  await parcel({ district: "Bogura", status: "RETURNED", bookedAt: booked, history: [["PACKED", booked], ["DELIVERED", local("2006-07-04", "18:00")], ["RETURNED", local("2006-07-08", "10:00")]] });
  // Refused at the door: Steadfast cancels after booking. Same phone refuses twice.
  const r1 = await parcel({ district: "Rangpur", phone: "01999999901", status: "CANCELLED", bookedAt: booked, history: [["PACKED", booked], ["CANCELLED", local("2006-07-06", "12:00")]] });
  await parcel({ district: "Rangpur", phone: "01999999901", status: "CANCELLED", bookedAt: booked, placedAt: local("2006-07-01", "11:00"), history: [["PACKED", booked], ["CANCELLED", local("2006-07-07", "12:00")]] });
  await parcel({ district: "Rangpur", status: "PARTIALLY_DELIVERED", bookedAt: booked, history: [["PACKED", booked], ["PARTIALLY_DELIVERED", local("2006-07-05", "12:00")]] });
  // Cancelled before booking: never a parcel.
  await parcel({ district: "Rangpur", status: "CANCELLED", bookedAt: null, history: [["CANCELLED", local("2006-07-04", "12:00")]] });
  // Still with the courier: not finished.
  await parcel({ district: "Rangpur", status: "PACKED", bookedAt: booked, history: [["PACKED", booked]] });
  refusedTotal = Number((await prisma.order.findUniqueOrThrow({ where: { id: r1.id } })).total) * 2;
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("delivery outcomes", () => {
  it("counts finished parcels by their first outcome; a later customer return stays a delivery", async () => {
    const r = await getDeliveryOutcomes(undefined, FROM, TO);
    expect(r.totals).toMatchObject({ parcels: 6, delivered: 3, partial: 1, refused: 2, refusedCodValue: refusedTotal });
    expect(r.totals.successRate).toBeCloseTo(0.5);
    expect(r.byDistrict.find((d) => d.key === "Bogura")).toMatchObject({ parcels: 3, delivered: 3, refused: 0 });
    expect(r.byDistrict.find((d) => d.key === "Rangpur")).toMatchObject({ parcels: 3, refused: 2, partial: 1 });
    expect(r.repeatRefusers).toEqual([expect.objectContaining({ phone: "01999999901", refused: 2, delivered: 0 })]);
    // The second order from the refusing phone is a returning customer.
    expect(r.byCustomer.find((c) => c.key === "Returning customer")).toMatchObject({ parcels: 1, refused: 1 });
    expect(r.byPayment).toEqual([expect.objectContaining({ key: "Cash on delivery", parcels: 6 })]);
  });

  it("is reachable over the API", async () => {
    const res = await (await asOwner()).get(`/api/analytics/delivery-outcomes?dateFrom=${FROM.toISOString()}&dateTo=${TO.toISOString()}`);
    expect(res.status).toBe(200);
    expect(res.body.totals.parcels).toBe(6);
  });
});
