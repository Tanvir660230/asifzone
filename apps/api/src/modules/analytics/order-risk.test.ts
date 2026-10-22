import { describe, it, expect } from "vitest";
import { orderRisk, type PhoneHistory } from "./order-risk";

const none: PhoneHistory = { delivered: 0, partial: 0, refused: 0, cancelledBeforeBooking: 0, open: 0, refusedCodValue: 0 };
const h = (p: Partial<PhoneHistory>): PhoneHistory => ({ ...none, ...p });

describe("orderRisk", () => {
  it("a first order of ordinary value is low risk, with nothing to explain", () => {
    expect(orderRisk({ history: none, orderValue: 90_000, currency: "BDT" })).toEqual({ level: "low", reasons: [], trusted: false });
  });

  it("refused twice at this store is high", () => {
    const r = orderRisk({ history: h({ refused: 2, delivered: 1, refusedCodValue: 180_000 }), orderValue: 90_000, currency: "BDT" });
    expect(r.level).toBe("high");
    expect(r.reasons[0]).toBe("Refused 2 parcels here before (৳1,800 COD)");
  });

  it("refused once and never received a parcel is high; refused once among deliveries is medium", () => {
    expect(orderRisk({ history: h({ refused: 1 }), orderValue: 90_000, currency: "BDT" }).level).toBe("high");
    expect(orderRisk({ history: h({ refused: 1, delivered: 3 }), orderValue: 90_000, currency: "BDT" }).level).toBe("medium");
  });

  it("several cancellations before booking with no delivery is medium", () => {
    const r = orderRisk({ history: h({ cancelledBeforeBooking: 2 }), orderValue: 90_000, currency: "BDT" });
    expect(r).toMatchObject({ level: "medium", reasons: ["2 earlier orders cancelled before sending"] });
  });

  it("a first order of ৳2,000 or more is medium (big first orders are refused far more often)", () => {
    expect(orderRisk({ history: none, orderValue: 200_000, currency: "BDT" })).toMatchObject({ level: "medium", reasons: ["First order, ৳2,000 or more"] });
    expect(orderRisk({ history: h({ delivered: 1 }), orderValue: 200_000, currency: "BDT" }).level).toBe("low");
  });

  it("a weak courier-wide score adds a reason and at least medium", () => {
    const r = orderRisk({ history: none, orderValue: 90_000, currency: "BDT", courierSuccessRate: 45 });
    expect(r).toMatchObject({ level: "medium", reasons: ["Courier success rate 45% across all shops"] });
    expect(orderRisk({ history: none, orderValue: 90_000, currency: "BDT", courierSuccessRate: null }).level).toBe("low");
  });

  it("two or more deliveries and no refusal is trusted", () => {
    expect(orderRisk({ history: h({ delivered: 2 }), orderValue: 300_000, currency: "BDT" })).toEqual({ level: "low", reasons: [], trusted: true });
  });
});
