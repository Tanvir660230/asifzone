import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { generateOrderNumber } from "../../lib/order-number";
import {
  settlePaymentSession,
  markPaymentSessionFailed,
  markPaymentSessionCancelled,
  isPaymentSessionSettled,
  refundOrderPayment,
  listRefundsForOrder,
} from "./payment.service";

// payment.service.ts isn't wired into any controller yet (Phase 2) — these exercise the service
// functions directly against a real test DB, same money-critical-path spirit as
// order.integration.test.ts's markOrderPaid coverage, which this supersedes.
const suffix = Date.now();
const TOTAL = 750;
const orderIds: string[] = [];

async function makeOrder(paymentStatus: "UNPAID" | "PAID" | "REFUNDED" = "UNPAID") {
  const order = await prisma.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      paymentMethod: "EPS_PG",
      paymentStatus,
      customerName: "Vitest Payment",
      customerPhone: "01712345678",
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 1, Road 2",
      subtotal: TOTAL,
      total: TOTAL,
    },
  });
  orderIds.push(order.id);
  return order;
}

async function makeActiveSession(orderId: string, ref = `pay_vitest_${suffix}_${Math.random().toString(36).slice(2)}`) {
  return prisma.paymentSession.create({
    data: {
      orderId,
      provider: "EPS_PG",
      status: "ACTIVE",
      gatewayTransactionRef: ref,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}

describe("payment.service", () => {
  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.$disconnect();
  });

  it("settlePaymentSession rejects an amount mismatch and leaves the session ACTIVE", async () => {
    const order = await makeOrder();
    const session = await makeActiveSession(order.id);

    await expect(settlePaymentSession(session.gatewayTransactionRef, "eps-txn-mismatch", TOTAL + 100)).rejects.toThrow();

    const untouched = await prisma.paymentSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(untouched.status).toBe("ACTIVE");
    const payments = await prisma.payment.count({ where: { paymentSessionId: session.id } });
    expect(payments).toBe(0);
  });

  it("settlePaymentSession is idempotent under concurrent callers — exactly one Payment row, order PAID", async () => {
    const order = await makeOrder();
    const session = await makeActiveSession(order.id);

    // Simulates a live redirect callback racing the reconciliation cron for the same session.
    const [first, second] = await Promise.all([
      settlePaymentSession(session.gatewayTransactionRef, "eps-txn-race", TOTAL),
      settlePaymentSession(session.gatewayTransactionRef, "eps-txn-race", TOTAL),
    ]);
    expect([first.justSettled, second.justSettled].filter(Boolean)).toHaveLength(1);

    const paymentCount = await prisma.payment.count({ where: { paymentSessionId: session.id } });
    expect(paymentCount).toBe(1);

    const settled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(settled.paymentStatus).toBe("PAID");
    expect(settled.status).toBe("CONFIRMED");
  });

  it("isPaymentSessionSettled reflects the settled order only after settlePaymentSession succeeds", async () => {
    const order = await makeOrder();
    const session = await makeActiveSession(order.id);

    expect(await isPaymentSessionSettled(session.gatewayTransactionRef)).toBeNull();

    await settlePaymentSession(session.gatewayTransactionRef, "eps-txn-check", TOTAL);
    const result = await isPaymentSessionSettled(session.gatewayTransactionRef);
    expect(result?.id).toBe(order.id);
  });

  it("markPaymentSessionFailed cannot downgrade an already-succeeded session or its order", async () => {
    const order = await makeOrder();
    const session = await makeActiveSession(order.id);

    await settlePaymentSession(session.gatewayTransactionRef, "eps-txn-paid", TOTAL);

    // Regression guard for the vuln closed this session: a late/replayed fail callback (or one
    // aimed at a guessed ref) must never flip an already-PAID order back to FAILED.
    const changed = await markPaymentSessionFailed(session.gatewayTransactionRef);
    expect(changed).toBe(false);

    const untouched = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(untouched.paymentStatus).toBe("PAID");
  });

  it("markPaymentSessionFailed and markPaymentSessionCancelled never touch a REFUNDED order", async () => {
    const order = await makeOrder("REFUNDED");
    const failSession = await makeActiveSession(order.id, `pay_vitest_refund_fail_${suffix}`);

    await markPaymentSessionFailed(failSession.gatewayTransactionRef);
    const afterFail = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(afterFail.paymentStatus).toBe("REFUNDED");
  });

  it("markPaymentSessionCancelled is a no-op once the session is already resolved", async () => {
    const order = await makeOrder();
    const session = await makeActiveSession(order.id);
    await settlePaymentSession(session.gatewayTransactionRef, "eps-txn-cancel-check", TOTAL);

    const changed = await markPaymentSessionCancelled(session.gatewayTransactionRef);
    expect(changed).toBe(false);

    const untouched = await prisma.paymentSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(untouched.status).toBe("SUCCEEDED");
  });

  describe("refundOrderPayment", () => {
    it("rejects refunding an order that was never paid", async () => {
      const admin = await prisma.adminUser.findFirst();
      if (!admin) throw new Error("Seed at least one AdminUser before running payment tests");
      const order = await makeOrder();

      await expect(refundOrderPayment(order.id, { amount: TOTAL }, admin.id)).rejects.toThrow();
    });

    it("rejects a refund amount larger than the order total", async () => {
      const admin = await prisma.adminUser.findFirst();
      if (!admin) throw new Error("Seed at least one AdminUser before running payment tests");
      const order = await makeOrder();
      const session = await makeActiveSession(order.id);
      await settlePaymentSession(session.gatewayTransactionRef, "eps-txn-refund-cap", TOTAL);

      await expect(refundOrderPayment(order.id, { amount: TOTAL + 100 }, admin.id)).rejects.toThrow();
    });

    it("records a refund, moves the order to REFUNDED, and is idempotent-guarded against a second refund", async () => {
      const admin = await prisma.adminUser.findFirst();
      if (!admin) throw new Error("Seed at least one AdminUser before running payment tests");
      const order = await makeOrder();
      const session = await makeActiveSession(order.id);
      await settlePaymentSession(session.gatewayTransactionRef, "eps-txn-refund-ok", TOTAL);

      const refund = await refundOrderPayment(order.id, { amount: TOTAL, reason: "Customer changed mind" }, admin.id);
      expect(refund.status).toBe("COMPLETED");
      expect(Number(refund.amount)).toBe(TOTAL);

      const refunded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(refunded.paymentStatus).toBe("REFUNDED");

      // Order is no longer PAID, so refundOrderPayment's own guard blocks refunding it a second time.
      await expect(refundOrderPayment(order.id, { amount: TOTAL }, admin.id)).rejects.toThrow();

      const refunds = await listRefundsForOrder(order.id);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]!.id).toBe(refund.id);
    });
  });

  // A storefront digital-payment checkout starts a PaymentSession with orderId: null and no Order
  // at all (see order.controller.ts's create / payment.service.ts's initiatePendingPayment) — the
  // Order only gets materialized here, in settlePaymentSession, once the gateway confirms success.
  // These bypass initiatePendingPayment's real gateway call the same way makeActiveSession above
  // bypasses startPaymentSession's — they build the checkoutPayload directly and exercise
  // settlement/failure against it.
  describe("pre-order (digital-payment) sessions", () => {
    const UNIT_PRICE = 500;
    const preOrderSuffix = `${suffix}_pre`;
    let productId: string;
    let variantId: string;
    let sku: string;

    beforeAll(async () => {
      const category = await prisma.category.findFirst();
      if (!category) throw new Error("Seed at least one category before running payment tests");
      sku = `VITEST-PREORDER-SKU-${preOrderSuffix}`;
      const product = await prisma.product.create({
        data: {
          name: `Vitest Pre-order Product ${preOrderSuffix}`,
          slug: `vitest-preorder-product-${preOrderSuffix}`,
          categoryId: category.id,
          basePrice: UNIT_PRICE,
          isActive: true,
          variants: { create: [{ sku, size: "M", color: "Black", stock: 5 }] },
        },
        include: { variants: true },
      });
      productId = product.id;
      variantId = product.variants[0]!.id;
    });

    afterAll(async () => {
      await prisma.product.delete({ where: { id: productId } }).catch(() => {});
    });

    function checkoutInput(overrides: Record<string, unknown> = {}) {
      return {
        items: [{ variantId, quantity: 1 }],
        customerName: "Vitest Preorder Checkout",
        customerPhone: "01712345679",
        shippingDivision: "Dhaka",
        shippingDistrict: "Dhaka",
        shippingArea: "Uttara",
        shippingAddressLine: "House 1, Road 2",
        paymentMethod: "EPS_PG",
        ...overrides,
      };
    }

    async function makePendingCheckoutSession(total: number, ref: string) {
      const input = checkoutInput();
      const session = await prisma.paymentSession.create({
        data: {
          orderId: null,
          provider: "EPS_PG",
          status: "ACTIVE",
          gatewayTransactionRef: ref,
          expiresAt: new Date(Date.now() + 60_000),
          checkoutPayload: {
            input,
            customerId: null,
            pricing: { subtotal: total, discount: 0, couponId: null, couponFreeShipping: false, bundleId: null, bundleDiscount: 0, shippingFee: 0, total },
            itemSnapshots: [
              { variantId, quantity: 1, productNameSnapshot: "Vitest Pre-order Product", skuSnapshot: sku, sizeSnapshot: "M", colorSnapshot: "Black", priceSnapshot: total },
            ],
          },
        },
      });
      return session;
    }

    it("settlePaymentSession materializes a CONFIRMED/PAID order only now, decrementing stock", async () => {
      const before = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      const ref = `pay_vitest_preorder_ok_${preOrderSuffix}`;
      const session = await makePendingCheckoutSession(UNIT_PRICE, ref);

      const { order, justSettled } = await settlePaymentSession(ref, "eps-txn-preorder-ok", UNIT_PRICE);
      orderIds.push(order.id);

      expect(justSettled).toBe(true);
      expect(order.status).toBe("CONFIRMED");
      expect(order.paymentStatus).toBe("PAID");
      expect(Number(order.total)).toBe(UNIT_PRICE);

      const settledSession = await prisma.paymentSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(settledSession.orderId).toBe(order.id);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { paymentSessionId: session.id } });
      expect(payment.orderId).toBe(order.id);
      expect(payment.status).toBe("SUCCEEDED");

      const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      expect(variant.stock).toBe(before.stock - 1);
    });

    it("markPaymentSessionFailed never creates an Order — the FAILED Payment row is the payment log", async () => {
      const before = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      const ref = `pay_vitest_preorder_fail_${preOrderSuffix}`;
      const session = await makePendingCheckoutSession(UNIT_PRICE, ref);

      const changed = await markPaymentSessionFailed(ref);
      expect(changed).toBe(true);

      const failedSession = await prisma.paymentSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(failedSession.orderId).toBeNull();

      const payment = await prisma.payment.findUniqueOrThrow({ where: { paymentSessionId: session.id } });
      expect(payment.orderId).toBeNull();
      expect(payment.status).toBe("FAILED");

      // Stock was never touched — a pre-order session doesn't reserve anything until settlement.
      const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      expect(variant.stock).toBe(before.stock);
    });

    it("markPaymentSessionCancelled never creates an Order or a Payment row", async () => {
      const ref = `pay_vitest_preorder_cancel_${preOrderSuffix}`;
      const session = await makePendingCheckoutSession(UNIT_PRICE, ref);

      const changed = await markPaymentSessionCancelled(ref);
      expect(changed).toBe(true);

      const cancelledSession = await prisma.paymentSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(cancelledSession.orderId).toBeNull();
      expect(cancelledSession.status).toBe("CANCELLED");

      const payment = await prisma.payment.findUnique({ where: { paymentSessionId: session.id } });
      expect(payment).toBeNull();
    });

    it("settlePaymentSession still rejects an amount mismatch before ever creating an order", async () => {
      const ref = `pay_vitest_preorder_mismatch_${preOrderSuffix}`;
      await makePendingCheckoutSession(UNIT_PRICE, ref);

      await expect(settlePaymentSession(ref, "eps-txn-preorder-mismatch", UNIT_PRICE + 100)).rejects.toThrow();

      const order = await prisma.order.findFirst({ where: { customerPhone: "01712345679", total: UNIT_PRICE + 100 } });
      expect(order).toBeNull();
    });
  });
});
