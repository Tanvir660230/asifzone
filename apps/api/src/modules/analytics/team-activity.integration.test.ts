import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";

// Team activity (docs/superpowers/plans/2026-11-18-business-reports.md, Part 3): who moved which orders in a period,
// from the order status history. A fixed week long ago (Dhaka) so nothing else on the test database falls inside it.
const at = (date: string, hh: string, mm = "00") => new Date(`${date}T${hh}:${mm}:00+06:00`);
const FROM = at("2011-07-04", "00").toISOString();
const TO = at("2011-07-10", "23").toISOString();
const CSRF = "vitest-team";
let alice = "";
let bob = "";
let n = 0;

async function order(placedAt: Date, steps: Array<{ status: "CONFIRMED" | "CANCELLED" | "PACKED" | "SHIPPED" | "DELIVERED"; by: string | null; at: Date }>, variantId: string) {
  const o = await createManualOrder(
    { items: [{ variantId, quantity: 1 }], customerName: "Vitest Team", customerPhone: `0144${String(++n).padStart(7, "0")}`, shippingDivision: "Dhaka", shippingDistrict: "Dhaka", shippingArea: "Area", shippingAddressLine: "House 1", paymentMethod: "COD" } as never,
    await ownerId(),
  );
  trackOrder(o.id);
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } });
  await prisma.order.update({ where: { id: o.id }, data: { createdAt: placedAt } });
  await prisma.orderStatusHistory.createMany({
    data: [{ orderId: o.id, status: "PENDING", createdAt: placedAt }, ...steps.map((s) => ({ orderId: o.id, status: s.status, changedByAdminId: s.by, createdAt: s.at }))],
  });
}

beforeAll(async () => {
  const stamp = Date.now();
  alice = (await prisma.adminUser.create({ data: { name: "Vitest Alice", email: `vt-alice-${stamp}@example.com`, passwordHash: "x", role: "STAFF" } })).id;
  bob = (await prisma.adminUser.create({ data: { name: "Vitest Bob", email: `vt-bob-${stamp}@example.com`, passwordHash: "x", role: "STAFF" } })).id;
  const { variants } = await createStockedProduct({ stocks: [20], basePrice: 900 });
  const v = variants[0]!.id;
  // Alice confirms two orders (30 and 90 minutes after they came in) and packs one; Bob cancels one; the courier
  // (no admin) marks one shipped and delivered.
  await order(at("2011-07-05", "10"), [{ status: "CONFIRMED", by: alice, at: at("2011-07-05", "10", "30") }, { status: "PACKED", by: alice, at: at("2011-07-05", "15") }], v);
  await order(at("2011-07-06", "09"), [{ status: "CONFIRMED", by: alice, at: at("2011-07-06", "10", "30") }, { status: "SHIPPED", by: null, at: at("2011-07-07", "12") }, { status: "DELIVERED", by: null, at: at("2011-07-08", "12") }], v);
  await order(at("2011-07-06", "11"), [{ status: "CANCELLED", by: bob, at: at("2011-07-06", "12") }], v);
  // outside the week: not counted
  await order(at("2011-07-20", "11"), [{ status: "CONFIRMED", by: bob, at: at("2011-07-20", "12") }], v);
}, 60_000);

afterAll(async () => {
  await cleanupFixtures();
  await prisma.adminUser.deleteMany({ where: { id: { in: [alice, bob].filter(Boolean) } } });
  await prisma.$disconnect();
});

describe("team activity", () => {
  it("counts each admin's order moves in the period, with how fast they confirm", async () => {
    const res = await (await asOwner()).get(`/api/analytics/team?dateFrom=${FROM}&dateTo=${TO}`);
    expect(res.status).toBe(200);
    const a = res.body.people.find((p: { adminId: string }) => p.adminId === alice);
    const b = res.body.people.find((p: { adminId: string }) => p.adminId === bob);
    expect(a).toMatchObject({ name: "Vitest Alice", confirmed: 2, cancelled: 0, packed: 1, shipped: 0, total: 3, medianMinutesToConfirm: 60 });
    expect(b).toMatchObject({ name: "Vitest Bob", confirmed: 0, cancelled: 1, total: 1, medianMinutesToConfirm: null });
    // moves with no admin behind them — courier updates, automations
    expect(res.body.automatic).toMatchObject({ shipped: 1, delivered: 1 });
  });

  it("is for the owner only (who did what is audit information)", async () => {
    const cookie = [`access_token=${signAccessToken({ adminId: alice, role: "STAFF" })}`, `csrf_token=${CSRF}`];
    expect((await request(app).get(`/api/analytics/team?dateFrom=${FROM}&dateTo=${TO}`).set("Cookie", cookie).set("X-CSRF-Token", CSRF)).status).toBe(403);
    expect((await request(app).get(`/api/analytics/team?dateFrom=${FROM}&dateTo=${TO}`)).status).toBe(401);
  });
});
