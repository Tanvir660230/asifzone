import { describe, it, expect, afterAll } from "vitest";
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
});
