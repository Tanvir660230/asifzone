/**
 * Request schemas of the Phase 2 treasury API (/api/v1/finance — docs/FINANCE_PHASE_2.md §7): money movements, statement
 * lines, matching, statement imports and bank reconciliations. Money in MAJOR units, at most 2 decimals, like Phase 1.
 */
import { z } from "zod";
import { isBusinessDate } from "../finance/periods";
import { financeAmountSchema } from "./finance-money";

const businessDate = z.string().refine(isBusinessDate, "Use a valid date (YYYY-MM-DD)");
const id = z.string().trim().min(1).max(64);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) };

const positiveAmount = financeAmountSchema.refine((v) => v > 0, "Amount must be more than zero");

/** A signed amount (statement balances can be overdrawn), major units, at most 2 decimals. */
export const financeSignedAmountSchema = z
  .union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/).transform(Number)])
  .refine((v) => Number.isFinite(v), "Enter an amount")
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "At most 2 decimals")
  .refine((v) => Math.abs(v) < 1e13, "Amount is too large");

/** Keys that look like a secret are refused: account metadata is never a place for credentials. */
export const CREDENTIAL_LIKE_KEY = /pass(word)?|\bpin\b|pin[_-]?code|secret|token|otp|cvv|cvc|credential|api[_-]?key|private/i;

export const financialAccountMetadataSchema = z
  .record(z.string().trim().min(1).max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()]))
  .refine((m) => Object.keys(m).length <= 30, "At most 30 entries")
  .refine((m) => !Object.keys(m).some((k) => CREDENTIAL_LIKE_KEY.test(k)), "Account details must never hold a password, PIN, secret or key");

export const treasuryAccountDetailsSchema = {
  accountTitle: optionalText(120),
  branch: optionalText(120),
  accountReference: optionalText(64),
  metadata: financialAccountMetadataSchema.optional().nullable(),
  approvalThreshold: positiveAmount.optional().nullable(),
};

// ── movements ───────────────────────────────────────────────────────────────────────────────────────────────────────

const movementBase = {
  movementDate: businessDate,
  amount: positiveAmount,
  reference: optionalText(120),
  description: z.string().trim().min(1).max(300),
};

export const depositSchema = z.object({ ...movementBase, toFinancialAccountId: id, counterAccountId: id });
/** `partnerAdvanceReason`: only to a non-owner partner's current account, owner only — paid beyond what they are owed. */
export const withdrawalSchema = z.object({ ...movementBase, fromFinancialAccountId: id, counterAccountId: id, partnerAdvanceReason: z.string().trim().min(3).max(300).optional() });
export const transferSchema = z
  .object({ ...movementBase, fromFinancialAccountId: id, toFinancialAccountId: id })
  .refine((v) => v.fromFinancialAccountId !== v.toFinancialAccountId, { message: "Choose two different accounts", path: ["toFinancialAccountId"] });
export const adjustmentSchema = z.object({
  ...movementBase,
  financialAccountId: id,
  direction: z.enum(["IN", "OUT"]),
  counterAccountId: id,
  reason: z.string().trim().min(3).max(500),
});
export const openingFundingSchema = z.object({ ...movementBase, financialAccountId: id, description: z.string().trim().min(1).max(300).default("Opening balance") });

export const TREASURY_MOVEMENT_KINDS = ["DEPOSIT", "WITHDRAWAL", "TRANSFER", "ADJUSTMENT", "OPENING_FUNDING", "SUPPLIER_PAYMENT"] as const;
export const TREASURY_MOVEMENT_STATUSES = ["PENDING_APPROVAL", "POSTED", "REJECTED", "REVERSED"] as const;

export const movementListQuerySchema = z.object({
  financialAccountId: id.optional(),
  kind: z.enum(TREASURY_MOVEMENT_KINDS).optional(),
  status: z.enum(TREASURY_MOVEMENT_STATUSES).optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
  ...page,
});

export const movementRejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const movementReverseSchema = z.object({ reason: z.string().trim().min(3).max(500), reversalDate: businessDate.optional() });

// ── statement lines & matching ──────────────────────────────────────────────────────────────────────────────────────

export const BANK_TRANSACTION_STATUSES = ["UNMATCHED", "PARTIALLY_MATCHED", "MATCHED", "ADJUSTMENT_REQUIRED", "RECONCILED"] as const;

/** Bank convention: debit = money OUT of the account, credit = money IN. Exactly one of them. */
export const bankTransactionCreateSchema = z
  .object({
    financialAccountId: id,
    transactionDate: businessDate,
    valueDate: businessDate.optional().nullable(),
    reference: optionalText(120),
    description: z.string().trim().min(1).max(300),
    debit: financeAmountSchema.default(0),
    credit: financeAmountSchema.default(0),
    externalId: optionalText(120),
    statementBalance: financeSignedAmountSchema.optional().nullable(),
  })
  .refine((v) => (v.debit > 0) !== (v.credit > 0), "Enter either money in (credit) or money out (debit)");

export const bankTransactionListQuerySchema = z.object({
  financialAccountId: id.optional(),
  status: z.enum(BANK_TRANSACTION_STATUSES).optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
  ...page,
});

export const bankMatchSchema = z.object({
  journalLineId: id,
  /** Defaults to the smaller of the two unmatched remainders. */
  amount: positiveAmount.optional(),
  reconciliationId: id.optional().nullable(),
  reference: optionalText(120),
  note: optionalText(300),
});
export const bankUnmatchSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const bankFlagSchema = z.object({ adjustmentRequired: z.boolean(), note: optionalText(300) });
export const bankAdjustSchema = z.object({
  counterAccountId: id,
  reason: z.string().trim().min(3).max(500),
  description: z.string().trim().min(1).max(300).optional(),
  reconciliationId: id.optional().nullable(),
});

// ── statement import ────────────────────────────────────────────────────────────────────────────────────────────────

export const STATEMENT_DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "DD.MM.YYYY", "DD-MMM-YYYY", "DD MMM YYYY"] as const;
export type StatementDateFormat = (typeof STATEMENT_DATE_FORMATS)[number];

const column = z.string().trim().min(1).max(80);
export const statementColumnMappingSchema = z
  .object({
    date: column,
    valueDate: column.optional(),
    description: column.optional(),
    reference: column.optional(),
    debit: column.optional(),
    credit: column.optional(),
    amount: column.optional(),
    balance: column.optional(),
    externalId: column.optional(),
  })
  .refine((m) => Boolean(m.amount) !== Boolean(m.debit || m.credit), "Map either an amount column, or debit / credit columns — not both")
  .refine((m) => Boolean(m.amount) || (Boolean(m.debit) && Boolean(m.credit)), "Map both the debit and the credit column");

export const statementImportOptionsSchema = z.object({
  dateFormat: z.enum(STATEMENT_DATE_FORMATS),
  /** For a single signed amount column: is a positive number money in or money out? */
  amountConvention: z.enum(["POSITIVE_IS_MONEY_IN", "POSITIVE_IS_MONEY_OUT"]).default("POSITIVE_IS_MONEY_IN"),
  /** Columns are named by the header row (true) or by 1-based position (false). */
  hasHeader: z.boolean().default(true),
  /** Lines before the header (bank letterheads). */
  skipRows: z.number().int().min(0).max(50).default(0),
});

export const statementImportSchema = z.object({
  financialAccountId: id,
  fileName: optionalText(200),
  csv: z.string().min(1).max(1_900_000),
  mapping: statementColumnMappingSchema,
  options: statementImportOptionsSchema,
});
export type StatementImportInput = z.infer<typeof statementImportSchema>;

export const statementImportListQuerySchema = z.object({ financialAccountId: id.optional(), ...page });

// ── bank reconciliation ─────────────────────────────────────────────────────────────────────────────────────────────

export const bankReconciliationCreateSchema = z
  .object({
    financialAccountId: id,
    periodStart: businessDate,
    periodEnd: businessDate,
    openingStatementBalance: financeSignedAmountSchema,
    closingStatementBalance: financeSignedAmountSchema,
  })
  .refine((v) => v.periodStart <= v.periodEnd, { message: "The period ends before it starts", path: ["periodEnd"] });
export const bankReconciliationListQuerySchema = z.object({ financialAccountId: id.optional(), ...page });
export const bankReconciliationCompleteSchema = z.object({ notes: optionalText(2000) });
export const bankReconciliationAbandonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
