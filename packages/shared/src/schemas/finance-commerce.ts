/**
 * Request schemas of the Phase 3 commerce-accounting API (/api/v1/finance — docs/FINANCE_PHASE_3.md §7): the projector,
 * finance exceptions and clearing settlements. Money in MAJOR units, at most 2 decimals, like Phases 1–2.
 */
import { z } from "zod";
import { isBusinessDate } from "../finance/periods";
import { financeAmountSchema } from "./finance-money";
import { financeSignedAmountSchema } from "./finance-treasury";

const businessDate = z.string().refine(isBusinessDate, "Use a valid date (YYYY-MM-DD)");
const id = z.string().trim().min(1).max(64);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) };

export const commerceSyncSchema = z.object({ full: z.boolean().default(false) });

export const FINANCE_EXCEPTION_KINDS = ["MISSING_COST", "ORDER_TOTAL_MISMATCH", "UNVALUED_STOCK_RECEIPT", "UNVALUED_STOCK_WRITE_OFF", "UNSUPPORTED_CREDIT_ENTRY", "UNMATCHED_SETTLEMENT_LINE", "ENGINE_MISMATCH"] as const;
export const financeExceptionQuerySchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional(),
  kind: z.enum(FINANCE_EXCEPTION_KINDS).optional(),
  orderId: id.optional(),
  ...page,
});
export const exceptionAcknowledgeSchema = z.object({ note: z.string().trim().min(3).max(500) });
export const exceptionEstimateSchema = z.object({
  unitCost: financeAmountSchema.refine((v) => v > 0, "An estimate must be more than zero"),
  note: z.string().trim().min(3).max(500),
});

export const financeCostPolicySchema = z.object({ costPolicy: z.enum(["KNOWN_ONLY", "APPROVED_ESTIMATES"]), reason: z.string().trim().min(3).max(500) });

/** A line collects money for an order, or — a returned parcel (owner's books §3.3) — only carries the charge deducted. */
const settlementLine = z
  .object({
    orderNumber: optionalText(60),
    externalRef: optionalText(120),
    amount: financeAmountSchema,
    fee: financeAmountSchema.default(0),
    adjustment: financeSignedAmountSchema.default(0),
    note: optionalText(300),
  })
  .refine((l) => l.amount > 0 || l.fee > 0 || l.adjustment !== 0, { message: "Amount must be more than zero (or zero with a charge)", path: ["amount"] });
export const settlementCreateSchema = z
  .object({
    clearingFinancialAccountId: id,
    destinationFinancialAccountId: id,
    settlementDate: businessDate,
    reference: z.string().trim().min(1).max(120),
    evidence: optionalText(300),
    grossAmount: financeAmountSchema.optional().nullable(),
    netAmount: financeAmountSchema.optional().nullable(),
    feeAmount: financeAmountSchema.optional().nullable(),
    adjustmentAmount: financeSignedAmountSchema.optional().nullable(),
    adjustmentReason: optionalText(300),
    lines: z.array(settlementLine).max(5000).optional(),
  })
  .refine((v) => (v.lines?.length ?? 0) > 0 || v.grossAmount != null, "Enter the gross amount, or the settlement's lines");

export const settlementImportSchema = z.object({
  clearingFinancialAccountId: id,
  destinationFinancialAccountId: id,
  settlementDate: businessDate,
  reference: z.string().trim().min(1).max(120),
  evidence: optionalText(300),
  adjustmentReason: optionalText(300),
  csv: z.string().min(1).max(1_900_000),
  mapping: z.object({ orderNumber: z.string().trim().max(80).optional(), externalRef: z.string().trim().max(80).optional(), amount: z.string().trim().min(1).max(80), fee: z.string().trim().max(80).optional(), adjustment: z.string().trim().max(80).optional() }),
  hasHeader: z.boolean().default(true),
  skipRows: z.number().int().min(0).max(50).default(0),
});

export const settlementListQuerySchema = z.object({ clearingFinancialAccountId: id.optional(), status: z.enum(["DRAFT", "POSTED", "REVERSED"]).optional(), ...page });
export const settlementReverseSchema = z.object({ reason: z.string().trim().min(3).max(500) });
