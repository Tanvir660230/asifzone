import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { getSettings } from "../settings/settings.service";
import { retryPayment, updateOrderStatus, getOrderStats } from "./order.service";
import { generateOrderNumber } from "../../lib/order-number";

// Money-critical path: checkout (stock decrement, coupon math, order totals) and payment
// confirmation (amount verification, idempotency). A dedicated product/variant/coupon are created
// here rather than reusing seed data, so stock levels are exact and predictable across tests.
const suffix = Date.now();
const UNIT_PRICE = 500;
// Enough for every successful-checkout test below (4: base order, coupon order, tracking order,
// markOrderPaid order) plus headroom — the insufficient-stock test itself never decrements.
const INITIAL_STOCK = 6;
const couponCode = `VITEST${suffix}`;

let productId: string;
let variantId: string;
let couponId: string;
const orderIds: string[] = [];

function checkoutBody(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ variantId, quantity: 1 }],
    customerName: "Vitest Checkout",
    customerPhone: "01712345678",
    shippingDivision: "Dhaka",
    shippingDistrict: "Dhaka",
    shippingArea: "Uttara",
    shippingAddressLine: "House 1, Road 2",
    paymentMethod: "COD",
    ...overrides,
  };
}

describe("checkout & payment", () => {
  beforeAll(async () => {
    const category = await prisma.category.findFirst();
    if (!category) throw new Error("Seed at least one category before running checkout tests");

    const product = await prisma.product.create({
      data: {
        name: `Vitest Checkout Product ${suffix}`,
        slug: `vitest-checkout-product-${suffix}`,
        categoryId: category.id,
        basePrice: UNIT_PRICE,
        isActive: true,
        variants: {
          create: [{ sku: `VITEST-SKU-${suffix}`, size: "M", color: "Black", stock: INITIAL_STOCK }],
        },
      },
      include: { variants: true },
    });
    productId = product.id;
    variantId = product.variants[0]!.id;

    const coupon = await prisma.coupon.create({
      data: { code: couponCode, type: "FIXED", value: 50, isActive: true },
    });
    couponId = coupon.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.coupon.delete({ where: { id: couponId } }).catch(() => {});
    await prisma.product.delete({ where: { id: productId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("creates a COD order, decrements stock, and computes subtotal/total correctly", async () => {
    const settings = await getSettings();

    const res = await request(app).post("/api/orders").send(checkoutBody());
    expect(res.status).toBe(201);
    orderIds.push(res.body.order.id);

    expect(Number(res.body.order.subtotal)).toBe(UNIT_PRICE);
    expect(Number(res.body.order.total)).toBe(UNIT_PRICE + Number(settings.shippingFeeDhaka));
    expect(res.body.order.paymentStatus).toBe("UNPAID");
    expect(res.body.order.items).toHaveLength(1);
    expect(res.body.order.items[0].skuSnapshot).toBe(`VITEST-SKU-${suffix}`);

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(variant.stock).toBe(INITIAL_STOCK - 1);
  });

  it("rejects checkout when the requested quantity exceeds available stock, without changing stock", async () => {
    const before = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });

    const res = await request(app)
      .post("/api/orders")
      .send(checkoutBody({ items: [{ variantId, quantity: before.stock + 1 }] }));
    expect(res.status).toBe(409);

    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(after.stock).toBe(before.stock);
  });

  it("applies a coupon, reduces the total, and increments usage", async () => {
    const beforeCoupon = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
    const settings = await getSettings();

    const res = await request(app).post("/api/orders").send(checkoutBody({ couponCode }));
    expect(res.status).toBe(201);
    orderIds.push(res.body.order.id);

    expect(Number(res.body.order.discount)).toBe(50);
    expect(Number(res.body.order.total)).toBe(UNIT_PRICE - 50 + Number(settings.shippingFeeDhaka));

    const afterCoupon = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
    expect(afterCoupon.usedCount).toBe(beforeCoupon.usedCount + 1);
  });

  it("tracks an order by orderNumber+phone and rejects a mismatched phone", async () => {
    const created = await request(app).post("/api/orders").send(checkoutBody());
    expect(created.status).toBe(201);
    orderIds.push(created.body.order.id);
    const { orderNumber } = created.body.order;

    const okRes = await request(app).post("/api/orders/track").send({ orderNumber, phone: "01712345678" });
    expect(okRes.status).toBe(200);
    expect(okRes.body.order.orderNumber).toBe(orderNumber);

    const wrongRes = await request(app).post("/api/orders/track").send({ orderNumber, phone: "01999999999" });
    expect(wrongRes.status).toBe(404);
  });

  // Payment settlement (amount-mismatch rejection, idempotency, PaymentSession/Payment writes) is
  // covered in payments/payment.integration.test.ts — this suite stays focused on checkout/order
  // creation.

  describe("retryPayment", () => {
    const PHONE = "01777000111";

    async function makeOnlineOrder(overrides: Partial<{ paymentMethod: "EPS_PG" | "SSLCOMMERZ" | "COD"; paymentStatus: "UNPAID" | "PAID" | "REFUNDED"; status: "PENDING" | "CANCELLED" }> = {}) {
      const order = await prisma.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          paymentMethod: overrides.paymentMethod ?? "EPS_PG",
          paymentStatus: overrides.paymentStatus ?? "UNPAID",
          status: overrides.status ?? "PENDING",
          customerName: "Vitest Retry",
          customerPhone: PHONE,
          shippingDivision: "Dhaka",
          shippingDistrict: "Dhaka",
          shippingArea: "Uttara",
          shippingAddressLine: "House 1, Road 2",
          subtotal: UNIT_PRICE,
          total: UNIT_PRICE,
        },
      });
      orderIds.push(order.id);
      return order;
    }

    it("rejects a mismatched phone", async () => {
      const order = await makeOnlineOrder();
      await expect(retryPayment(order.orderNumber, "01999999999")).rejects.toThrow();
    });

    it("rejects Cash on Delivery orders", async () => {
      const order = await makeOnlineOrder({ paymentMethod: "COD" });
      await expect(retryPayment(order.orderNumber, PHONE)).rejects.toThrow();
    });

    it("rejects an already-PAID order", async () => {
      const order = await makeOnlineOrder({ paymentStatus: "PAID" });
      await expect(retryPayment(order.orderNumber, PHONE)).rejects.toThrow();
    });

    it("rejects a REFUNDED order", async () => {
      const order = await makeOnlineOrder({ paymentStatus: "REFUNDED" });
      await expect(retryPayment(order.orderNumber, PHONE)).rejects.toThrow();
    });

    it("rejects a CANCELLED order — stock already restocked, a fresh checkout is required instead", async () => {
      const order = await makeOnlineOrder({ status: "CANCELLED" });
      await expect(retryPayment(order.orderNumber, PHONE)).rejects.toThrow();
    });

    it("rejects retry while an ACTIVE session is still within its grace window", async () => {
      const order = await makeOnlineOrder();
      await prisma.paymentSession.create({
        data: {
          orderId: order.id,
          provider: "EPS_PG",
          status: "ACTIVE",
          gatewayTransactionRef: `pay_vitest_grace_${suffix}`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      await expect(retryPayment(order.orderNumber, PHONE)).rejects.toThrow(/already in progress/);
    });

    it("expires a stale ACTIVE session past the grace window before attempting a new one", async () => {
      const order = await makeOnlineOrder();
      const stale = await prisma.paymentSession.create({
        data: {
          orderId: order.id,
          provider: "EPS_PG",
          status: "ACTIVE",
          gatewayTransactionRef: `pay_vitest_stale_${suffix}`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          createdAt: new Date(Date.now() - 3 * 60 * 1000), // older than the 2-minute retry grace window
        },
      });

      // The eventual gateway call this makes isn't under test here (no real sandbox credentials in
      // this environment — see Phase 3's manual sandbox-testing note); this only asserts that the
      // stale session was expired before that call was attempted, which happens regardless of
      // whether the gateway call itself then succeeds or fails.
      await retryPayment(order.orderNumber, PHONE).catch(() => {});

      const afterStale = await prisma.paymentSession.findUniqueOrThrow({ where: { id: stale.id } });
      expect(afterStale.status).toBe("EXPIRED");
    });
  });

  it("alerts admins when a PAID order is cancelled — a real refund-risk case", async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        paymentMethod: "EPS_PG",
        paymentStatus: "PAID",
        status: "CONFIRMED",
        customerName: "Vitest Cancelled Paid",
        customerPhone: "01777000222",
        shippingDivision: "Dhaka",
        shippingDistrict: "Dhaka",
        shippingArea: "Uttara",
        shippingAddressLine: "House 1, Road 2",
        subtotal: UNIT_PRICE,
        total: UNIT_PRICE,
      },
    });
    orderIds.push(order.id);

    const before = await getOrderStats();
    await updateOrderStatus(order.id, { status: "CANCELLED" });
    const after = await getOrderStats();

    expect(after.cancelledButPaidCount).toBe(before.cancelledButPaidCount + 1);

    const alert = await prisma.notification.findFirst({
      where: { type: "order.cancelled_but_paid", link: `/admin/orders/${order.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(alert).not.toBeNull();
  });
});
