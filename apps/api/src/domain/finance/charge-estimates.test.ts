import { describe, it, expect } from "vitest";
import { courierChargeEstimate, courierOutcome, gatewayFeeEstimate, rateCardFor, zoneOf, type RateCard } from "./charge-estimates";

// Owner's books §3.1 / §4: the estimate of a parcel's courier charge and of a gateway fee, in minor units. Pure.

const card = (effectiveFrom: string, inside = 6000): RateCard => ({
  id: `card-${effectiveFrom}`,
  effectiveFrom,
  zones: [
    { name: "Inside Dhaka", districts: ["Dhaka"], areas: [], charge: inside },
    { name: "Sub-Dhaka", districts: [], areas: ["Savar", "Keraniganj", "Dhamrai"], charge: 10000 },
  ],
  defaultCharge: 12000,
  codPercent: 1,
  returnChargePercent: 50,
});

describe("zones", () => {
  it("an area match wins over the district (Savar is in Dhaka district but charged as sub-Dhaka)", () => {
    expect(zoneOf(card("2026-01-01"), "Dhaka", "Savar")).toEqual({ zone: "Sub-Dhaka", charge: 10000 });
    expect(zoneOf(card("2026-01-01"), "Dhaka", "Mirpur")).toEqual({ zone: "Inside Dhaka", charge: 6000 });
    expect(zoneOf(card("2026-01-01"), "Chattogram", "Agrabad")).toEqual({ zone: "Outside", charge: 12000 });
  });
  it("matching ignores case and spaces", () => {
    expect(zoneOf(card("2026-01-01"), "  dhaka ", "savar")).toEqual({ zone: "Sub-Dhaka", charge: 10000 });
  });
});

describe("the card in force on a date", () => {
  it("is the latest card effective on or before it; none before the first card", () => {
    const cards = [card("2026-01-01", 6000), card("2026-10-01", 7000)];
    expect(rateCardFor(cards, "2026-09-30")?.id).toBe("card-2026-01-01");
    expect(rateCardFor(cards, "2026-10-01")?.id).toBe("card-2026-10-01");
    expect(rateCardFor(cards, "2025-12-31")).toBeNull();
  });
});

describe("parcel outcome from the courier status (and the order status when the courier says nothing)", () => {
  it("maps Steadfast's statuses, including the approval-pending ones", () => {
    expect(courierOutcome("delivered", "SHIPPED")).toBe("DELIVERED");
    expect(courierOutcome("delivered_approval_pending", "SHIPPED")).toBe("DELIVERED");
    expect(courierOutcome("partial_delivered", "SHIPPED")).toBe("PARTIAL");
    expect(courierOutcome("cancelled", "SHIPPED")).toBe("RETURNED");
    expect(courierOutcome("cancelled_approval_pending", "CANCELLED")).toBe("RETURNED");
    expect(courierOutcome("in_review", "SHIPPED")).toBeNull();
    expect(courierOutcome(null, "DELIVERED")).toBe("DELIVERED");
    expect(courierOutcome(null, "PARTIALLY_DELIVERED")).toBe("PARTIAL");
    expect(courierOutcome(null, "RETURNED")).toBe("RETURNED");
    expect(courierOutcome("unknown", "PACKED")).toBeNull();
  });
});

describe("courier charge estimate", () => {
  const cards = [card("2026-01-01")];
  it("delivered: zone fee + COD % of what was collected (rounded to the poisha)", () => {
    expect(courierChargeEstimate({ outcome: "DELIVERED", collected: 125050, district: "Dhaka", area: "Mirpur", date: "2026-09-10", cards })).toEqual({
      cardId: "card-2026-01-01", zone: "Inside Dhaka", delivery: 6000, cod: 1251, returnCharge: 0, total: 7251,
    });
  });
  it("partial delivery: the fee and COD on what was actually collected", () => {
    expect(courierChargeEstimate({ outcome: "PARTIAL", collected: 50000, district: "Khulna", area: "Sonadanga", date: "2026-09-10", cards })).toMatchObject({ delivery: 12000, cod: 500, returnCharge: 0, total: 12500 });
  });
  it("returned: only the return charge (a share of the zone fee), no COD", () => {
    expect(courierChargeEstimate({ outcome: "RETURNED", collected: 0, district: "Dhaka", area: "Savar", date: "2026-09-10", cards })).toMatchObject({ zone: "Sub-Dhaka", delivery: 0, cod: 0, returnCharge: 5000, total: 5000 });
  });
  it("no card in force → no estimate (the feature is off until a card exists)", () => {
    expect(courierChargeEstimate({ outcome: "DELIVERED", collected: 1000, district: "Dhaka", area: "", date: "2025-01-01", cards })).toBeNull();
  });
});

describe("gateway fee estimate", () => {
  it("percent of the payment plus the fixed part, rounded", () => {
    expect(gatewayFeeEstimate(189700, [{ id: "r1", effectiveFrom: "2026-01-01", percent: 2.5, fixed: 0 }], "2026-09-01")).toEqual({ rateId: "r1", fee: 4743 });
    expect(gatewayFeeEstimate(100000, [{ id: "r1", effectiveFrom: "2026-01-01", percent: 1.5, fixed: 500 }], "2026-09-01")).toEqual({ rateId: "r1", fee: 2000 });
    expect(gatewayFeeEstimate(100000, [{ id: "r1", effectiveFrom: "2026-10-01", percent: 1.5, fixed: 0 }], "2026-09-01")).toBeNull();
  });
});
