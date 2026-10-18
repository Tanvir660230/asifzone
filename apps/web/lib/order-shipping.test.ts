import { describe, expect, it } from "vitest";
import { orderShippingCharged } from "./order-shipping";

describe("orderShippingCharged", () => {
  it("is 0 when the order's delivery was waived (free delivery, a coupon, free over an amount)", () => {
    // The order keeps the zone's fee for reference; the customer was charged nothing for it.
    expect(orderShippingCharged({ shippingFee: "60.00", shippingWaived: true })).toBe(0);
  });

  it("is the fee when it was charged", () => {
    expect(orderShippingCharged({ shippingFee: "120.00", shippingWaived: false })).toBe(120);
  });

  it("falls back to the fee for orders from before the waiver was recorded", () => {
    expect(orderShippingCharged({ shippingFee: "60.00", shippingWaived: null })).toBe(60);
    expect(orderShippingCharged({ shippingFee: "60.00" })).toBe(60);
  });
});
