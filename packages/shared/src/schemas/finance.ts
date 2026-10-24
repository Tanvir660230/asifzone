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
    /** Owner alert for an inventory gain (5210 count adjustment) at or above this amount, major units. */
    inventoryGainAlertThreshold: financeAmountSchema.optional(),
    /** A count loss by staff at or above this amount (at the average cost) waits for the owner, major units. */
    countLossApprovalThreshold: financeAmountSchema.optional(),
    reason: optionalText(500),
  })
  .refine((v) => v.name !== undefined || v.fiscalYearStartMonth !== undefined || v.openingDate !== undefined || v.inventoryGainAlertThreshold !== undefined || v.countLossApprovalThreshold !== undefined, "Nothing to change");

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

export const FINANCIAL_ACCOUNT_KINDS = ["CASH", "BANK", "MOBILE_WALLET", "PAYMENT_GATEWAY", "COURIER", "OTHER", "AD_PLATFORM"] as const;
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

// ERP E12 (docs/FINANCE_BUDGETS.md): budgets, cash forecast
const budgetMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM");
export const budgetCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  startMonth: budgetMonth,
  months: z.coerce.number().int().min(1).max(60).optional(),
  copyFrom: z.enum(["LAST_YEAR"]).optional().nullable(),
  adjustPct: z.coerce.number().min(-100).max(1000).optional(),
  notes: optionalText(1000),
});
export const budgetLinesSchema = z.object({ lines: z.array(z.object({ accountId: id, periodKey: budgetMonth, amount: financeAmountSchema })).min(1).max(5000) });
export const budgetQuerySchema = z.object({ through: budgetMonth.optional() });
// ERP E8 (docs/FINANCE_PAYROLL.md): payroll — a configurable structure (no statutory rule built in)
const payMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM");
const pct = z.coerce.number().min(0).max(100);
const payComponentBase = {
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["EARNING", "DEDUCTION", "EMPLOYER_CONTRIBUTION"]),
  calculation: z.enum(["FIXED", "PERCENT_OF_BASIC"]).optional(),
  isBasic: z.boolean().optional(),
  ratePct: pct.optional().nullable(),
  expenseAccountId: id.optional().nullable(),
  liabilityAccountId: id.optional().nullable(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
};
export const payComponentCreateSchema = z.object(payComponentBase);
export const payComponentUpdateSchema = z.object(payComponentBase).partial().refine((v) => Object.keys(v).length > 0, "Nothing to change");
const payItem = z.object({ componentId: id, amount: financeAmountSchema.optional().nullable(), ratePct: pct.optional().nullable() });
const employeeBase = {
  name: z.string().trim().min(2).max(120),
  designation: optionalText(80),
  department: optionalText(80),
  phone: optionalText(30),
  payoutDetails: optionalText(200),
  joinDate: businessDate,
  leaveDate: businessDate.optional().nullable(),
  notes: optionalText(1000),
  payItems: z.array(payItem).max(40).optional(),
};
export const employeeCreateSchema = z.object(employeeBase);
export const employeeUpdateSchema = z.object(employeeBase).partial().refine((v) => Object.keys(v).length > 0, "Nothing to change");
export const payRunCreateSchema = z.object({ periodKey: payMonth, payDate: businessDate.optional().nullable(), notes: optionalText(500) });
export const payslipUpdateSchema = z
  .object({ daysPayable: z.coerce.number().int().min(0).max(31).optional(), lines: z.array(z.object({ componentId: id, amount: financeAmountSchema })).max(40).optional() })
  .refine((v) => v.daysPayable !== undefined || v.lines !== undefined, "Nothing to change");
export const payrollPaySchema = z.object({ payslipIds: z.array(id).max(500).optional(), fromFinancialAccountId: id, paymentDate: businessDate.optional(), reference: optionalText(120) });
export const payrollRemitSchema = z.object({ liabilityAccountId: id, amount: financeAmountSchema.refine((v) => v > 0, "More than zero"), fromFinancialAccountId: id, paymentDate: businessDate.optional(), periodKey: payMonth.optional().nullable(), reference: optionalText(120) });
export const payRunReverseSchema = z.object({ reason: z.string().trim().min(3).max(500) });

// ERP E11 foundation (docs/FINANCE_EQUITY.md): partner register — the agreed share is a note until B-2
export const PARTNER_ROLES = ["OWNER", "WORKING", "INVESTOR"] as const;
/** ZERO_IN_LOSS_MONTHS: a loss month shares nothing and the next month shares its whole profit. CARRY_LOSSES: losses are made good first. */
export const PROFIT_SHARE_LOSS_RULES = ["ZERO_IN_LOSS_MONTHS", "CARRY_LOSSES"] as const;
export const PAYMENT_METHODS = ["CASH", "BKASH", "NAGAD", "BANK", "OTHER"] as const;
const partnerBase = {
  name: z.string().trim().min(2).max(120),
  phone: optionalText(30),
  email: optionalText(160),
  joinedOn: businessDate,
  leftOn: businessDate.optional().nullable(),
  agreedSharePct: z.coerce.number().min(0).max(100).optional().nullable(),
  agreementReference: optionalText(200),
  notes: optionalText(1000),
  /** OWNER: the business's owner (owner capital 3100 / drawings 3300). WORKING: shares profit for their work, puts in no capital. */
  role: z.enum(PARTNER_ROLES).optional(),
  /** The share of each month's net profit — confirmed by the owner (docs/FINANCE_EQUITY.md §8). */
  profitSharePct: z.coerce.number().min(0).max(100).optional().nullable(),
  shareFrom: businessDate.optional().nullable(),
  lossRule: z.enum(PROFIT_SHARE_LOSS_RULES).optional(),
  shareConfirmedNote: optionalText(300),
  /** YYYY-MM a changed profit-share % starts from — never a month already shared (default: the first one that isn't). */
  rateFrom: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A month as YYYY-MM").optional().nullable(),
};
export const partnerCreateSchema = z.object(partnerBase);
export const partnerUpdateSchema = z.object(partnerBase).partial().refine((v) => Object.keys(v).length > 0, "Nothing to change");
export const equityQuerySchema = z.object({ asOf: businessDate.optional() });
const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A month as YYYY-MM");
/** Share every finished month not shared yet, up to and including `through` (default: last month). */
export const profitShareRunSchema = z.object({ through: yearMonth.optional() });
export const profitSharePaySchema = z.object({
  fromFinancialAccountId: id,
  amount: financeAmountSchema.refine((v) => v > 0, "More than zero"),
  paymentDate: businessDate.optional(),
  method: z.enum(PAYMENT_METHODS),
  note: optionalText(300),
  /** Paid in advance, beyond what is owed (an advance against future shares): the owner's reason. */
  advanceReason: z.string().trim().min(3).max(300).optional(),
});
/** A partner's profit-share rate from a month on (null = no share from then). */
export const shareRateSchema = z.object({ pct: z.coerce.number().gt(0).max(100).nullable(), from: yearMonth, note: optionalText(300) });
/** Verifying a month: the person types its profit, which must be the books' figure. */
export const sharePeriodVerifySchema = z.object({ confirmProfit: z.coerce.number().finite() }); // a loss is negative
export const sharePeriodParamSchema = z.object({ period: yearMonth });
/** A duplicate or wrong posting on a partner's account, with its journal as evidence. */
export const adjustmentProposeSchema = z.object({
  kind: z.enum(["DUPLICATE_POSTING", "INVALID_POSTING"]),
  partnerId: id,
  relatedEntryId: id,
  reason: z.string().trim().min(3).max(500),
});
export const adjustmentRejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const adjustmentDetectSchema = z.object({ period: yearMonth.optional() });
/** A partner's capital — put in (CONTRIBUTE, to their capital account) or taken back (RETURN, at most what is in it). */
export const partnerCapitalSchema = z.object({
  kind: z.enum(["CONTRIBUTE", "RETURN"]),
  financialAccountId: id,
  amount: financeAmountSchema.refine((v) => v > 0, "More than zero"),
  date: businessDate.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  note: optionalText(300),
});
/** The owner putting money in (INVEST, to owner capital) or taking it out (WITHDRAW, to drawings), through a money account. */
export const ownerMoneySchema = z.object({
  kind: z.enum(["INVEST", "WITHDRAW"]),
  financialAccountId: id,
  amount: financeAmountSchema.refine((v) => v > 0, "More than zero"),
  date: businessDate.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  note: optionalText(300),
});
/** Courier / gateway payouts the owner took for himself — each becomes a drawing from the account it was paid into, once. */
export const payoutsTakenSchema = z.object({ settlementIds: z.array(id).min(1).max(500) });
export const partnerActivityQuerySchema = z.object({ from: businessDate.optional(), to: businessDate.optional() });

// ERP E14 (docs/FINANCE_ALERTS.md): month-end close checklist
export const monthEndQuerySchema = z.object({ month: budgetMonth.optional() });
export const cashForecastQuerySchema = z.object({ weeks: z.coerce.number().int().min(1).max(52).optional() });

/** `acknowledgeShares`: reopening a month whose profit is already shared with partners — those shares stay final; a
 * change is flagged as a correction, never applied to them. */
export const periodActionSchema = z.object({ reason: z.string().trim().min(3).max(500), acknowledgeShares: z.boolean().optional() });

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
