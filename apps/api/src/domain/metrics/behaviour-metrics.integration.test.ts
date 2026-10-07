import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../../modules/orders/order.service";
import { computeMetrics } from "./metrics.service";

// D25 (owner, 2026-10-08): conversion rate = sale orders placed from a storefront session ÷ storefront sessions.
// A fixed day long ago, so no other test's pageviews or orders fall inside the range.
const DAY = "2003-06-15";
const AT = new Date(`${DAY}T06:00:00Z`);
const RUN = `vt-d25-${Date.now()}`;
const range = { from: DAY, to: DAY };

beforeAll(async () => {
  const admin = await ownerId();
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
  const place = async (phone: string, sessionId: string | null) => {
    const o = await createManualOrder(
      {
        items: [{ variantId: variants[0]!.id, quantity: 1 }],
        customerName: "Vitest D25",
        customerPhone: phone,
        shippingDivision: "Dhaka",
        shippingDistrict: "Dhaka",
        shippingArea: "Uttara",
        shippingAddressLine: "House 1",
        paymentMethod: "COD",
      } as never,
      admin,
    );
    trackOrder(o.id);
    await prisma.order.update({ where: { id: o.id }, data: { createdAt: AT, sessionId } });
  };
  await place("01712345681", `${RUN}-a`); // a storefront order
  await place("01712345682", null); // a phone order — no session, not a conversion
  // Four sessions; one of them viewed two pages.
  await prisma.pageView.createMany({
    data: ["a", "a", "b", "c", "d"].map((s) => ({ sessionId: `${RUN}-${s}`, path: "/", createdAt: AT })),
  });
});

afterAll(async () => {
  await prisma.pageView.deleteMany({ where: { sessionId: { startsWith: RUN } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("behaviour metrics", () => {
  it("counts distinct sessions and converts with session-carrying orders only (D25)", async () => {
    const m = await computeMetrics({ metrics: ["sessions", "conversion_rate", "orders_placed"], range, fresh: true });
    expect(m.metrics.sessions!.value).toBe(4);
    expect(m.metrics.orders_placed!.value).toBe(2);
    expect(m.metrics.conversion_rate!.value).toBeCloseTo(1 / 4, 6);
    expect(m.metrics.conversion_rate!.unit).toBe("ratio");
  });

  it("return rate is 0 (not NaN) when nothing was sold in the range", async () => {
    const m = await computeMetrics({ metrics: ["return_rate"], range, fresh: true });
    expect(m.metrics.return_rate!.value).toBe(0);
  });
});
