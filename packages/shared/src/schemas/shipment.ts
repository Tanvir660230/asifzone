/** Courier cost reconciliation inputs (docs/COURIER_COSTS.md). Money in major units, at most 2 decimals. */
import { z } from "zod";
import {
  CHARGE_SOURCES,
  CONTRIBUTION_SOURCES,
  CONTRIBUTION_STATUSES,
  EXCESS_TREATMENTS,
  SHIPMENT_FINANCIAL_STATUSES,
  SHIPMENT_OPERATIONAL_STATUSES,
  SHIPMENT_TYPES,
  UNCOVERED_TREATMENTS,
} from "../courier-costs";
import { financeAmountSchema } from "./finance-money";
import { paginationQuerySchema } from "./common";

const text = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable().optional());
const amount = z.preprocess((v) => (v === "" ? null : v), financeAmountSchema.nullable().optional());
const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** One save of the shipment's money record. `version` is the record's version the form was opened on — a save against
 * an older version is refused (409), so two people (or a double click) can never overwrite each other silently. */
export const shipmentCostUpdateSchema = z
  .object({
    version: z.number().int().min(0),
    actualCharge: amount,
    /** COURIER_CONFIRMED is set only by the courier sync; MISSING clears the charge. */
    chargeStatus: z.enum(["MISSING", "ENTERED", "VERIFIED"]).optional(),
    chargeSource: z.enum(CHARGE_SOURCES).nullable().optional(),
    chargeReference: text(120),
    quotedCharge: amount,
    weightKg: z.preprocess((v) => (v === "" ? null : v), z.number().min(0).max(1000).nullable().optional()),
    contributionReported: amount,
    contributionVerified: amount,
    contributionStatus: z.enum(CONTRIBUTION_STATUSES).optional(),
    contributionSource: z.enum(CONTRIBUTION_SOURCES).nullable().optional(),
    contributionReference: text(120),
    uncoveredTreatment: z.enum(UNCOVERED_TREATMENTS).optional(),
    excessTreatment: z.enum(EXCESS_TREATMENTS).optional(),
    /** Only for legs the courier doesn't track (a manual return, a manual carrier). */
    operationalStatus: z.enum(SHIPMENT_OPERATIONAL_STATUSES).optional(),
    note: text(1000),
    /** Required when a verified or courier-confirmed figure is changed. */
    reason: text(500),
  })
  .superRefine((v, ctx) => {
    if (v.chargeStatus === "VERIFIED" && v.actualCharge === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actualCharge"], message: "Enter the charge you are verifying" });
    if (v.contributionStatus === "VERIFIED" && v.contributionVerified === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contributionVerified"], message: "Enter the verified amount (0 if the customer paid nothing)" });
    }
  });
export type ShipmentCostUpdateInput = z.infer<typeof shipmentCostUpdateSchema>;

/** A leg the system can't see on its own: the parcel coming back for a return or exchange, or a replacement sent outside
 * the website's booking. */
export const shipmentCreateSchema = z.object({
  type: z.enum(["RETURN", "REPLACEMENT"]),
  courier: z.string().trim().min(1).max(40).default("Steadfast"),
  consignmentId: text(64),
  trackingCode: text(64),
  returnRequestId: z.string().cuid().nullable().optional(),
  operationalStatus: z.enum(SHIPMENT_OPERATIONAL_STATUSES).optional(),
  note: text(1000),
});
export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>;

export const shipmentReconcileSchema = z.object({ version: z.number().int().min(0), note: text(1000) });
export const shipmentReopenSchema = z.object({ version: z.number().int().min(0), reason: z.string().trim().min(3).max(500) });
export const shipmentClearReviewSchema = z.object({ version: z.number().int().min(0), note: z.string().trim().min(3).max(500) });

export const SHIPMENT_ATTENTION_FILTERS = ["missing_charge", "unverified_charge", "awaiting_contribution", "excess", "uncovered_undecided", "receivable", "unreconciled", "needs_review"] as const;

export const shipmentReportQuerySchema = paginationQuerySchema.extend({
  from: businessDate.optional(),
  to: businessDate.optional(),
  courier: z.string().trim().max(40).optional(),
  type: z.enum(SHIPMENT_TYPES).optional(),
  zone: z.string().trim().max(60).optional(),
  operationalStatus: z.enum(SHIPMENT_OPERATIONAL_STATUSES).optional(),
  financialStatus: z.enum(SHIPMENT_FINANCIAL_STATUSES).optional(),
  attention: z.enum(SHIPMENT_ATTENTION_FILTERS).optional(),
  search: z.string().trim().max(60).optional(),
});
export type ShipmentReportQuery = z.infer<typeof shipmentReportQuerySchema>;
