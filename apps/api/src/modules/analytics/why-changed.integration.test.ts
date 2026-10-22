import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { getWhyChanged } from "./why-changed.service";

// Previous week 2010-01-04..10, report week 2010-01-11..17 (Dhaka).
const at = (date: string, hh = "12") => new Date(`${date}T${hh}:00:00+06:00`);
const RUN = `vt-why-${Date.now()}`;
const FROM = at("2010-01-11", "00");
const TO = at("2010-01-17", "12");
let n = 0;

async function sessions(date: string, count: number, tag: string) {
  await prisma.pageView.createMany({ data: Array.from({ length: count }, (_, i) => ({ sessionId: `${RUN}-${tag}-${i}`, path: "/", createdAt: at(date, "10") })) });
}

async function deliveredOrder(date: string, district: string, sessionId: string, variantId: string) {
  const o = await createManualOrder(
    {
      items: [{ variantId, quantity: 1 }],
      customerName: "Vitest Why",
      customerPhone: `0144${String(++n).padStart(7, "0")}`,
      shippingDivision: "Dhaka",
      shippingDistrict: district,
      shippingArea: "Area",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
    } as never,
    await ownerId(),
  );
  trackOrder(o.id);
  // A storefront order (session, no admin on its first entry), delivered the same day.
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } });
  await prisma.orderStatusHistory.createMany({
    data: [
      { orderId: o.id, status: "PENDING", createdAt: at(date, "11") },
      { orderId: o.id, status: "DELIVERED", createdAt: at(date, "18") },
    ],
  });
  await prisma.order.update({ where: { id: o.id }, data: { createdAt: at(date, "11"), sessionId, status: "DELIVERED" } });
}

beforeAll(async () => {
  const { variants } = await createStockedProduct({ stocks: [50], basePrice: 1000 });
  const v = variants[0]!.id;
  await sessions("2010-01-05", 100, "prev");
  await deliveredOrder("2010-01-05", "Dhaka", `${RUN}-prev-0`, v);
  await deliveredOrder("2010-01-05", "Dhaka", `${RUN}-prev-1`, v);
  await sessions("2010-01-12", 200, "cur");
  for (let i = 0; i < 4; i++) await deliveredOrder("2010-01-12", "Sylhet", `${RUN}-cur-${i}`, v);
  for (let i = 4; i < 6; i++) await deliveredOrder("2010-01-12", "Dhaka", `${RUN}-cur-${i}`, v);
}, 60_000);

afterAll(async () => {
  await prisma.pageView.deleteMany({ where: { sessionId: { startsWith: RUN } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("why did it change", () => {
  it("splits the change in website orders into visitors and conversion, exactly", async () => {
    const r = await getWhyChanged(undefined, FROM, TO);
    expect(r.previous).toEqual({ from: "2010-01-04", to: "2010-01-10" });
    expect(r.numbers.before).toMatchObject({ sessions: 100, webOrders: 2, realisedOrders: 2 });
    expect(r.numbers.after).toMatchObject({ sessions: 200, webOrders: 6, realisedOrders: 6 });
    expect(r.webOrders.total).toBe(4);
    expect(r.webOrders.effects.visits).toBeGreaterThan(0);
    expect(r.webOrders.effects.conversion).toBeGreaterThan(0); // 2% → 3%
    expect(r.webOrders.effects.visits + r.webOrders.effects.conversion).toBeCloseTo(4, 9);
    // Same price every time: all of the sales change is more orders, none is order value.
    expect(r.netSales.effects.orderValue).toBeCloseTo(0, 6);
    expect(r.netSales.effects.orders).toBeCloseTo(r.netSales.total, 6);
  });

  it("names the movers", async () => {
    const r = await getWhyChanged(undefined, FROM, TO);
    expect(r.movers.districts.up[0]).toMatchObject({ key: "Sylhet", before: 0 });
    expect(r.movers.districts.down).toEqual([]);
  });

  it("is reachable over the API", async () => {
    const res = await (await asOwner()).get(`/api/analytics/why-changed?dateFrom=${FROM.toISOString()}&dateTo=${TO.toISOString()}`);
    expect(res.status).toBe(200);
    expect(res.body.webOrders.total).toBe(4);
  });
});
