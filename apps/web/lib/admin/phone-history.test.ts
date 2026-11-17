import { describe, expect, it } from "vitest";
import type { Address, AdminOrderListItem } from "@clothing-brand/shared";
import { phoneKey, summarizePhoneHistory, withSavedAddresses } from "./phone-history";

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

  it("lists every distinct address newest first, merging the same place typed differently", () => {
    const h = summarizePhoneHistory(
      [
        order({ createdAt: "2026-09-01T10:00:00Z", shippingAddressLine: "House 1" }),
        order({ createdAt: "2026-09-10T10:00:00Z", shippingAddressLine: "house  1,", status: "RETURNED" }),
        order({ createdAt: "2026-10-20T10:00:00Z", shippingDistrict: "Chattogram", shippingArea: "Halishahar", shippingAddressLine: "Road 5", customerName: "Rahim Uddin" }),
      ],
      "01712345678",
    )!;
    expect(h.addresses).toHaveLength(2);
    expect(h.addresses[0]).toMatchObject({ shippingDistrict: "Chattogram", customerName: "Rahim Uddin", times: 1 });
    expect(h.addresses[1]).toMatchObject({ shippingArea: "Mirpur", times: 2, delivered: 1 });
  });

  it("adds a linked customer's saved addresses that no order went to, default first", () => {
    const saved = (a: Partial<Address>) =>
      ({ id: "a", customerId: "c", label: null, fullName: "Rahim", phone: "01712345678", division: "Dhaka", district: "Dhaka", area: "Mirpur", addressLine: "House 1", isDefault: false, createdAt: "2026-08-01T00:00:00Z", ...a }) as Address;
    const h = summarizePhoneHistory([order({})], "01712345678");
    const list = withSavedAddresses(h, [saved({ area: "Banani", addressLine: "Road 11" }), saved({}), saved({ area: "Gulshan", addressLine: "Road 2", isDefault: true })]);
    expect(list.map((a) => a.shippingArea)).toEqual(["Mirpur", "Gulshan", "Banani"]);
    expect(list[1]).toMatchObject({ times: 0 });
    // No order history: saved addresses alone.
    expect(withSavedAddresses(null, [saved({})])).toHaveLength(1);
  });

  it("is nothing for a new number", () => {
    expect(summarizePhoneHistory([order({ customerPhone: "01811111111" })], "01712345678")).toBeNull();
  });
});
