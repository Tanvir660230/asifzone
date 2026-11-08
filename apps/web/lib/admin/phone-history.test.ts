import { describe, expect, it } from "vitest";
import type { AdminOrderListItem } from "@clothing-brand/shared";
import { phoneKey, summarizePhoneHistory } from "./phone-history";

const order = (o: Partial<AdminOrderListItem>) =>
  ({ deletedAt: null, customerPhone: "01712345678", customerName: "Rahim", shippingDistrict: "Dhaka", shippingArea: "Mirpur", shippingAddressLine: "House 1", status: "DELIVERED", createdAt: "2026-10-01T10:00:00Z", ...o }) as AdminOrderListItem;

describe("phone history", () => {
  it("matches a number however it was saved", () => {
    expect(phoneKey("+8801712345678")).toBe("01712345678");
    expect(phoneKey("01712-345678")).toBe("01712345678");
  });

  it("counts this number's orders only, and takes the newest address", () => {
    const h = summarizePhoneHistory(
      [
        order({ status: "DELIVERED", createdAt: "2026-09-01T10:00:00Z", shippingArea: "Old area" }),
        order({ status: "RETURNED", createdAt: "2026-10-20T10:00:00Z", customerPhone: "+8801712345678", shippingArea: "Uttara" }),
        order({ status: "PARTIALLY_DELIVERED", createdAt: "2026-10-05T10:00:00Z" }),
        order({ customerPhone: "01811111111" }), // a search hit on another number
        order({ deletedAt: "2026-10-30T00:00:00Z" }),
      ],
      "01712345678",
    );
    expect(h).toMatchObject({ orders: 3, delivered: 2, refused: 1, last: { shippingArea: "Uttara" } });
  });

  it("is nothing for a new number", () => {
    expect(summarizePhoneHistory([order({ customerPhone: "01811111111" })], "01712345678")).toBeNull();
  });
});
