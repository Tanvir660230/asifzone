import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { OrderStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { getOrderRisk } from "./order-risk.service";

const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+06:00`);
const PHONE = `0188${String(Date.now()).slice(-7)}`;

async function order(opts: { phone: string; placedAt: Date; status: OrderStatus; bookedAt?: Date; history?: Array<[OrderStatus, Date]>; price?: number }) {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: opts.price ?? 900 });
  const o = await createManualOrder(
    {
      items: [{ variantId: variants[0]!.id, quantity: 1 }],
      customerName: "Vitest Risk",
      customerPhone: opts.phone,
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Area",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
    } as never,
    await ownerId(),
  );
  trackOrder(o.id);
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } });
  await prisma.orderStatusHistory.createMany({
    data: [{ orderId: o.id, status: "PENDING" as OrderStatus, createdAt: opts.placedAt }, ...(opts.history ?? []).map(([status, createdAt]) => ({ orderId: o.id, status, createdAt }))],
  });
  await prisma.order.update({ where: { id: o.id }, data: { createdAt: opts.placedAt, status: opts.status, courierBookedAt: opts.bookedAt ?? null } });
  return o;
}

let risky: string;
let fresh: string;
let earliest: string;
let refusedTotals = 0;

beforeAll(async () => {
  const b1 = local("2007-01-02", "12:00");
  // Earliest order from the phone: delivered.
  earliest = (await order({ phone: PHONE, placedAt: local("2007-01-01", "10:00"), status: "DELIVERED", bookedAt: b1, history: [["PACKED", b1], ["DELIVERED", local("2007-01-03", "12:00")]] })).id;
  // Two refusals — the second written with the +880 prefix.
  const b2 = local("2007-02-02", "12:00");
  const r1 = await order({ phone: PHONE, placedAt: local("2007-02-01", "10:00"), status: "CANCELLED", bookedAt: b2, history: [["PACKED", b2], ["CANCELLED", local("2007-02-04", "12:00")]] });
  const b3 = local("2007-03-02", "12:00");
  const r2 = await order({ phone: `+88${PHONE}`, placedAt: local("2007-03-01", "10:00"), status: "CANCELLED", bookedAt: b3, history: [["PACKED", b3], ["CANCELLED", local("2007-03-04", "12:00")]] });
  for (const r of [r1, r2]) refusedTotals += Number((await prisma.order.findUniqueOrThrow({ where: { id: r.id } })).total);
  // Cancelled before it was ever booked: not a refusal.
  await order({ phone: PHONE, placedAt: local("2007-04-01", "10:00"), status: "CANCELLED", history: [["CANCELLED", local("2007-04-01", "11:00")]] });
  // The order being judged.
  risky = (await order({ phone: PHONE, placedAt: local("2007-05-01", "10:00"), status: "PENDING" })).id;
  // A brand-new phone placing a big first order.
  fresh = (await order({ phone: `0177${String(Date.now()).slice(-7)}`, placedAt: local("2007-05-01", "11:00"), status: "PENDING", price: 2500 })).id;
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("order risk", () => {
  it("reads the phone's earlier orders across spellings, by their real outcome", async () => {
    const r = await getOrderRisk([risky, fresh, earliest]);
    expect(r[risky]!.history).toEqual({ delivered: 1, partial: 0, refused: 2, cancelledBeforeBooking: 1, open: 0, refusedCodValue: refusedTotals });
    expect(r[risky]!.level).toBe("high");
    expect(r[risky]!.reasons[0]).toMatch(/^Refused 2 parcels here before \(৳/);
    expect(r[fresh]).toMatchObject({ level: "medium", reasons: ["First order, ৳2,000 or more"] });
    // Only EARLIER orders count: the first order from the phone has no history.
    expect(r[earliest]!.history.delivered + r[earliest]!.history.refused).toBe(0);
  });

  it("is an orders.read lookup with a size limit", async () => {
    const agent = await asOwner();
    const ok = await agent.get(`/api/analytics/order-risk?orders=${risky},${fresh}`);
    expect(ok.status).toBe(200);
    expect(ok.body.orders[risky].level).toBe("high");
    const tooMany = Array.from({ length: 101 }, (_, i) => `x${i}`).join(",");
    expect((await agent.get(`/api/analytics/order-risk?orders=${tooMany}`)).status).toBe(400);
  });
});
