import { describe, it, expect } from "vitest";
import {
  courierBookingBlocker,
  customerDetailsEditBlocker,
  describeOrderTransitionConsequences,
  followUpHoldBlocker,
  manualPaymentBlocker,
  manualPaymentKindFor,
  orderStatusEnum,
  priceAdjustmentBlocker,
  type OrderGuardFacts,
  type OrderStatus,
  type OrderTransitionContext,
} from "@clothing-brand/shared";

// Pure helpers the admin Orders workspace reads (packages/shared order-state.ts / order-operations.ts): transition
// consequences derived from the state-machine rule, and the non-transition command preconditions the API also enforces.

const ALL = orderStatusEnum.options as OrderStatus[];
const ctx = (over: Partial<OrderTransitionContext> = {}): OrderTransitionContext => ({
  paymentMethod: "COD",
  paymentStatus: "UNPAID",
  courierBooked: false,
  hasCoupon: false,
  hasFollowUp: false,
  ...over,
});
const texts = (from: OrderStatus, to: OrderStatus, c = ctx()) => (describeOrderTransitionConsequences(from, to, c) ?? []).map((x) => x.text).join(" | ");

describe("describeOrderTransitionConsequences", () => {
  it("is null for exactly the moves the state machine refuses, and empty for a no-op", () => {
    expect(describeOrderTransitionConsequences("CANCELLED", "CONFIRMED", ctx())).toBeNull();
    expect(describeOrderTransitionConsequences("DELIVERED", "CANCELLED", ctx())).toBeNull();
    for (const s of ALL) expect(describeOrderTransitionConsequences(s, s, ctx())).toEqual([]);
  });

  it("a pre-shipment cancellation releases stock, gives a coupon back, and warns about money and the courier", () => {
    const out = describeOrderTransitionConsequences("PACKED", "CANCELLED", ctx({ paymentStatus: "PAID", courierBooked: true, hasCoupon: true }))!;
    const all = out.map((c) => c.text).join(" | ");
    expect(all).toMatch(/stock goes back/i);
    expect(all).toMatch(/coupon use is given back/i);
    expect(all).toMatch(/refund will be owed/i);
    expect(all).toMatch(/courier booking is not cancelled/i);
    expect(out.filter((c) => c.tone === "warning").length).toBeGreaterThanOrEqual(3);
  });

  it("cancelling after shipping keeps the coupon use (D7)", () => {
    expect(texts("SHIPPED", "CANCELLED", ctx({ hasCoupon: true }))).not.toMatch(/coupon/i);
  });

  it("delivery collects COD only when the money isn't already held", () => {
    expect(texts("SHIPPED", "DELIVERED")).toMatch(/cash on delivery is recorded as collected/i);
    expect(texts("SHIPPED", "DELIVERED", ctx({ paymentStatus: "PAID" }))).not.toMatch(/cash on delivery/i);
    expect(texts("SHIPPED", "DELIVERED", ctx({ paymentMethod: "SSLCOMMERZ", paymentStatus: "PAID" }))).not.toMatch(/cash on delivery/i);
  });

  it("REFUNDED is flagged as blocked until a refund is recorded", () => {
    expect(describeOrderTransitionConsequences("RETURNED", "REFUNDED", ctx({ paymentStatus: "PAID" }))![0]).toMatchObject({ tone: "blocked" });
    expect(describeOrderTransitionConsequences("RETURNED", "REFUNDED", ctx({ paymentStatus: "REFUNDED" }))!.some((c) => c.tone === "blocked")).toBe(false);
  });

  it("leaving PENDING mentions the follow-up reminder only when one is set", () => {
    expect(texts("PENDING", "CONFIRMED", ctx({ hasFollowUp: true }))).toMatch(/follow-up reminder is cleared/i);
    expect(texts("PENDING", "CONFIRMED")).not.toMatch(/follow-up/i);
  });
});

describe("order command guards", () => {
  const order = (over: Partial<OrderGuardFacts> = {}): OrderGuardFacts => ({
    status: "PENDING",
    deletedAt: null,
    courierConsignmentId: null,
    paymentMethod: "COD",
    ...over,
  });

  it("price adjustment: open, unbooked, unpaid orders only", () => {
    expect(priceAdjustmentBlocker(order(), 0)).toBeNull();
    expect(priceAdjustmentBlocker(order({ status: "PARTIALLY_DELIVERED" }), 0)).toBeNull();
    expect(priceAdjustmentBlocker(order({ status: "DELIVERED" }), 0)).toMatch(/delivered/);
    expect(priceAdjustmentBlocker(order({ courierConsignmentId: "x" }), 0)).toMatch(/courier has been booked/);
    expect(priceAdjustmentBlocker(order(), 100)).toMatch(/payment recorded/);
    expect(priceAdjustmentBlocker(order({ deletedAt: new Date() }), 0)).toMatch(/Restore/);
  });

  it("customer details and follow-up holds", () => {
    expect(customerDetailsEditBlocker(order({ status: "SHIPPED" }))).toBeNull();
    expect(customerDetailsEditBlocker(order({ courierConsignmentId: "x" }))).toMatch(/unlink/);
    expect(followUpHoldBlocker(order())).toBeNull();
    expect(followUpHoldBlocker(order({ status: "CONFIRMED" }))).toMatch(/Only pending/);
  });

  it("courier booking", () => {
    expect(courierBookingBlocker(order({ status: "PACKED" }))).toBeNull();
    expect(courierBookingBlocker(order({ courierConsignmentId: "x" }))).toMatch(/already booked/);
    for (const s of ["CANCELLED", "REFUNDED", "RETURNED", "DELIVERED", "PARTIALLY_DELIVERED"] as const) {
      expect(courierBookingBlocker(order({ status: s }))).toMatch(/Cannot book/);
    }
  });

  it("manual payments: the kind follows the order, and each kind has its own preconditions", () => {
    expect(manualPaymentKindFor(order({ status: "PARTIALLY_DELIVERED" }))).toBe("COD_COLLECTED");
    expect(manualPaymentKindFor(order({ status: "PARTIALLY_DELIVERED", paymentMethod: "SSLCOMMERZ" }))).toBe("MANUAL");
    expect(manualPaymentBlocker(order({ status: "PARTIALLY_DELIVERED" }), "COD_COLLECTED")).toBeNull();
    expect(manualPaymentBlocker(order(), "MANUAL")).toBeNull();
    expect(manualPaymentBlocker(order({ courierConsignmentId: "x" }), "MANUAL")).toMatch(/unlink the booking/);
    expect(manualPaymentBlocker(order({ status: "CANCELLED" }), "MANUAL")).toMatch(/cancelled/);
  });
});
