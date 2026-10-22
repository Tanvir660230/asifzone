/**
 * Shared plumbing of the shipment money record (docs/COURIER_COSTS.md): money conversion, the derived columns written on
 * every change, and the append-only history. Only domain/shipments/* writes Shipment / ShipmentCostEvent.
 */
import type { Prisma, Shipment } from "@prisma/client";
import { courierCostFigures, type ShipmentCostInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

export type Db = Prisma.TransactionClient | typeof prisma;

/** Decimal(10,2) major units → whole minor units (the store's currency has 2 decimals). */
export function toMinor(value: Prisma.Decimal | number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(Number(value.toString()) * 100);
}
export const toMajor = (minor: number | null): number | null => (minor === null ? null : minor / 100);
/** A Decimal column as a plain number for JSON (null stays null). */
export const num = (value: Prisma.Decimal | null | undefined): number | null => (value === null || value === undefined ? null : Number(value.toString()));

type CostFields = Pick<
  Shipment,
  | "type"
  | "operationalStatus"
  | "actualCharge"
  | "chargeStatus"
  | "contributionReported"
  | "contributionVerified"
  | "contributionStatus"
  | "uncoveredTreatment"
  | "excessTreatment"
  | "reconciledAt"
  | "reviewReason"
>;

export function costInputOf(row: CostFields): ShipmentCostInput {
  return {
    type: row.type,
    operationalStatus: row.operationalStatus,
    actualCharge: toMinor(row.actualCharge),
    chargeStatus: row.chargeStatus,
    contributionReported: toMinor(row.contributionReported),
    contributionVerified: toMinor(row.contributionVerified),
    contributionStatus: row.contributionStatus,
    uncoveredTreatment: row.uncoveredTreatment,
    excessTreatment: row.excessTreatment,
    reconciled: row.reconciledAt !== null,
    reviewReason: row.reviewReason,
  };
}

/** The stored derived columns for a (prospective) row — computed by the shared rules, never by hand. */
export function derivedColumns(row: CostFields) {
  const f = courierCostFigures(costInputOf(row));
  return { financialStatus: f.financialStatus, uncoveredAmount: toMajor(f.uncovered), excessAmount: toMajor(f.excess) };
}

/** Field-level diff for the history: only fields that actually changed, Decimals as numbers, dates as ISO strings. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const plain = (v: unknown) => (v instanceof Date ? v.toISOString() : v !== null && typeof v === "object" && "toFixed" in (v as object) ? Number(String(v)) : v ?? null);
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const from = plain(before[key]);
    const to = plain(after[key]);
    if (from !== to) out[key] = { from, to };
  }
  return out;
}

export async function recordShipmentEvent(
  db: Db,
  input: { shipmentId: string; action: string; changes?: Record<string, unknown>; reason?: string | null; note?: string | null; source?: string | null; reference?: string | null; adminId?: string | null },
) {
  await db.shipmentCostEvent.create({
    data: {
      shipmentId: input.shipmentId,
      action: input.action,
      changes: (input.changes ?? {}) as Prisma.InputJsonValue,
      reason: input.reason ?? null,
      note: input.note ?? null,
      source: input.source ?? null,
      reference: input.reference ?? null,
      adminId: input.adminId ?? null,
    },
  });
}

export const FINISHED_STATUSES = ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED"] as const;
