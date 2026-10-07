/**
 * Request schemas of the Financial Core admin API (/api/v1/finance, docs/FINANCE_PHASE_1.md §6). Money is sent in MAJOR
 * units (as every other admin API) with at most 2 decimals; the API converts it to minor units at the boundary.
 */
import { z } from "zod";
import { LEDGER_ACCOUNT_TYPES } from "../finance/accounts";
import { isBusinessDate } from "../finance/periods";
import { financeAmountSchema } from "./finance-money";
import { treasuryAccountDetailsSchema } from "./finance-treasury";

const businessDate = z.string().refine(isBusinessDate, "Use a valid date (YYYY-MM-DD)");
const id = z.string().trim().min(1).max(64);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export { financeAmountSchema };

export const financeBusinessUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
    openingDate: businessDate.optional(),
    reason: optionalText(500),
  })
  .refine((v) => v.name !== undefined || v.fiscalYearStartMonth !== undefined || v.openingDate !== undefined, "Nothing to change");

export const ledgerAccountCreateSchema = z.object({
  code: z.string().trim().regex(/^[0-9A-Z][0-9A-Z.-]{0,15}$/, "Codes use digits, capitals, '.' and '-' (max 16)"),
  name: z.string().trim().min(1).max(120),
  description: optionalText(500),
  type: z.enum(LEDGER_ACCOUNT_TYPES),
  parentId: id.optional().nullable(),
  isPostable: z.boolean().default(true),
  normalBalance: z.enum(["DEBIT", "CREDIT"]).optional(),
});

export const ledgerAccountUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: optionalText(500),
    parentId: id.optional().nullable(),
    isActive: z.boolean().optional(),
    reason: optionalText(500),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.parentId !== undefined || v.isActive !== undefined, "Nothing to change");

export const accountMappingUpdateSchema = z.object({ accountId: id, reason: optionalText(500) });

export const FINANCIAL_ACCOUNT_KINDS = ["CASH", "BANK", "MOBILE_WALLET", "PAYMENT_GATEWAY", "COURIER", "OTHER"] as const;
export type FinancialAccountKindName = (typeof FINANCIAL_ACCOUNT_KINDS)[number];

export const financialAccountCreateSchema = z.object({
  kind: z.enum(FINANCIAL_ACCOUNT_KINDS),
  name: z.string().trim().min(1).max(120),
  provider: optionalText(80),
  accountNumberLast4: z.string().trim().regex(/^\d{4}$/, "Last 4 digits only").optional().nullable(),
  brandId: id.optional().nullable(),
  ...treasuryAccountDetailsSchema,
  /** Phase 2: an account opened after the books started is funded by an OPENING_FUNDING movement (opening balance equity). */
  openingBalance: z.object({ amount: financeAmountSchema.refine((v) => v > 0, "Amount must be more than zero"), date: businessDate }).optional().nullable(),
});

export const financialAccountUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    provider: optionalText(80),
    accountNumberLast4: z.string().trim().regex(/^\d{4}$/).optional().nullable(),
    isActive: z.boolean().optional(),
    ...treasuryAccountDetailsSchema,
    reason: optionalText(500),
  })
  .refine((v) => Object.keys(v).some((k) => k !== "reason"), "Nothing to change");

export const FINANCE_VALUATION_STATUSES = ["KNOWN", "ESTIMATED", "MISSING", "OPENING_BALANCE"] as const;

export const journalLineInputSchema = z
  .object({
    accountId: id,
    debit: financeAmountSchema.default(0),
    credit: financeAmountSchema.default(0),
    brandId: id.optional().nullable(),
    memo: optionalText(300),
    partyType: optionalText(40),
    partyId: optionalText(64),
    valuationStatus: z.enum(FINANCE_VALUATION_STATUSES).optional().nullable(),
  })
  .refine((l) => (l.debit > 0) !== (l.credit > 0), "Each line is either a debit or a credit (one positive amount)");

export const journalDraftSchema = z.object({
  entryDate: businessDate,
  description: z.string().trim().min(1).max(300),
  reference: optionalText(120),
  brandId: id.optional().nullable(),
  lines: z.array(journalLineInputSchema).min(2).max(500),
});

export const journalReverseSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  reversalDate: businessDate.optional(),
});

export const journalCorrectSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  entryDate: businessDate.optional(),
  description: z.string().trim().min(1).max(300).optional(),
  lines: z.array(journalLineInputSchema).min(2).max(500),
});

export const journalListQuerySchema = z.object({
  status: z.enum(["DRAFT", "POSTED"]).optional(),
  kind: z.enum(["MANUAL", "OPENING_BALANCE", "EVENT", "REVERSAL", "CORRECTION", "TREASURY"]).optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
  accountId: id.optional(),
  brandId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const ledgerRangeQuerySchema = z.object({
  from: businessDate.optional(),
  to: businessDate.optional(),
  brandId: id.optional(),
});

export const periodActionSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const OPENING_BALANCE_CATEGORIES = [
  "CASH", "BANK", "MOBILE_WALLET", "PAYMENT_ACCOUNT", "INVENTORY", "RECEIVABLE", "PAYABLE", "LOAN", "FIXED_ASSET", "CAPITAL", "OTHER_ASSET", "OTHER_LIABILITY", "OTHER_EQUITY",
] as const;

export const openingBalanceLinesSchema = z.object({
  notes: optionalText(2000),
  lines: z
    .array(
      z.object({
        category: z.enum(OPENING_BALANCE_CATEGORIES),
        /** Either a ledger account, or a financial account (its ledger account is used). */
        accountId: id.optional().nullable(),
        financialAccountId: id.optional().nullable(),
        side: z.enum(["DEBIT", "CREDIT"]),
        amount: financeAmountSchema.refine((v) => v > 0, "Amount must be positive"),
        brandId: id.optional().nullable(),
        partyType: optionalText(40),
        partyId: optionalText(64),
        description: optionalText(300),
      }),
    )
    .max(500),
});

export const openingInventoryItemsSchema = z.object({
  items: z
    .array(
      z
        .object({
          variantId: id.optional().nullable(),
          sku: z.string().trim().min(1).max(80),
          name: z.string().trim().min(1).max(200),
          quantity: z.number().int().min(0),
          unitCost: financeAmountSchema.optional().nullable(),
          valuationAmount: financeAmountSchema.optional().nullable(),
          valuationStatus: z.enum(["KNOWN", "ESTIMATED", "MISSING"]),
          valuationMethod: z.string().trim().min(1).max(40),
          valuationSource: optionalText(300),
          valuationDate: businessDate,
          confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().nullable(),
          notes: optionalText(500),
          brandId: id.optional().nullable(),
        })
        .refine((i) => i.valuationStatus !== "MISSING" || ((i.unitCost ?? null) === null && !i.valuationAmount), {
          message: "A MISSING cost has no unit cost or value — it is never invented",
        })
        .refine((i) => i.valuationStatus === "MISSING" || i.unitCost != null || i.valuationAmount != null, {
          message: "A KNOWN or ESTIMATED item needs a unit cost or a valuation amount",
        }),
    )
    .max(20000),
});

export const reconciliationRunSchema = z.object({
  checks: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
});

export const financialEventListQuerySchema = z.object({
  status: z.enum(["RECEIVED", "POSTED", "FAILED", "IGNORED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const financeAuditQuerySchema = z.object({
  entityType: z.string().trim().max(64).optional(),
  entityId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
