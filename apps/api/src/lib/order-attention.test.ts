import { describe, it, expect } from "vitest";
import { orderAttentionItems, primaryOrderAction, suggestedNextOrderStatus, type OrderAttentionFacts } from "@clothing-brand/shared";

// Blueprint V2 P0: one definition of "what needs attention on this order" and "the obvious next step", shared by the
// order screens and the AI assistant.

const fmt = { price: (n: number) => `৳${n}`, dateTime: (at: string | Date) => new Date(at).toISOString().slice(0, 16) };
const base: OrderAttentionFacts = {
  status: "CONFIRMED",
  paymentStatus: "UNPAID",
  courierConsignmentId: null,
  courierStatus: null,
  courierSyncError: null,
  followUpAt: null,
  partialDeliveryReconciledAt: null,
};

describe("suggestedNextOrderStatus", () => {
  it("follows the happy path while the state machine allows it", () => {
    expect(suggestedNextOrderStatus("PENDING")).toBe("CONFIRMED");
    expect(suggestedNextOrderStatus("PACKED")).toBe("SHIPPED");
    expect(suggestedNextOrderStatus("SHIPPED")).toBe("DELIVERED");
  });
  it("suggests nothing at the end of the path or off it", () => {
    expect(suggestedNextOrderStatus("DELIVERED")).toBeNull();
    expect(suggestedNextOrderStatus("CANCELLED")).toBeNull();
  });
});

describe("orderAttentionItems", () => {
  it("nothing for a healthy order", () => {
    expect(orderAttentionItems(base, fmt)).toEqual([]);
  });

  it("cancelled with money held is the most urgent item, with the amount owed", () => {
    const items = orderAttentionItems({ ...base, status: "CANCELLED", paymentStatus: "PAID", payment: { refundDue: 1200, refundPending: 0 } }, fmt);
    expect(items[0]).toMatchObject({ key: "cancelled-paid", tone: "danger", detail: "৳1200 is owed back to the customer." });
  });

  it("flags courier trouble only while the parcel is still on its way", () => {
    const shipped = { ...base, status: "SHIPPED" as const, courierConsignmentId: "C1", courierStatus: "hold", courierSyncError: "timeout" };
    expect(orderAttentionItems(shipped, fmt).map((i) => i.key)).toEqual(["courier-sync", "courier-hold"]);
    expect(orderAttentionItems({ ...shipped, status: "DELIVERED" }, fmt)).toEqual([]);
  });

  it("a follow-up is a warning once due, info before", () => {
    const now = new Date("2026-10-08T10:00:00Z");
    const due = orderAttentionItems({ ...base, status: "PENDING", followUpAt: "2026-10-08T09:00:00Z" }, fmt, now);
    const later = orderAttentionItems({ ...base, status: "PENDING", followUpAt: "2026-10-09T09:00:00Z" }, fmt, now);
    expect(due[0]).toMatchObject({ key: "follow-up", tone: "warning", label: "Follow-up call due" });
    expect(later[0]).toMatchObject({ key: "follow-up", tone: "info" });
  });

  it("pending return and exchange requests, and unreconciled partial deliveries", () => {
    expect(orderAttentionItems({ ...base, returnRequests: [{ status: "PENDING", type: "EXCHANGE" }] }, fmt)[0]!.label).toBe("Exchange request awaiting review");
    expect(orderAttentionItems({ ...base, status: "PARTIALLY_DELIVERED" }, fmt)[0]!.key).toBe("partial");
  });
});

describe("primaryOrderAction (Blueprint V2 K6)", () => {
  const f = (status: OrderAttentionFacts["status"], extra: Partial<OrderAttentionFacts> = {}) => ({ ...base, status, ...extra });
  it("follows the fulfilment table", () => {
    expect(primaryOrderAction(f("PENDING"), { courierAvailable: true })).toMatchObject({ kind: "transition", to: "CONFIRMED", label: "Confirm order" });
    expect(primaryOrderAction(f("CONFIRMED"), { courierAvailable: true })).toMatchObject({ kind: "book_courier" });
    expect(primaryOrderAction(f("PROCESSING"), { courierAvailable: false })).toMatchObject({ kind: "transition", to: "PACKED", label: "Mark packed" });
    expect(primaryOrderAction(f("PACKED"), { courierAvailable: true })).toMatchObject({ kind: "transition", to: "SHIPPED", label: "Mark shipped" });
    expect(primaryOrderAction(f("SHIPPED"), { courierAvailable: true })).toBeNull();
    expect(primaryOrderAction(f("PARTIALLY_DELIVERED"), { courierAvailable: true })).toMatchObject({ kind: "reconcile" });
  });
  it("a booked order is packed next, not booked again", () => {
    expect(primaryOrderAction(f("CONFIRMED", { courierConsignmentId: "C1" }), { courierAvailable: true })).toMatchObject({ kind: "transition", to: "PACKED" });
  });
  it("money owed back is the action when nothing else is", () => {
    expect(primaryOrderAction(f("CANCELLED", { payment: { refundDue: 500, refundPending: 0 } }), { courierAvailable: true })).toMatchObject({ kind: "record_refund" });
    expect(primaryOrderAction(f("DELIVERED"), { courierAvailable: true })).toBeNull();
  });
});
