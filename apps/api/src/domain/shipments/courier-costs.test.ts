import { describe, expect, it } from "vitest";
import {
  courierCostFigures,
  exchangeCostSummary,
  reconcileBlocker,
  type ShipmentCostInput,
} from "@clothing-brand/shared";

/** A finished return leg with a confirmed charge and a verified contribution — tweak per case. Minor units (paisa). */
function leg(overrides: Partial<ShipmentCostInput> = {}): ShipmentCostInput {
  return {
    type: "RETURN",
    operationalStatus: "RETURNED",
    actualCharge: 12_000,
    chargeStatus: "VERIFIED",
    contributionReported: 10_000,
    contributionVerified: 10_000,
    contributionStatus: "VERIFIED",
    uncoveredTreatment: "UNDECIDED",
    excessTreatment: "UNDECIDED",
    reconciled: false,
    reviewReason: null,
    ...overrides,
  };
}

describe("courierCostFigures — one shipment", () => {
  it("customer paid less than the actual charge: the rest is uncovered", () => {
    const f = courierCostFigures(leg());
    expect(f).toMatchObject({ confirmedCharge: 12_000, allocatedContribution: 10_000, uncovered: 2_000, excess: 0, provisional: false });
    expect(f.financialStatus).toBe("PARTIALLY_COVERED");
  });

  it("customer paid exactly the charge: fully covered", () => {
    const f = courierCostFigures(leg({ contributionReported: 12_000, contributionVerified: 12_000 }));
    expect(f).toMatchObject({ uncovered: 0, excess: 0, financialStatus: "FULLY_COVERED" });
  });

  it("customer paid more: the excess waits for review, nothing is uncovered", () => {
    const f = courierCostFigures(leg({ contributionReported: 15_000, contributionVerified: 15_000 }));
    expect(f).toMatchObject({ uncovered: 0, excess: 3_000, allocatedContribution: 12_000, financialStatus: "EXCESS_REVIEW" });
    // Once the excess has a treatment it no longer blocks.
    expect(courierCostFigures(leg({ contributionVerified: 15_000, excessTreatment: "REFUND_DUE" })).financialStatus).toBe("FULLY_COVERED");
  });

  it("customer paid nothing: the whole charge is uncovered", () => {
    const f = courierCostFigures(leg({ contributionReported: 0, contributionVerified: 0 }));
    expect(f).toMatchObject({ uncovered: 12_000, excess: 0, financialStatus: "NOT_COVERED" });
  });

  it("uses the actual charge, never a standard rate: a 150 charge with 115 paid leaves 35", () => {
    const f = courierCostFigures(leg({ actualCharge: 15_000, contributionReported: 11_500, contributionVerified: 11_500 }));
    expect(f.uncovered).toBe(3_500);
  });

  it("a reported but unverified contribution covers nothing yet — the record awaits verification", () => {
    const f = courierCostFigures(leg({ contributionVerified: null, contributionStatus: "REPORTED" }));
    expect(f).toMatchObject({ allocatedContribution: 0, financialStatus: "AWAITING_CONTRIBUTION" });
    expect(f.uncovered).toBe(12_000);
    expect(f.reportedContribution).toBe(10_000);
  });

  it("a contribution marked unverified stays visible but is not counted against the charge", () => {
    const f = courierCostFigures(leg({ contributionVerified: null, contributionStatus: "UNVERIFIED" }));
    expect(f).toMatchObject({ reportedContribution: 10_000, allocatedContribution: 0, uncovered: 12_000, financialStatus: "NOT_COVERED" });
  });

  it("no contribution recorded yet on a returned parcel → awaiting contribution details", () => {
    const f = courierCostFigures(leg({ contributionReported: null, contributionVerified: null, contributionStatus: "NOT_RECORDED" }));
    expect(f.financialStatus).toBe("AWAITING_CONTRIBUTION");
  });

  it("an entered but unverified charge is provisional: never counted as a confirmed expense", () => {
    const f = courierCostFigures(leg({ chargeStatus: "ENTERED" }));
    expect(f).toMatchObject({ confirmedCharge: null, provisional: true, financialStatus: "AWAITING_ACTUAL_CHARGE" });
    expect(f.uncovered).toBe(2_000); // shown, but provisional
  });

  it("no charge at all → awaiting actual charge, nothing calculated", () => {
    const f = courierCostFigures(leg({ actualCharge: null, chargeStatus: "MISSING" }));
    expect(f).toMatchObject({ confirmedCharge: null, uncovered: null, excess: null, financialStatus: "AWAITING_ACTUAL_CHARGE" });
  });

  it("a courier-confirmed charge counts as confirmed", () => {
    expect(courierCostFigures(leg({ chargeStatus: "COURIER_CONFIRMED" })).confirmedCharge).toBe(12_000);
  });

  it("a normal delivery: the customer paid shipping in the order, so no contribution applies", () => {
    const f = courierCostFigures(leg({ type: "OUTBOUND", operationalStatus: "DELIVERED", contributionStatus: "NOT_RECORDED", contributionReported: null, contributionVerified: null }));
    expect(f).toMatchObject({ contributionApplies: false, uncovered: null, excess: null, confirmedCharge: 12_000, financialStatus: "RECONCILED" });
  });

  it("a refused outbound parcel (returned / partial) takes contributions", () => {
    expect(courierCostFigures(leg({ type: "OUTBOUND", operationalStatus: "RETURNED" })).contributionApplies).toBe(true);
    expect(courierCostFigures(leg({ type: "OUTBOUND", operationalStatus: "PARTIALLY_DELIVERED" })).contributionApplies).toBe(true);
  });

  it("a leg still on its way is not due — nothing is awaited from anyone yet", () => {
    const f = courierCostFigures(leg({ operationalStatus: "RETURN_IN_TRANSIT", actualCharge: null, chargeStatus: "MISSING" }));
    expect(f.financialStatus).toBe("NOT_DUE");
    expect(courierCostFigures(leg({ type: "OUTBOUND", operationalStatus: "IN_TRANSIT", actualCharge: null, chargeStatus: "MISSING" })).financialStatus).toBe("NOT_DUE");
  });

  it("a booking voided before pickup with no charge is not due", () => {
    expect(courierCostFigures(leg({ type: "OUTBOUND", operationalStatus: "CANCELLED", actualCharge: null, chargeStatus: "MISSING" })).financialStatus).toBe("NOT_DUE");
  });

  it("a review flag wins over everything, then an explicit reconciliation", () => {
    expect(courierCostFigures(leg({ reviewReason: "Payout total differs" })).financialStatus).toBe("NEEDS_REVIEW");
    expect(courierCostFigures(leg({ reconciled: true, uncoveredTreatment: "ABSORBED" })).financialStatus).toBe("RECONCILED");
  });

  it("an uncovered amount is not a receivable unless someone says so", () => {
    const f = courierCostFigures(leg());
    expect(f).toMatchObject({ absorbed: 0, receivable: 0, undecidedUncovered: 2_000 });
    expect(courierCostFigures(leg({ uncoveredTreatment: "ABSORBED" }))).toMatchObject({ absorbed: 2_000, receivable: 0, undecidedUncovered: 0 });
    expect(courierCostFigures(leg({ uncoveredTreatment: "RECEIVABLE" }))).toMatchObject({ absorbed: 0, receivable: 2_000 });
    expect(courierCostFigures(leg({ uncoveredTreatment: "RECOVERED" }))).toMatchObject({ receivable: 0, recovered: 2_000 });
  });

  it("refuses negative or fractional money", () => {
    expect(() => courierCostFigures(leg({ actualCharge: -1 }))).toThrow();
    expect(() => courierCostFigures(leg({ contributionVerified: 1.5 }))).toThrow();
  });
});

describe("reconcileBlocker", () => {
  it("lists what still stands between the record and 'reconciled'", () => {
    expect(reconcileBlocker(leg({ actualCharge: null, chargeStatus: "MISSING" }))).toMatch(/charge/i);
    expect(reconcileBlocker(leg({ chargeStatus: "ENTERED" }))).toMatch(/verif/i);
    expect(reconcileBlocker(leg({ contributionStatus: "REPORTED", contributionVerified: null }))).toMatch(/contribution/i);
    expect(reconcileBlocker(leg())).toMatch(/uncovered/i);
    expect(reconcileBlocker(leg({ contributionVerified: 15_000 }))).toMatch(/excess/i);
    expect(reconcileBlocker(leg({ operationalStatus: "RETURN_IN_TRANSIT" }))).toMatch(/finished|on its way/i);
    expect(reconcileBlocker(leg({ uncoveredTreatment: "ABSORBED" }))).toBeNull();
    expect(reconcileBlocker(leg({ contributionVerified: 12_000 }))).toBeNull();
  });
});

describe("exchangeCostSummary — the legs of one exchange", () => {
  const returnLeg = leg({ actualCharge: 12_000, contributionReported: 10_000, contributionVerified: 10_000 });
  const replacement = leg({ type: "REPLACEMENT", operationalStatus: "DELIVERED", actualCharge: 5_500, contributionReported: 0, contributionVerified: 0 });

  it("the brief's example: 120 return + 55 replacement = 175 expense; 100 paid → 75 uncovered", () => {
    const s = exchangeCostSummary([returnLeg, replacement]);
    expect(s).toMatchObject({ actualExpense: 17_500, verifiedContribution: 10_000, allocatedContribution: 10_000, uncovered: 7_500, excess: 0, provisional: false });
    expect(s.financialStatus).toBe("PARTIALLY_COVERED");
  });

  it("an excess the admin applies to the exchange covers the other legs — counted once", () => {
    const overpaid = leg({ actualCharge: 12_000, contributionReported: 15_000, contributionVerified: 15_000, excessTreatment: "ALLOCATED_WITHIN_EXCHANGE" });
    const s = exchangeCostSummary([overpaid, replacement]);
    // 30 excess applied to the 55 replacement → 25 uncovered; no excess left over.
    expect(s).toMatchObject({ actualExpense: 17_500, uncovered: 2_500, excess: 0, excessAppliedWithinExchange: 3_000, verifiedContribution: 15_000 });
    // More excess than the other legs need: the rest is excess again, awaiting review.
    const big = leg({ actualCharge: 12_000, contributionVerified: 20_000, contributionReported: 20_000, excessTreatment: "ALLOCATED_WITHIN_EXCHANGE" });
    expect(exchangeCostSummary([big, replacement])).toMatchObject({ uncovered: 0, excess: 2_500, excessAwaitingReview: 2_500, financialStatus: "EXCESS_REVIEW" });
  });

  it("excess not applied to the exchange stays with its own leg", () => {
    const overpaid = leg({ actualCharge: 12_000, contributionVerified: 15_000, contributionReported: 15_000, excessTreatment: "REFUND_DUE" });
    expect(exchangeCostSummary([overpaid, replacement])).toMatchObject({ uncovered: 5_500, excess: 3_000, excessAwaitingReview: 0 });
  });

  it("an unconfirmed leg makes the whole summary provisional and the status awaits the charge", () => {
    const s = exchangeCostSummary([returnLeg, { ...replacement, chargeStatus: "ENTERED" }]);
    expect(s.provisional).toBe(true);
    expect(s.actualExpense).toBe(12_000); // confirmed only
    expect(s.financialStatus).toBe("AWAITING_ACTUAL_CHARGE");
  });

  it("all legs reconciled → reconciled; empty exchange → not due", () => {
    const done = [leg({ reconciled: true, uncoveredTreatment: "ABSORBED" }), leg({ type: "REPLACEMENT", operationalStatus: "DELIVERED", reconciled: true, contributionVerified: 12_000 })];
    expect(exchangeCostSummary(done).financialStatus).toBe("RECONCILED");
    expect(exchangeCostSummary([]).financialStatus).toBe("NOT_DUE");
  });
});
