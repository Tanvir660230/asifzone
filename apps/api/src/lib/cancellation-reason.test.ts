import { describe, expect, it } from "vitest";
import { bulkOrderStatusSchema, cancellationReasonMissing, reviewReturnRequestSchema, transitionNeedsReason, transitionReasonMissing, updateOrderStatusSchema } from "@clothing-brand/shared";

// Owner decision D22: an admin cancelling an order gives a reason (single and bulk status changes).
describe("cancellation reason", () => {
  it("is required when cancelling one order", () => {
    expect(updateOrderStatusSchema.safeParse({ status: "CANCELLED" }).success).toBe(false);
    expect(updateOrderStatusSchema.safeParse({ status: "CANCELLED", note: "  " }).success).toBe(false);
    expect(updateOrderStatusSchema.safeParse({ status: "CANCELLED", note: "Customer changed their mind" }).success).toBe(true);
  });

  it("is required when cancelling in bulk", () => {
    const ids = ["ckq9z0b0h0000a1b2c3d4e5f6"];
    expect(bulkOrderStatusSchema.safeParse({ ids, status: "CANCELLED" }).success).toBe(false);
    expect(bulkOrderStatusSchema.safeParse({ ids, status: "CANCELLED", note: "Duplicate orders" }).success).toBe(true);
  });

  it("is not required for any other move", () => {
    expect(updateOrderStatusSchema.safeParse({ status: "CONFIRMED" }).success).toBe(true);
    expect(bulkOrderStatusSchema.safeParse({ ids: ["ckq9z0b0h0000a1b2c3d4e5f6"], status: "PACKED" }).success).toBe(true);
    expect(cancellationReasonMissing("SHIPPED", null)).toBe(false);
  });
});

// DR-8: the T3 correction (SHIPPED → PACKED) and a return rejection need a reason too.
describe("required reasons (DR-8)", () => {
  it("names the moves that need one", () => {
    expect(transitionNeedsReason("CONFIRMED", "CANCELLED")).toBe("cancel");
    expect(transitionNeedsReason("SHIPPED", "PACKED")).toBe("correction");
    expect(transitionNeedsReason("PROCESSING", "PACKED")).toBeNull();
    expect(transitionReasonMissing("SHIPPED", "PACKED", "ok")).toBe(true);
    expect(transitionReasonMissing("SHIPPED", "PACKED", "marked shipped too early")).toBe(false);
  });

  it("a return rejection tells the customer why; an approval needs no note", () => {
    expect(reviewReturnRequestSchema.safeParse({ status: "REJECTED", adminNote: null }).success).toBe(false);
    expect(reviewReturnRequestSchema.safeParse({ status: "REJECTED", adminNote: "Worn and washed" }).success).toBe(true);
    expect(reviewReturnRequestSchema.safeParse({ status: "APPROVED", adminNote: null }).success).toBe(true);
  });
});
