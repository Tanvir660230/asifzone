import { describe, expect, it } from "vitest";
import { checkoutDistrict, checkoutSchema, guessDistrictFromAddress, resolveShipping, type ShippingZoneRule } from "@clothing-brand/shared";

const d = (text: string) => guessDistrictFromAddress(text)?.district ?? null;

describe("guessDistrictFromAddress", () => {
  it("reads the district in English or Bangla", () => {
    expect(d("House 12, Road 3, Mirpur 10, Dhaka")).toBe("Dhaka");
    expect(d("বাসা ১২, মিরপুর ১০, ঢাকা")).toBe("Dhaka");
    expect(d("আগ্রাবাদ, চট্টগ্রাম")).toBe("Chattogram");
    expect(d("Chittagong agrabad")).toBe("Chattogram");
    expect(d("কুমিল্লা সদর")).toBe("Cumilla");
    expect(d("গ্রাম: চরপাড়া, ময়মনসিংহ")).toBe("Mymensingh");
    expect(d("Coxs bazar")).toBe("Cox's Bazar");
  });

  it("prefers the real district over a trailing Dhaka", () => {
    expect(d("Gazipur, Dhaka")).toBe("Gazipur");
    expect(d("কালিয়াকৈর, গাজীপুর, ঢাকা")).toBe("Gazipur");
  });

  it("knows Dhaka city areas, but a written district still wins", () => {
    expect(d("Uttara sector 7")).toBe("Dhaka");
    expect(d("ধানমন্ডি ২৭")).toBe("Dhaka");
    expect(d("Mirpur, Kushtia")).toBe("Kushtia");
  });

  it("gives up when it is unclear or absent", () => {
    expect(d("বগুড়া শেরপুর")).toBeNull();
    expect(d("near the big mosque")).toBeNull();
    expect(d("")).toBeNull();
  });
});

describe("checkoutDistrict", () => {
  it("keeps a picked district and derives its division", () => {
    expect(checkoutDistrict({ shippingDistrict: "Feni", shippingAddressLine: "Mirpur, Dhaka" })).toEqual({ district: "Feni", division: "Chattogram", unknown: false });
  });
  it("falls back to the address, then to unknown", () => {
    expect(checkoutDistrict({ shippingDistrict: "", shippingAddressLine: "Savar" })).toEqual({ district: "Dhaka", division: "Dhaka", unknown: false });
    expect(checkoutDistrict({ shippingDistrict: "", shippingAddressLine: "near the market" })).toEqual({ district: "", division: "", unknown: true });
  });
});

describe("checkout without district or thana", () => {
  it("accepts an order with only the address", () => {
    const parsed = checkoutSchema.safeParse({
      items: [{ variantId: "cm1234567890abcdefghijklm", quantity: 1 }],
      customerName: "Rahim",
      customerPhone: "01712345678",
      shippingAddressLine: "বাসা ১২, মিরপুর",
      paymentMethod: "COD",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect([parsed.data.shippingDistrict, parsed.data.shippingArea, parsed.data.shippingDivision]).toEqual(["", "", ""]);
  });

  const money = (amount: number) => ({ amount, currency: "BDT" });
  const zones = [
    { id: "z1", key: "dhaka-district", name: "Inside Dhaka", isActive: true, isDefault: false, priority: 0, matches: [{ field: "DISTRICT", value: "Dhaka" }], fee: money(60), freeOverAmount: null },
    { id: "z2", key: "default", name: "Rest of the country", isActive: true, isDefault: true, priority: 0, matches: [], fee: money(120), freeOverAmount: null },
  ] as unknown as ShippingZoneRule[];

  it("charges the default zone when the district is unknown, and still asks when the caller did not opt in", () => {
    const opts = { couponFreeShipping: false };
    const unknown = resolveShipping(zones, { unknownUsesDefault: true }, money(1000) as never, opts);
    expect(unknown.ok && unknown.zoneKey).toBe("default");
    expect(resolveShipping(zones, {}, money(1000) as never, opts)).toEqual({ ok: false, reason: "ADDRESS_REQUIRED" });
    const dhaka = resolveShipping(zones, { district: "Dhaka" }, money(1000) as never, opts);
    expect(dhaka.ok && dhaka.zoneKey).toBe("dhaka-district");
  });
});
