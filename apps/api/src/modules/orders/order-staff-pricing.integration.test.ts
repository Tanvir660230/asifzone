import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "./order.service";
import { getOrderPaymentSummary } from "../../domain/payments/payment-ledger.service";

// A phone order entered from the dashboard at the price agreed on the call: free delivery and/or the exact amount the
// customer will pay. The total is set before the order is written, so the courier's COD and the books agree from the
// start; the difference is the order's price adjustment, on the timeline with the reason.

let owner: string;
let variantId: string;
const base = (overrides: Record<string, unknown> = {}) =>
  ({
    items: [{ variantId, quantity: 2 }],
    customerName: "Vitest Staff Pricing",
    customerPhone: "01712345601",
    shippingDivision: "Dhaka",
    shippingDistrict: "Dhaka",
    shippingArea: "Uttara",
    shippingAddressLine: "House 1",
    paymentMethod: "COD",
    ...overrides,
  }) as never;

beforeAll(async () => {
  owner = await ownerId();
  const { variants } = await createStockedProduct({ stocks: [20], basePrice: 650 });
  variantId = variants[0]!.id;
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("staff pricing on a manual order", () => {
  it("free delivery: the delivery charge is waived and the total is the goods only", async () => {
    const plain = await createManualOrder(base(), owner);
    trackOrder(plain.id);
    const free = await createManualOrder(base({ customerPhone: "01712345602", freeDelivery: true }), owner);
    trackOrder(free.id);
    expect(Number(plain.shippingFee)).toBeGreaterThan(0);
    expect(free.shippingWaived).toBe(true);
    expect(Number(free.total)).toBe(Number(plain.total) - Number(plain.shippingFee));
    expect((await getOrderPaymentSummary(free.id)).codToCollect).toBe(Number(free.total));
  });

  it("an agreed final amount becomes the total; the difference is the price adjustment, with the reason on the timeline", async () => {
    const o = await createManualOrder(base({ customerPhone: "01712345603", freeDelivery: true, finalTotal: 1200, pricingNote: "regular customer" }), owner);
    trackOrder(o.id);
    expect(Number(o.total)).toBe(1200);
    expect(Number(o.priceAdjustment)).toBe(1200 - 1300); // 2 × 650, delivery waived
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: o.id } });
    expect(history.some((h) => /free delivery, agreed total 1200 \(regular customer\)/.test(h.note ?? ""))).toBe(true);
  });

  it("needs the Adjust price permission (a role without it is refused; without staff pricing nothing is asked)", async () => {
    const without = ["orders.manage", "orders.read"];
    await expect(createManualOrder(base({ customerPhone: "01712345604", finalTotal: 999 }), owner, null, without)).rejects.toMatchObject({ statusCode: 403 });
    const plain = await createManualOrder(base({ customerPhone: "01712345605" }), owner, null, without);
    trackOrder(plain.id);
    expect(Number(plain.priceAdjustment)).toBe(0);
  });
});
