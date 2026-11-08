import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { getProviders } from "../../providers/registry";
import { cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { updateSmsSettings } from "../sms-settings/sms-settings.service";
import { getReviewRequestView, parseReviewCode, reviewCode, sendReviewRequests, submitReviewFromLink } from "./review-request";

// Two days after delivery the customer gets one SMS asking for a review; the link opens their delivered order's products
// with a star picker — no account, no password. The review is a verified purchase and waits for moderation like any other.

let owner: string;
let productA: string;
let variantA: string;
let productB: string;

async function deliveredOrder(phoneTail: string, deliveredDaysAgo: number) {
  const o = await createManualOrder(
    {
      items: [{ variantId: variantA, quantity: 1 }],
      customerName: "Vitest Review Asker",
      customerPhone: `0171111${phoneTail}`,
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
      confirmNow: true,
    } as never,
    owner,
  );
  trackOrder(o.id);
  // Two writes: a trigger stamps statusChangedAt = now() on a status change, so the back-dated time goes in after it.
  await prisma.order.update({ where: { id: o.id }, data: { status: "DELIVERED" } });
  await prisma.order.update({ where: { id: o.id }, data: { statusChangedAt: new Date(Date.now() - deliveredDaysAgo * 86_400_000) } });
  return prisma.order.findUniqueOrThrow({ where: { id: o.id } });
}

beforeAll(async () => {
  owner = await ownerId();
  const a = await createStockedProduct({ stocks: [50], basePrice: 300 });
  productA = a.product.id;
  variantA = a.variants[0]!.id;
  productB = (await createStockedProduct({ stocks: [5], basePrice: 300 })).product.id;
});
afterAll(async () => {
  await updateSmsSettings({ customerReviewRequestEnabled: false } as never);
  await prisma.productReview.deleteMany({ where: { productId: { in: [productA, productB] } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("review link code", () => {
  it("round-trips, and can't be reused as another order's or tampered", () => {
    const code = reviewCode("AZ2001");
    expect(code).toMatch(/^AZ2001\.[A-Za-z0-9_-]{10}$/);
    expect(parseReviewCode(code)).toBe("AZ2001");
    const sig = code.split(".")[1]!;
    expect(parseReviewCode(`AZ2002.${sig}`)).toBeNull();
    expect(parseReviewCode(`AZ2001.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`)).toBeNull();
  });
});

describe("reviewing from the link", () => {
  it("a delivered order lists its products; a review is verified, pending, once per product", async () => {
    const o = await deliveredOrder("801", 3);
    const code = reviewCode(o.orderNumber);
    const view = await getReviewRequestView(code);
    expect(view.canReview).toBe(true);
    expect(view.items.map((i) => i.productId)).toEqual([productA]);
    expect(view.items[0]!.reviewed).toBe(false);

    const r = await submitReviewFromLink(code, { productId: productA, rating: 5, body: "" });
    expect(r).toMatchObject({ rating: 5, status: "PENDING", isVerifiedPurchase: true, customerId: o.customerId });
    expect((await getReviewRequestView(code)).items[0]!.reviewed).toBe(true);
    await expect(submitReviewFromLink(code, { productId: productA, rating: 4, body: "" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(submitReviewFromLink(code, { productId: productB, rating: 4, body: "" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("an order not delivered yet can't be reviewed from the link", async () => {
    const o = await deliveredOrder("802", 3);
    await prisma.order.update({ where: { id: o.id }, data: { status: "SHIPPED" } });
    const code = reviewCode(o.orderNumber);
    expect((await getReviewRequestView(code)).canReview).toBe(false);
    await expect(submitReviewFromLink(code, { productId: productA, rating: 5, body: "" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("public routes: GET the order's products, POST a review, a bad code is 404, a bad rating 400", async () => {
    const o = await deliveredOrder("803", 3);
    const code = reviewCode(o.orderNumber);
    const got = await request(app).get(`/api/review-link/${code}`);
    expect(got.status).toBe(200);
    expect(JSON.stringify(got.body)).not.toContain("01711110803");
    expect((await request(app).post(`/api/review-link/${code}`).send({ productId: productA, rating: 9 })).status).toBe(400);
    expect((await request(app).post(`/api/review-link/${code}`).send({ productId: productA, rating: 4, body: "Good cap, fits well" })).status).toBe(201);
    expect((await request(app).get(`/api/review-link/${o.orderNumber}.zzzzzzzzzz`)).status).toBe(404);
  });
});

describe("the review-request SMS", () => {
  it("off: nobody is texted; on: an order delivered 2+ days ago is texted once, with its link", async () => {
    const due = await deliveredOrder("811", 2.5);
    const tooNew = await deliveredOrder("812", 1);
    const tooOld = await deliveredOrder("813", 10);
    const send = vi.spyOn(getProviders().sms, "send").mockResolvedValue(undefined as never);
    try {
      await updateSmsSettings({ customerReviewRequestEnabled: false } as never);
      expect((await sendReviewRequests()).sent).toBe(0);

      await updateSmsSettings({ customerReviewRequestEnabled: true } as never);
      const first = await sendReviewRequests();
      const toDue = send.mock.calls.filter(([m]) => m.to === due.customerPhone);
      expect(toDue).toHaveLength(1);
      expect(toDue[0]![0].body).toContain(`/r/${reviewCode(due.orderNumber)}`);
      expect(send.mock.calls.some(([m]) => m.to === tooNew.customerPhone || m.to === tooOld.customerPhone)).toBe(false);
      expect(first.sent).toBeGreaterThanOrEqual(1);

      await sendReviewRequests();
      expect(send.mock.calls.filter(([m]) => m.to === due.customerPhone)).toHaveLength(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: due.id } })).reviewRequestedAt).not.toBeNull();
    } finally {
      send.mockRestore();
      await updateSmsSettings({ customerReviewRequestEnabled: false } as never);
    }
  });
});
