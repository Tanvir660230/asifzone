import { describe, expect, it } from "vitest";
import { bulkOrderStatusSchema, cancellationReasonMissing, updateOrderStatusSchema } from "@clothing-brand/shared";

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
