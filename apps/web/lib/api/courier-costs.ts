/**
 * Courier cost reconciliation API (docs/COURIER_COSTS.md): each order's shipment legs with what the courier actually
 * charged and what the customer paid the rider, exchange summaries, and the report. Money in major units.
 */
import type {
  ChargeSource,
  ChargeStatus,
  ContributionSource,
  ContributionStatus,
  ExcessTreatment,
  ShipmentCostUpdateInput,
  ShipmentCreateInput,
  ShipmentFinancialStatus,
  ShipmentOperationalStatus,
  ShipmentReportQuery,
  ShipmentType,
  UncoveredTreatment,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

const BASE = "/api/shipments";
const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : "";
};

export const courierCostKeys = {
  all: ["courier-costs"] as const,
  order: (orderId: string) => ["courier-costs", "order", orderId] as const,
  report: (q: Partial<ShipmentReportQuery>) => ["courier-costs", "report", q] as const,
};

type Who = { id: string; name: string } | null;

export interface Shipment {
  id: string;
  order: { id: string; orderNumber: string };
  parcelOrder: { id: string; orderNumber: string; status: string } | null;
  returnRequest: { id: string; type: "RETURN" | "EXCHANGE"; status: string } | null;
  type: ShipmentType;
  courier: string;
  consignmentId: string | null;
  trackingCode: string | null;
  courierStatus: string | null;
  courierSyncedAt: string | null;
  operationalStatus: ShipmentOperationalStatus;
  trackedByCourier: boolean;
  deliveryZone: string | null;
  weightKg: number | null;
  bookedAt: string | null;
  completedAt: string | null;
  bookedCodAmount: number | null;
  courierPayoutRef: string | null;
  courierCollected: number | null;
  standardCharge: number | null;
  standardChargeSource: string | null;
  estimatedCharge: number | null;
  quotedCharge: number | null;
  actualCharge: number | null;
  chargeStatus: ChargeStatus;
  chargeSource: ChargeSource | null;
  chargeReference: string | null;
  chargeVerifiedBy: Who;
  chargeVerifiedAt: string | null;
  contributionReported: number | null;
  contributionVerified: number | null;
  contributionStatus: ContributionStatus;
  contributionSource: ContributionSource | null;
  contributionReference: string | null;
  contributionVerifiedBy: Who;
  contributionVerifiedAt: string | null;
  uncoveredTreatment: UncoveredTreatment;
  excessTreatment: ExcessTreatment;
  financialStatus: ShipmentFinancialStatus;
  figures: {
    contributionApplies: boolean;
    confirmedCharge: number | null;
    reportedContribution: number;
    verifiedContribution: number;
    allocatedContribution: number;
    uncovered: number | null;
    excess: number | null;
    provisional: boolean;
  };
  reconcileBlocker: string | null;
  reviewReason: string | null;
  reconciledAt: string | null;
  reconciledBy: Who;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeCosts {
  returnRequestId: string;
  reason: string;
  exchangeOrder: { id: string; orderNumber: string; status: string; booked: boolean } | null;
  operationalStatus: "EXCHANGE_IN_PROGRESS" | "EXCHANGE_COMPLETED";
  shipmentIds: string[];
  summary: {
    legs: number;
    actualExpense: number;
    reportedContribution: number;
    verifiedContribution: number;
    allocatedContribution: number;
    uncovered: number;
    excess: number;
    excessAwaitingReview: number;
    excessAppliedWithinExchange: number;
    provisional: boolean;
    financialStatus: ShipmentFinancialStatus;
  };
}

export interface ShipmentEvent {
  id: string;
  shipmentId: string;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  reason: string | null;
  note: string | null;
  source: string | null;
  reference: string | null;
  admin: Who;
  createdAt: string;
}

export interface OrderShipments {
  rootOrderId: string;
  shipments: Shipment[];
  exchanges: ExchangeCosts[];
  returnRequests: Array<{ id: string; type: "RETURN" | "EXCHANGE"; status: string; reason: string; exchangeOrderId: string | null }>;
  events: ShipmentEvent[];
}

export const getOrderShipments = (orderId: string) => apiFetch<OrderShipments>(`${BASE}/orders/${orderId}`);

export const createShipmentLeg = (orderId: string, input: ShipmentCreateInput, idempotencyKey: string) =>
  apiFetch<{ shipment: Shipment }>(`${BASE}/orders/${orderId}`, { method: "POST", body: input, idempotencyKey });

export const updateShipmentCosts = (id: string, input: ShipmentCostUpdateInput) =>
  apiFetch<{ shipment: Shipment }>(`${BASE}/${id}/costs`, { method: "PATCH", body: input });

export const reconcileShipment = (id: string, input: { version: number; note?: string | null }) =>
  apiFetch<{ shipment: Shipment }>(`${BASE}/${id}/reconcile`, { method: "POST", body: input });

export const reopenShipment = (id: string, input: { version: number; reason: string }) =>
  apiFetch<{ shipment: Shipment }>(`${BASE}/${id}/reopen`, { method: "POST", body: input });

export const clearShipmentReview = (id: string, input: { version: number; note: string }) =>
  apiFetch<{ shipment: Shipment }>(`${BASE}/${id}/clear-review`, { method: "POST", body: input });

export const refreshShipment = (id: string) => apiFetch<{ messages: string[]; data: OrderShipments }>(`${BASE}/${id}/refresh`, { method: "POST" });

export interface PayoutSyncResult {
  payouts: number;
  checks: Array<{ payoutId: string; parcels: number; matched: number; confirmed: number; flagged: number; outcome: string; message: string }>;
  problems: Array<{ payoutId: string; message: string }>;
}
export const syncPayouts = () => apiFetch<PayoutSyncResult>(`${BASE}/payouts/sync`, { method: "POST" });

export interface ShipmentReport {
  asOf: string;
  totals: {
    confirmedExpense: number;
    deliveries: number;
    returns: number;
    exchanges: number;
    unconfirmedCharges: number;
    reportedContribution: number;
    verifiedContribution: number;
    uncovered: number;
    absorbed: number;
    receivable: number;
    recovered: number;
    undecidedUncovered: number;
    excessAwaitingReview: number;
    provisionalUncovered: number;
  };
  counts: { total: number; missingCharge: number; unverifiedCharge: number; awaitingContribution: number; excess: number; uncoveredUndecided: number; receivable: number; unreconciled: number; needsReview: number };
  items: Shipment[];
  total: number;
  page: number;
  pageSize: number;
  options: { couriers: string[]; zones: string[] };
}
export const getShipmentReport = (q: Partial<ShipmentReportQuery>) => apiFetch<ShipmentReport>(`${BASE}/report${qs(q as Record<string, string | number | undefined>)}`);
