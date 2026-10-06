import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";

vi.mock("../../providers/email/resend", () => ({ sendMail: async () => undefined }));

import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signCustomerAccessToken } from "../../lib/customer-jwt";
import { CUSTOMER_ACCESS_COOKIE } from "../../lib/cookies";
import { couponValidateRateLimit, emailSendRateLimit, refreshRateLimit } from "../../middlewares/rate-limit";
import { DEV_SEED_ADMIN, resolveSeedAdminCredentials } from "../../lib/seed-credentials";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, RUN } from "../../test-fixtures";
import { adjustOrderPrice } from "../../modules/orders/order.service";

// Phase 11 (contract §8, F-14, F-20): rate-limit gaps closed, seed refuses default credentials outside dev/test, exact money in
// the legacy price-adjustment path.

const IPS = ["::ffff:127.0.0.1", "127.0.0.1", "::1"];
const resetAll = () => {
  for (const ip of IPS) for (const limiter of [couponValidateRateLimit, refreshRateLimit, emailSendRateLimit]) limiter.resetKey(ip);
};
const madeCustomers: string[] = [];

beforeEach(resetAll);
afterAll(async () => {
  resetAll();
  await cleanupFixtures();
  if (madeCustomers.length) await prisma.customer.deleteMany({ where: { id: { in: madeCustomers } } });
  await prisma.$disconnect();
});

/** Sends `n` requests; returns their statuses. */
async function fire(n: number, send: () => request.Test) {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) statuses.push((await send()).status);
  return statuses;
}

describe("rate-limit gaps (in-memory store kept)", () => {
  it("POST /api/coupons/best: 20 per window, then 429", async () => {
    const statuses = await fire(21, () => request(app).post("/api/coupons/best").send({ subtotal: 1000, items: [] }));
    expect(statuses.slice(0, 20).every((s) => s !== 429)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("POST /api/auth/refresh and /api/customers/refresh: 60 per window, then 429", async () => {
    const admin = await fire(61, () => request(app).post("/api/auth/refresh"));
    expect(admin.slice(0, 60).every((s) => s !== 429)).toBe(true);
    expect(admin[60]).toBe(429);
    resetAll();
    const customer = await fire(61, () => request(app).post("/api/customers/refresh"));
    expect(customer.slice(0, 60).every((s) => s !== 429)).toBe(true);
    expect(customer[60]).toBe(429);
  });

  it("POST /api/customers/resend-verification: 5 per window, then 429", async () => {
    const c = await prisma.customer.create({ data: { name: "Resend", email: `p11-resend-${RUN}@example.com` } });
    madeCustomers.push(c.id);
    const cookie = [`${CUSTOMER_ACCESS_COOKIE}=${signCustomerAccessToken({ customerId: c.id })}`, "csrf_token=t"];
    const statuses = await fire(6, () => request(app).post("/api/customers/resend-verification").set("Cookie", cookie).set("X-CSRF-Token", "t"));
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("seed OWNER credentials (F-14)", () => {
  it("defaults only in development/test; production requires real values and refuses the defaults", () => {
    expect(resolveSeedAdminCredentials({ NODE_ENV: "test" })).toMatchObject({ email: DEV_SEED_ADMIN.email, usedDefaults: true });
    expect(resolveSeedAdminCredentials({})).toMatchObject({ usedDefaults: true }); // NODE_ENV unset = development
    expect(() => resolveSeedAdminCredentials({ NODE_ENV: "production" })).toThrow(/required/);
    expect(() => resolveSeedAdminCredentials({ NODE_ENV: "staging", SEED_ADMIN_EMAIL: "o@shop.test" })).toThrow(/required/);
    expect(() => resolveSeedAdminCredentials({ NODE_ENV: "production", SEED_ADMIN_EMAIL: DEV_SEED_ADMIN.email, SEED_ADMIN_PASSWORD: "Strong-Unique-9" })).toThrow(/Refusing/);
    expect(() => resolveSeedAdminCredentials({ NODE_ENV: "production", SEED_ADMIN_EMAIL: "o@shop.test", SEED_ADMIN_PASSWORD: DEV_SEED_ADMIN.password })).toThrow(/Refusing/);
    expect(resolveSeedAdminCredentials({ NODE_ENV: "production", SEED_ADMIN_EMAIL: "o@shop.test", SEED_ADMIN_PASSWORD: "Strong-Unique-9" })).toEqual({ email: "o@shop.test", password: "Strong-Unique-9", usedDefaults: false });
  });
});

describe("legacy price adjustment uses exact money (F-20)", () => {
  it("a pre-Phase-2 order without a couponDiscount snapshot adjusts to the exact total", async () => {
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: "01799910066" });
    // Shape it like a legacy order: discount split not snapshotted; values whose float difference isn't representable.
    await prisma.order.update({
      where: { id: order.id },
      data: { couponDiscount: null, discount: "100.30", bundleDiscount: "0.10", subtotal: "1000.00", shippingWaived: false, shippingFee: "60.00", taxMode: null, taxAmount: null, priceAdjustment: 0, total: "959.70" },
    });
    const adjusted = await adjustOrderPrice(order.id, { priceAdjustment: -0.2, note: null }, await ownerId());
    // 1000.00 − 0.10 (bundle) − 100.20 (coupon = discount − bundle) + 60.00 − 0.20 = 959.50
    expect(Number(adjusted.total)).toBe(959.5);
    expect(adjusted.total.toString()).toMatch(/^959\.5/);
  });
});
