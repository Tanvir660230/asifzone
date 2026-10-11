import { describe, expect, it } from "vitest";
import { orderStatusEnum, paymentStatusEnum, productStatusEnum } from "@clothing-brand/shared";
import { STATUS_REGISTRY, statusOf, TONE_BADGE_VARIANT, TONE_PILL_CLASS, TONE_TEXT_CLASS } from "@/lib/status";

// P1.4 — the status registry replaced the per-domain maps in lib/format.ts. These are the pre-registry tables, verbatim:
// moving to the registry must not change a single label or colour.

const OLD_ORDER_BADGE: Record<string, string> = {
  PENDING: "bg-warning-100 text-warning-700",
  CONFIRMED: "bg-info-100 text-info-700",
  PROCESSING: "bg-info-100 text-info-700",
  PACKED: "bg-info-100 text-info-700",
  SHIPPED: "bg-info-100 text-info-700",
  DELIVERED: "bg-success-100 text-success-700",
  PARTIALLY_DELIVERED: "bg-warning-100 text-warning-700",
  CANCELLED: "bg-danger-100 text-danger-700",
  RETURNED: "bg-warning-100 text-warning-700",
  REFUNDED: "bg-ink-200 text-ink-700",
};
const OLD_ORDER_LABEL: Record<string, string> = {
  PENDING: "Pending confirmation",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  PARTIALLY_DELIVERED: "Partially delivered",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
};
const OLD_ORDER_SHORT: Record<string, string> = { ...OLD_ORDER_LABEL, PENDING: "Pending", PARTIALLY_DELIVERED: "Partial" };
const OLD_COURIER_BADGE: Record<string, string> = {
  delivered: "bg-success-100 text-success-700",
  partial_delivered: "bg-warning-100 text-warning-700",
  delivered_approval_pending: "bg-success-100 text-success-700",
  partial_delivered_approval_pending: "bg-warning-100 text-warning-700",
  cancelled: "bg-danger-100 text-danger-700",
  cancelled_approval_pending: "bg-danger-100 text-danger-700",
  hold: "bg-warning-100 text-warning-700",
  pending: "bg-warning-100 text-warning-700",
  in_review: "bg-info-100 text-info-700",
  unknown_approval_pending: "bg-info-100 text-info-700",
  unknown: "bg-ink-100 text-ink-700",
};
const OLD_COURIER_LABEL: Record<string, string> = {
  in_review: "In review",
  pending: "Awaiting pickup",
  hold: "On hold",
  delivered_approval_pending: "Delivered (confirming)",
  partial_delivered_approval_pending: "Partly delivered (confirming)",
  cancelled_approval_pending: "Cancelled (confirming)",
  unknown_approval_pending: "Confirming with courier",
  delivered: "Delivered",
  partial_delivered: "Partly delivered",
  cancelled: "Cancelled / returned",
  unknown: "Unclear",
};
const OLD_PAYMENT_LABEL: Record<string, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
  FAILED: "Failed",
  PARTIALLY_REFUNDED: "Part refunded",
  REFUNDED: "Refunded",
  CREDITED: "Store credit",
};
const OLD_PAYMENT_TEXT: Record<string, string> = {
  UNPAID: "text-warning-600",
  PARTIALLY_PAID: "text-warning-600",
  PAID: "text-success-600",
  FAILED: "text-danger-600",
  PARTIALLY_REFUNDED: "text-info-600",
  REFUNDED: "text-ink-500",
  CREDITED: "text-info-600",
};
const OLD_PRODUCT: Record<string, [string, string]> = {
  DRAFT: ["Draft", "neutral"],
  READY: ["Ready", "info"],
  PUBLISHED: ["Published", "success"],
  UNPUBLISHED: ["Unpublished", "danger"],
};

describe("status registry", () => {
  it("covers every backend status value", () => {
    for (const v of orderStatusEnum.options) expect(STATUS_REGISTRY.order[v], v).toBeDefined();
    for (const v of paymentStatusEnum.options) expect(STATUS_REGISTRY.payment[v], v).toBeDefined();
    for (const v of productStatusEnum.options) expect(STATUS_REGISTRY.product[v], v).toBeDefined();
  });

  it("reproduces the previous order, courier, payment and product presentation exactly", () => {
    for (const [v, cls] of Object.entries(OLD_ORDER_BADGE)) expect(TONE_PILL_CLASS[statusOf("order", v).tone], v).toBe(cls);
    for (const [v, label] of Object.entries(OLD_ORDER_LABEL)) expect(statusOf("order", v).label, v).toBe(label);
    for (const [v, short] of Object.entries(OLD_ORDER_SHORT)) expect(statusOf("order", v).short ?? statusOf("order", v).label, v).toBe(short);
    for (const [v, cls] of Object.entries(OLD_COURIER_BADGE)) expect(TONE_PILL_CLASS[statusOf("courier", v).tone], v).toBe(cls);
    for (const [v, label] of Object.entries(OLD_COURIER_LABEL)) expect(statusOf("courier", v).label, v).toBe(label);
    for (const [v, label] of Object.entries(OLD_PAYMENT_LABEL)) expect(statusOf("payment", v).label, v).toBe(label);
    for (const [v, cls] of Object.entries(OLD_PAYMENT_TEXT)) expect(TONE_TEXT_CLASS[statusOf("payment", v).tone], v).toBe(cls);
    for (const [v, [label, variant]] of Object.entries(OLD_PRODUCT)) {
      expect(statusOf("product", v).label).toBe(label);
      expect(TONE_BADGE_VARIANT[statusOf("product", v).tone]).toBe(variant);
    }
  });

  it("falls back the way the old helpers did for an unknown value", () => {
    expect(statusOf("order", "MYSTERY")).toMatchObject({ label: "MYSTERY", tone: "neutral" });
    expect(TONE_PILL_CLASS[statusOf("courier", "lost_in_space").tone]).toBe("bg-ink-100 text-ink-700");
    expect(statusOf("courier", "lost_in_space").label).toBe("lost in space");
    expect(TONE_TEXT_CLASS[statusOf("payment", "WHATEVER").tone]).toBe("text-ink-500");
  });
});
