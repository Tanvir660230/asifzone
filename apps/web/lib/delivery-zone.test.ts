import { describe, expect, it } from "vitest";
import { bdZoneChoiceLabel, money, resolveShipping, zoneChoiceNeeded, zoneChoices, type ShippingZoneRule } from "@clothing-brand/shared";

// The store's zones as they are live on every installation (2026-11-25): Dhaka district ৳60, everywhere else ৳120.
const BDT = (n: number) => money(n * 100, "BDT");
const zones: ShippingZoneRule[] = [
  { id: "z1", key: "dhaka-district", name: "Inside Dhaka district", priority: 10, isDefault: false, isActive: true, matches: [{ field: "DISTRICT", value: "Dhaka" }], fee: BDT(60), freeOverAmount: null },
  { id: "z2", key: "default", name: "Rest of the country", priority: 0, isDefault: true, isActive: true, matches: [], fee: BDT(120), freeOverAmount: null },
];
const cart = BDT(1000);
const paid = { couponFreeShipping: false };

describe("delivery zone chosen when the address names no place", () => {
  it("prices the chosen zone; a written place still decides over a choice", () => {
    const inside = resolveShipping(zones, { unknownUsesDefault: true, zoneKey: "dhaka-district" }, cart, paid);
    expect(inside.ok && inside.charged.amount).toBe(6000);
    const nothing = resolveShipping(zones, { unknownUsesDefault: true }, cart, paid);
    expect(nothing.ok && nothing.zoneKey).toBe("default");
    const placeWins = resolveShipping(zones, { district: "Gazipur", zoneKey: "dhaka-district" }, cart, paid);
    expect(placeWins.ok && placeWins.zoneKey).toBe("default");
    const unknownKey = resolveShipping(zones, { unknownUsesDefault: true, zoneKey: "nope" }, cart, paid);
    expect(unknownKey.ok && unknownKey.zoneKey).toBe("default");
  });

  it("asks only when the choice changes the charge — never for free delivery", () => {
    const choices = zoneChoices(zones, cart, paid).map((c) => ({ ...c, charged: c.charged.amount }));
    expect(choices.map((c) => c.key)).toEqual(["dhaka-district", "default"]);
    expect(zoneChoiceNeeded(choices)).toBe(true);
    const free = zoneChoices(zones, cart, { couponFreeShipping: false, allLinesFreeDelivery: true }).map((c) => ({ ...c, charged: c.charged.amount }));
    expect(free.every((c) => c.waived)).toBe(true);
    expect(zoneChoiceNeeded(free)).toBe(false);
    expect(zoneChoiceNeeded(null)).toBe(false);
  });

  it("says Inside / Outside Dhaka (English and Bangla) for the Dhaka split, the zone's own name otherwise", () => {
    const all = zoneChoices(zones, cart, paid);
    expect(all.map((c) => bdZoneChoiceLabel(c, all, "en"))).toEqual(["Inside Dhaka", "Outside Dhaka"]);
    expect(all.map((c) => bdZoneChoiceLabel(c, all, "bn"))).toEqual(["ঢাকার ভেতরে", "ঢাকার বাইরে"]);
    const other = [{ isDefault: false, districts: ["Gazipur"], name: "Gazipur" }, { isDefault: true, districts: [], name: "Rest" }];
    expect(other.map((c) => bdZoneChoiceLabel(c, other, "en"))).toEqual(["Gazipur", "Rest"]);
  });
});
