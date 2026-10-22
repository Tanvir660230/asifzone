/**
 * Courier cost reconciliation (docs/COURIER_COSTS.md) — the calculation rules for one shipment leg and for the legs of an
 * exchange. Pure, minor units (paisa) only. The API computes and stores the result; the admin drawer runs the same
 * functions to preview a change before it is saved.
 *
 * Rules (§6):
 *   uncovered = max(0, actual charge − verified contribution)        — only when a contribution can apply to the leg
 *   excess    = max(0, verified contribution − actual charge)
 *   A reported or unverified contribution never covers anything; an entered but unverified charge is provisional and is
 *   never counted as a confirmed expense. An uncovered amount is not a receivable until someone records it as one.
 */

export const SHIPMENT_TYPES = ["OUTBOUND", "RETURN", "REPLACEMENT"] as const;
export type ShipmentType = (typeof SHIPMENT_TYPES)[number];

/** The physical leg's progress — mirrors the courier / order lifecycle, never the money. */
export const SHIPMENT_OPERATIONAL_STATUSES = [
  "BOOKED",
  "IN_TRANSIT",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "RETURN_REQUESTED",
  "RETURN_IN_TRANSIT",
  "RETURNED",
  "CANCELLED",
] as const;
export type ShipmentOperationalStatus = (typeof SHIPMENT_OPERATIONAL_STATUSES)[number];

/** How far the actual charge can be trusted. VERIFIED: an authorised admin checked it; COURIER_CONFIRMED: the courier's
 * own figures prove it (a payout's charges add up to it). Only those two count as a confirmed expense. */
export const CHARGE_STATUSES = ["MISSING", "ENTERED", "VERIFIED", "COURIER_CONFIRMED"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export const CHARGE_SOURCES = ["COURIER_PAYOUT", "COURIER_PANEL", "COURIER_INVOICE", "RIDER", "ADMIN_ESTIMATE", "OTHER"] as const;
export type ChargeSource = (typeof CHARGE_SOURCES)[number];

/** What the customer paid the rider toward the courier charge. UNVERIFIED: checked and could not be confirmed — kept on
 * record, never counted. */
export const CONTRIBUTION_STATUSES = ["NOT_RECORDED", "REPORTED", "VERIFIED", "UNVERIFIED"] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export const CONTRIBUTION_SOURCES = ["CUSTOMER", "RIDER", "COURIER_PAYOUT", "COURIER_PANEL", "OTHER"] as const;
export type ContributionSource = (typeof CONTRIBUTION_SOURCES)[number];

/** Who bears an uncovered amount. RECEIVABLE: genuinely owed by the customer or another party; RECOVERED: that money came in. */
export const UNCOVERED_TREATMENTS = ["UNDECIDED", "ABSORBED", "RECEIVABLE", "RECOVERED"] as const;
export type UncoveredTreatment = (typeof UNCOVERED_TREATMENTS)[number];

export const EXCESS_TREATMENTS = ["UNDECIDED", "REFUND_DUE", "REFUNDED", "KEPT_BY_COURIER", "OTHER_INCOME", "ALLOCATED_WITHIN_EXCHANGE"] as const;
export type ExcessTreatment = (typeof EXCESS_TREATMENTS)[number];

export const SHIPMENT_FINANCIAL_STATUSES = [
  "NOT_DUE",
  "AWAITING_ACTUAL_CHARGE",
  "AWAITING_CONTRIBUTION",
  "EXCESS_REVIEW",
  "NOT_COVERED",
  "PARTIALLY_COVERED",
  "FULLY_COVERED",
  "RECONCILED",
  "NEEDS_REVIEW",
] as const;
export type ShipmentFinancialStatus = (typeof SHIPMENT_FINANCIAL_STATUSES)[number];

export interface ShipmentCostInput {
  type: ShipmentType;
  operationalStatus: ShipmentOperationalStatus;
  /** Minor units; null = not known yet. */
  actualCharge: number | null;
  chargeStatus: ChargeStatus;
  contributionReported: number | null;
  contributionVerified: number | null;
  contributionStatus: ContributionStatus;
  uncoveredTreatment: UncoveredTreatment;
  excessTreatment: ExcessTreatment;
  /** An authorised admin closed the record (and nothing changed since). */
  reconciled: boolean;
  /** Set by the system when something disagrees (e.g. a payout's charges don't add up to the recorded ones). */
  reviewReason: string | null;
}

export interface ShipmentCostFigures {
  contributionApplies: boolean;
  /** The actual charge when VERIFIED / COURIER_CONFIRMED; null otherwise — never an estimate. */
  confirmedCharge: number | null;
  reportedContribution: number;
  /** The verified contribution (0 unless VERIFIED). */
  verifiedContribution: number;
  /** The part of the verified contribution that went to this leg's charge (capped at the charge). */
  allocatedContribution: number;
  /** null when no charge is known or no contribution applies to the leg. */
  uncovered: number | null;
  excess: number | null;
  /** Uncovered, split by its treatment. */
  undecidedUncovered: number;
  absorbed: number;
  receivable: number;
  recovered: number;
  excessAwaitingReview: number;
  /** Some figure rests on an unconfirmed charge or an unverified contribution. */
  provisional: boolean;
  financialStatus: ShipmentFinancialStatus;
}

const FINISHED: ReadonlySet<ShipmentOperationalStatus> = new Set(["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED"]);

function money(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${field} must be a whole, non-negative amount in minor units (got ${value})`);
  return value;
}

/** A refused / partly delivered outbound parcel and every return or replacement leg can take a contribution; a normal
 * delivery can't — the customer paid shipping inside the order. */
export function contributionApplies(type: ShipmentType, status: ShipmentOperationalStatus): boolean {
  return type !== "OUTBOUND" || status === "RETURNED" || status === "PARTIALLY_DELIVERED";
}

export function isLegDue(input: Pick<ShipmentCostInput, "operationalStatus" | "actualCharge">): boolean {
  if (!FINISHED.has(input.operationalStatus)) return false;
  // A booking voided before pickup costs nothing unless a charge was actually recorded for it.
  return !(input.operationalStatus === "CANCELLED" && input.actualCharge === null);
}

export const isChargeConfirmed = (status: ChargeStatus) => status === "VERIFIED" || status === "COURIER_CONFIRMED";

export function courierCostFigures(input: ShipmentCostInput): ShipmentCostFigures {
  const charge = money(input.actualCharge, "actualCharge");
  const reported = money(input.contributionReported, "contributionReported") ?? 0;
  const verifiedRaw = money(input.contributionVerified, "contributionVerified");
  const applies = contributionApplies(input.type, input.operationalStatus);
  const confirmed = charge !== null && isChargeConfirmed(input.chargeStatus);

  const verified = applies && input.contributionStatus === "VERIFIED" ? (verifiedRaw ?? 0) : 0;
  const uncovered = applies && charge !== null ? Math.max(0, charge - verified) : null;
  const excess = applies && charge !== null ? Math.max(0, verified - charge) : null;
  const allocated = charge === null ? 0 : Math.min(verified, charge);
  const u = uncovered ?? 0;
  const contributionOpen = applies && (input.contributionStatus === "NOT_RECORDED" || input.contributionStatus === "REPORTED");

  return {
    contributionApplies: applies,
    confirmedCharge: confirmed ? charge : null,
    reportedContribution: applies ? reported : 0,
    verifiedContribution: verified,
    allocatedContribution: allocated,
    uncovered,
    excess,
    undecidedUncovered: input.uncoveredTreatment === "UNDECIDED" ? u : 0,
    absorbed: input.uncoveredTreatment === "ABSORBED" ? u : 0,
    receivable: input.uncoveredTreatment === "RECEIVABLE" ? u : 0,
    recovered: input.uncoveredTreatment === "RECOVERED" ? u : 0,
    excessAwaitingReview: input.excessTreatment === "UNDECIDED" ? (excess ?? 0) : 0,
    provisional: (charge !== null && !confirmed) || contributionOpen,
    financialStatus: financialStatusOf(input, { applies, confirmed, verified, uncovered, excess }),
  };
}

function financialStatusOf(
  input: ShipmentCostInput,
  f: { applies: boolean; confirmed: boolean; verified: number; uncovered: number | null; excess: number | null },
): ShipmentFinancialStatus {
  if (input.reviewReason) return "NEEDS_REVIEW";
  if (!isLegDue(input)) return "NOT_DUE";
  if (input.reconciled) return "RECONCILED";
  if (!f.confirmed) return "AWAITING_ACTUAL_CHARGE";
  // Nothing else to settle on a normal delivery once its charge is confirmed.
  if (!f.applies) return "RECONCILED";
  if (input.contributionStatus === "NOT_RECORDED" || input.contributionStatus === "REPORTED") return "AWAITING_CONTRIBUTION";
  if ((f.excess ?? 0) > 0 && input.excessTreatment === "UNDECIDED") return "EXCESS_REVIEW";
  if ((f.uncovered ?? 0) > 0) return f.verified > 0 ? "PARTIALLY_COVERED" : "NOT_COVERED";
  return "FULLY_COVERED";
}

/** Why the record can't be marked reconciled yet, in the admin's words; null when it can. */
export function reconcileBlocker(input: ShipmentCostInput): string | null {
  if (input.reviewReason) return `Resolve the review flag first: ${input.reviewReason}`;
  if (!FINISHED.has(input.operationalStatus)) return "The parcel is still on its way — reconcile it once the leg has finished";
  if (!isLegDue(input)) return "Nothing is due on this leg — the booking was voided before pickup";
  if (input.actualCharge === null) return "Enter the actual courier charge first";
  if (!isChargeConfirmed(input.chargeStatus)) return "Verify the actual charge first (check it against the courier's panel or invoice)";
  const f = courierCostFigures({ ...input, reviewReason: null, reconciled: false });
  if (f.contributionApplies) {
    if (input.contributionStatus === "NOT_RECORDED") return "Record the customer's contribution to the rider (0 if they paid nothing)";
    if (input.contributionStatus === "REPORTED") return "Verify the customer's contribution, or mark it unverified";
    if ((f.excess ?? 0) > 0 && input.excessTreatment === "UNDECIDED") return "Decide what happens to the excess contribution";
    if ((f.uncovered ?? 0) > 0 && input.uncoveredTreatment === "UNDECIDED") return "Decide who bears the uncovered cost (absorbed by the business, or a receivable)";
  }
  return null;
}

export interface ExchangeCostSummary {
  legs: number;
  /** Confirmed charges only. */
  actualExpense: number;
  reportedContribution: number;
  verifiedContribution: number;
  /** Verified contributions that went to charges, including excess applied across the exchange. */
  allocatedContribution: number;
  uncovered: number;
  /** Excess left after any applied across the exchange. */
  excess: number;
  excessAwaitingReview: number;
  /** Excess the admin applied to the exchange's other legs (counted once). */
  excessAppliedWithinExchange: number;
  provisional: boolean;
  financialStatus: ShipmentFinancialStatus;
}

const ATTENTION_ORDER: ShipmentFinancialStatus[] = ["NEEDS_REVIEW", "AWAITING_ACTUAL_CHARGE", "AWAITING_CONTRIBUTION"];

/** The money side of an exchange: the return leg, the replacement leg and any other leg recorded against it. */
export function exchangeCostSummary(legs: ShipmentCostInput[]): ExchangeCostSummary {
  const figures = legs.map((leg) => ({ leg, f: courierCostFigures(leg) }));
  const sum = (pick: (x: (typeof figures)[number]) => number) => figures.reduce((s, x) => s + pick(x), 0);

  const uncoveredRaw = sum(({ f }) => f.uncovered ?? 0);
  const allocatableExcess = sum(({ leg, f }) => (leg.excessTreatment === "ALLOCATED_WITHIN_EXCHANGE" ? (f.excess ?? 0) : 0));
  const applied = Math.min(allocatableExcess, uncoveredRaw);
  const leftover = allocatableExcess - applied;
  const otherExcess = sum(({ leg, f }) => (leg.excessTreatment === "ALLOCATED_WITHIN_EXCHANGE" ? 0 : (f.excess ?? 0)));
  const due = figures.filter(({ f }) => f.financialStatus !== "NOT_DUE");

  const summary: Omit<ExchangeCostSummary, "financialStatus"> = {
    legs: legs.length,
    actualExpense: sum(({ f }) => f.confirmedCharge ?? 0),
    reportedContribution: sum(({ f }) => f.reportedContribution),
    verifiedContribution: sum(({ f }) => f.verifiedContribution),
    allocatedContribution: sum(({ f }) => f.allocatedContribution) + applied,
    uncovered: uncoveredRaw - applied,
    excess: otherExcess + leftover,
    excessAwaitingReview: sum(({ f }) => f.excessAwaitingReview) + leftover,
    excessAppliedWithinExchange: applied,
    provisional: due.some(({ f }) => f.provisional),
  };

  const statuses = new Set(figures.map(({ f }) => f.financialStatus));
  let financialStatus: ShipmentFinancialStatus;
  const attention = ATTENTION_ORDER.find((s) => statuses.has(s));
  if (attention) financialStatus = attention;
  else if (summary.excessAwaitingReview > 0) financialStatus = "EXCESS_REVIEW";
  else if (!due.length || statuses.has("NOT_DUE")) financialStatus = "NOT_DUE";
  else if (figures.every(({ f }) => f.financialStatus === "RECONCILED")) financialStatus = "RECONCILED";
  else if (summary.uncovered > 0) financialStatus = summary.allocatedContribution > 0 ? "PARTIALLY_COVERED" : "NOT_COVERED";
  else financialStatus = "FULLY_COVERED";
  return { ...summary, financialStatus };
}

// ── labels (admin UI) ────────────────────────────────────────────────────────────────────────────────────────────────

export const SHIPMENT_TYPE_LABEL: Record<ShipmentType, string> = {
  OUTBOUND: "Delivery",
  RETURN: "Return",
  REPLACEMENT: "Replacement",
};

export const SHIPMENT_OPERATIONAL_STATUS_LABEL: Record<ShipmentOperationalStatus, string> = {
  BOOKED: "Booked",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  PARTIALLY_DELIVERED: "Partly delivered",
  RETURN_REQUESTED: "Return requested",
  RETURN_IN_TRANSIT: "Return in transit",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

export const SHIPMENT_FINANCIAL_STATUS_LABEL: Record<ShipmentFinancialStatus, string> = {
  NOT_DUE: "Not due yet",
  AWAITING_ACTUAL_CHARGE: "Awaiting actual charge",
  AWAITING_CONTRIBUTION: "Awaiting contribution details",
  EXCESS_REVIEW: "Excess — review required",
  NOT_COVERED: "Not covered",
  PARTIALLY_COVERED: "Partially covered",
  FULLY_COVERED: "Fully covered",
  RECONCILED: "Reconciled",
  NEEDS_REVIEW: "Needs review",
};

export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = {
  MISSING: "Not known",
  ENTERED: "Entered, not verified",
  VERIFIED: "Verified",
  COURIER_CONFIRMED: "Confirmed by courier",
};

export const CHARGE_SOURCE_LABEL: Record<ChargeSource, string> = {
  COURIER_PAYOUT: "Courier payout",
  COURIER_PANEL: "Courier merchant panel",
  COURIER_INVOICE: "Courier invoice / statement",
  RIDER: "Rider / courier staff",
  ADMIN_ESTIMATE: "Our estimate",
  OTHER: "Other",
};

export const CONTRIBUTION_STATUS_LABEL: Record<ContributionStatus, string> = {
  NOT_RECORDED: "Not recorded",
  REPORTED: "Reported",
  VERIFIED: "Verified",
  UNVERIFIED: "Unverified",
};

export const CONTRIBUTION_SOURCE_LABEL: Record<ContributionSource, string> = {
  CUSTOMER: "Customer said so",
  RIDER: "Rider / courier staff",
  COURIER_PAYOUT: "Courier payout",
  COURIER_PANEL: "Courier merchant panel",
  OTHER: "Other",
};

export const UNCOVERED_TREATMENT_LABEL: Record<UncoveredTreatment, string> = {
  UNDECIDED: "Not decided",
  ABSORBED: "Business bears it",
  RECEIVABLE: "Owed to us (receivable)",
  RECOVERED: "Receivable recovered",
};

export const EXCESS_TREATMENT_LABEL: Record<ExcessTreatment, string> = {
  UNDECIDED: "Review required",
  REFUND_DUE: "Owed back to the customer",
  REFUNDED: "Returned to the customer",
  KEPT_BY_COURIER: "Kept by the courier / rider",
  OTHER_INCOME: "Kept as other income",
  ALLOCATED_WITHIN_EXCHANGE: "Applied to the exchange's other legs",
};
