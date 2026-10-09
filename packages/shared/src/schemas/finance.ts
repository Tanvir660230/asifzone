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

// ERP E6 (docs/FINANCE_STATEMENTS.md): financial statements
export const statementPeriodQuerySchema = z
  .object({ from: businessDate.optional(), to: businessDate.optional(), brandId: id.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, "The period starts before it ends");
export const balanceSheetQuerySchema = z.object({ asOf: businessDate.optional(), brandId: id.optional() });

// ERP E7 (docs/FINANCE_EXPENSES.md): expenses and recurring commitments
export const COST_BEHAVIOURS = ["FIXED", "VARIABLE"] as const;
export const COMMITMENT_FREQUENCIES = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;
const periodKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM");
const positive = financeAmountSchema.refine((v) => v > 0, "More than zero");
export const expenseCreateSchema = z
  .object({
    expenseDate: businessDate.optional(),
    expenseAccountId: id.optional().nullable(),
    amount: positive.optional().nullable(),
    costBehaviour: z.enum(COST_BEHAVIOURS).optional().nullable(),
    payee: optionalText(200),
    description: optionalText(300),
    reference: optionalText(120),
    evidence: optionalText(500),
    fromFinancialAccountId: id.optional().nullable(),
    commitmentId: id.optional().nullable(),
    periodKey: periodKey.optional().nullable(),
  })
  .refine((v) => Boolean(v.commitmentId) || (Boolean(v.expenseAccountId) && v.amount != null && Boolean(v.fromFinancialAccountId)), "Give the expense account, the amount and the money account (or pay a commitment)")
  .refine((v) => !v.commitmentId || Boolean(v.periodKey), "Name the period this pays");
export const expenseListQuerySchema = z.object({
  from: businessDate.optional(), to: businessDate.optional(), expenseAccountId: id.optional(), costBehaviour: z.enum(COST_BEHAVIOURS).optional(), commitmentId: id.optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const commitmentFields = {
  name: z.string().trim().min(2).max(120),
  expenseAccountId: id,
  amount: positive,
  frequency: z.enum(COMMITMENT_FREQUENCIES),
  dayOfMonth: z.coerce.number().int().min(1).max(28),
  startDate: businessDate,
  endDate: businessDate.optional().nullable(),
  costBehaviour: z.enum(COST_BEHAVIOURS).optional(),
  payee: optionalText(200),
  supplierId: id.optional().nullable(),
  financialAccountId: id.optional().nullable(),
  notes: optionalText(1000),
  isActive: z.boolean().optional(),
};
export const commitmentCreateSchema = z.object(commitmentFields).refine((v) => !v.endDate || v.endDate >= v.startDate, "The end is after the start");
export const commitmentUpdateSchema = z.object(commitmentFields).partial().refine((v) => Object.keys(v).length > 0, "Nothing to change");
export const commitmentListQuerySchema = z.object({ from: businessDate.optional(), to: businessDate.optional(), includeInactive: z.coerce.boolean().optional() });

// ERP E9 (docs/FINANCE_FIXED_ASSETS.md): fixed assets and depreciation
export const DEPRECIATION_METHODS = ["STRAIGHT_LINE", "DECLINING_BALANCE"] as const;
const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM");
const assetFields = {
  name: z.string().trim().min(2).max(160),
  category: optionalText(80),
  assetAccountId: id,
  acquisitionDate: businessDate,
  cost: financeAmountSchema.refine((v) => v > 0, "More than zero"),
  residualValue: financeAmountSchema.optional(),
  usefulLifeMonths: z.coerce.number().int().min(1).max(1200),
  method: z.enum(DEPRECIATION_METHODS).optional(),
  decliningRatePct: z.coerce.number().positive().max(100).optional().nullable(),
  depreciationStart: monthKeySchema.optional(),
  openingAccumulatedDepreciation: financeAmountSchema.optional(),
  location: optionalText(120),
  custodian: optionalText(120),
  serialNumber: optionalText(120),
  notes: optionalText(1000),
  sourceType: z.enum(["SUPPLIER_INVOICE", "MONEY_MOVEMENT", "OPENING_BALANCE", "OTHER"]).optional(),
  sourceRef: optionalText(120),
  reclassifyFromAccountId: id.optional().nullable(),
};
export const fixedAssetCreateSchema = z.object(assetFields).refine((v) => v.method !== "DECLINING_BALANCE" || Boolean(v.decliningRatePct), "Give the yearly rate for declining balance");
export const fixedAssetUpdateSchema = z
  .object({ name: assetFields.name, category: assetFields.category, location: assetFields.location, custodian: assetFields.custodian, serialNumber: assetFields.serialNumber, notes: assetFields.notes, residualValue: assetFields.residualValue, usefulLifeMonths: assetFields.usefulLifeMonths })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");
export const fixedAssetDisposeSchema = z.object({ disposalDate: businessDate, proceeds: financeAmountSchema.optional(), financialAccountId: id.optional().nullable(), reason: z.string().trim().min(3).max(500) });
export const depreciationRunSchema = z.object({ periodKey: monthKeySchema });
export const depreciationReverseSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const fixedAssetListQuerySchema = z.object({ includeDisposed: z.coerce.boolean().optional() });

// ERP E10 (docs/FINANCE_LOANS.md): loans
export const LOAN_REPAYMENT_TYPES = ["ANNUITY", "EQUAL_PRINCIPAL"] as const;
export const loanCreateSchema = z
  .object({
    lender: z.string().trim().min(2).max(160),
    reference: optionalText(120),
    principal: financeAmountSchema.refine((v) => v > 0, "More than zero"),
    annualRatePct: z.coerce.number().min(0).max(100),
    termMonths: z.coerce.number().int().min(1).max(600),
    repaymentType: z.enum(LOAN_REPAYMENT_TYPES).optional(),
    drawdownDate: businessDate,
    firstDueDate: businessDate,
    financialAccountId: id,
    notes: optionalText(1000),
  })
  .refine((v) => v.firstDueDate > v.drawdownDate, "The first instalment falls after the drawdown");
export const loanRepaymentSchema = z.object({ paymentDate: businessDate.optional(), amount: financeAmountSchema.refine((v) => v > 0, "More than zero"), fromFinancialAccountId: id, reference: optionalText(120) });
export const loanAccrualSchema = z.object({ periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM") });
export const loanAccrualReverseSchema = z.object({ reason: z.string().trim().min(3).max(500) });

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
