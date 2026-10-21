/**
 * Request schemas of the owner's-books features (docs/FINANCE_OWNER_BOOKS.md): who holds the money (custody, handovers,
 * cash counts), courier and gateway rate cards, ad spend, prepaid costs, packing rules, landed costs and quick refills.
 * Money is sent in MAJOR units with at most 2 decimals, like the rest of the finance API.
 */
import { z } from "zod";
import { isBusinessDate } from "../finance/periods";
import { financeAmountSchema } from "./finance-money";

const businessDate = z.string().refine(isBusinessDate, "Use a valid date (YYYY-MM-DD)");
const id = z.string().trim().min(1).max(64);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const positive = financeAmountSchema.refine((v) => v > 0, "Amount must be more than zero");

// ── custody: who holds the cash (§2) ─────────────────────────────────────────────────────────────────────────────────

export const custodianUpdateSchema = z.object({ custodianAdminId: id.nullable(), reason: optionalText(500) });

/** Cash handed from one account to another; when the receiving account is held by someone else, it waits for them. */
export const handoverCreateSchema = z.object({
  fromFinancialAccountId: id,
  toFinancialAccountId: id,
  amount: positive,
  movementDate: businessDate,
  description: z.string().trim().min(1).max(300),
  reference: optionalText(120),
});

export const handoverDecisionSchema = z.object({ reason: optionalText(500) });
export const handoverRejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const cashCountCreateSchema = z.object({
  financialAccountId: id,
  countDate: businessDate,
  counted: financeAmountSchema,
  note: optionalText(500),
});

export const cashCountListQuerySchema = z.object({
  financialAccountId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** An expense the holder of a cash account pays from it (it waits for approval unless they may post). */
export const custodyExpenseSchema = z.object({
  fromFinancialAccountId: id,
  expenseAccountId: id,
  amount: positive,
  expenseDate: businessDate.optional(),
  description: z.string().trim().min(1).max(300),
  payee: optionalText(200),
  reference: optionalText(120),
  evidence: optionalText(500),
});

/** An expense the owner paid from their own pocket: their money comes into a cash account (owed back to them, or added
 * as capital) and the expense is paid from it in the same step. */
export const OWNER_FUNDING_KINDS = ["REIMBURSE", "CAPITAL"] as const;
export const ownerPaidExpenseSchema = z.object({
  cashFinancialAccountId: id,
  expenseAccountId: id,
  amount: positive,
  expenseDate: businessDate.optional(),
  description: z.string().trim().min(1).max(300),
  payee: optionalText(200),
  reference: optionalText(120),
  funding: z.enum(OWNER_FUNDING_KINDS),
  /** CAPITAL only: the partner whose capital it is (default: the owner capital account). */
  partnerId: id.optional().nullable(),
});

export const moneyMapQuerySchema = z.object({ asOf: businessDate.optional() });

// ── courier rate cards, gateway fee rates, courier payouts (§3–§4) ────────────────────────────────────────────────────

const percent = (max: number) => z.coerce.number().min(0).max(max).refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, "At most 3 decimals");
const placeList = z.array(z.string().trim().min(1).max(80)).max(200).default([]);

export const courierRateCardSchema = z.object({
  effectiveFrom: businessDate,
  zones: z.array(z.object({ name: z.string().trim().min(1).max(60), districts: placeList, areas: placeList, charge: financeAmountSchema })).max(20),
  defaultCharge: financeAmountSchema,
  codPercent: percent(100),
  returnChargePercent: percent(200),
  notes: optionalText(500),
});

export const GATEWAY_FEE_PROVIDERS = ["EPS_PG", "SSLCOMMERZ"] as const;
export const gatewayFeeRateSchema = z.object({
  provider: z.enum(GATEWAY_FEE_PROVIDERS),
  effectiveFrom: businessDate,
  percent: percent(100),
  fixed: financeAmountSchema.default(0),
  notes: optionalText(500),
});

export const courierPayoutImportSchema = z.object({ destinationFinancialAccountId: id, limit: z.number().int().min(1).max(200).optional() });
export const courierReconciliationQuerySchema = z.object({
  staleDays: z.coerce.number().int().min(1).max(90).optional(),
  unsettledDays: z.coerce.number().int().min(1).max(90).optional(),
});

// ── advertising (§5) ──────────────────────────────────────────────────────────────────────────────────────────────────

export const AD_BUDGET_TYPES = ["DAILY", "LIFETIME"] as const;
export const AD_PLATFORMS = ["META", "TIKTOK", "GOOGLE", "OTHER"] as const;
const campaignFields = {
  name: z.string().trim().min(1).max(160),
  platform: z.enum(AD_PLATFORMS).optional(),
  externalId: optionalText(64),
  objective: optionalText(80),
  startDate: businessDate,
  endDate: businessDate.optional().nullable(),
  budgetType: z.enum(AD_BUDGET_TYPES).optional().nullable(),
  budget: positive.optional().nullable(),
  landingPath: optionalText(200),
  isActive: z.boolean().optional(),
  notes: optionalText(500),
};
export const adCampaignCreateSchema = z.object({ financialAccountId: id, ...campaignFields });
export const adCampaignUpdateSchema = z.object({ ...campaignFields, budgetFrom: businessDate.optional().nullable() }).partial();
const currencyCode = z.string().trim().regex(/^[A-Za-z]{3}$/, "A 3-letter currency code").transform((v) => v.toUpperCase());
const fxRate = z.number().positive().max(100000);
/** A day's spend: in taka (amount), or in the platform's currency (originalAmount + currency) at a rate (fxRate, else the default). */
export const adSpendDaySchema = z
  .object({ date: businessDate, amount: financeAmountSchema.optional().nullable(), originalAmount: financeAmountSchema.optional().nullable(), currency: currencyCode.optional().nullable(), fxRate: fxRate.optional().nullable() })
  .refine((v) => (v.amount ?? null) !== null || ((v.originalAmount ?? null) !== null && !!v.currency), "Give the spend in taka, or in its currency");
/** A total for a stretch of days, shared over the days that have no figure of their own. */
export const adPeriodSpendSchema = z
  .object({ from: businessDate, to: businessDate, amount: financeAmountSchema.optional().nullable(), originalAmount: financeAmountSchema.optional().nullable(), currency: currencyCode.optional().nullable(), fxRate: fxRate.optional().nullable() })
  .refine((v) => v.from <= v.to, "The period ends after it starts")
  .refine((v) => (v.amount ?? null) !== null || ((v.originalAmount ?? null) !== null && !!v.currency), "Give the total in taka, or in its currency");
export const adCsvImportSchema = z.object({ financialAccountId: id, csv: z.string().min(1).max(2_000_000), currency: currencyCode.optional().nullable(), fxRate: fxRate.optional().nullable(), commit: z.boolean() });
export const adCampaignListQuerySchema = z.object({ from: businessDate.optional(), to: businessDate.optional() });
export const metaSpendImportSchema = z.object({ days: z.number().int().min(1).max(400).optional(), since: businessDate.optional() });

// ── prepaid costs (§6.1) ──────────────────────────────────────────────────────────────────────────────────────────────

export const prepaidCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  expenseAccountId: id,
  amount: positive,
  serviceStart: businessDate,
  serviceEnd: businessDate,
  fromFinancialAccountId: id,
  paidOn: businessDate.optional(),
  payee: optionalText(200),
  reference: optionalText(120),
  notes: optionalText(500),
  remindDaysBefore: z.number().int().min(0).max(365).optional(),
  renewalAmount: positive.optional().nullable(),
});
export const prepaidUpdateSchema = z
  .object({ name: z.string().trim().min(1).max(160).optional(), notes: optionalText(500), serviceEnd: businessDate.optional(), remindDaysBefore: z.number().int().min(0).max(365).optional(), renewalAmount: positive.optional().nullable() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to change");

// ── packaging (§6.2) ──────────────────────────────────────────────────────────────────────────────────────────────────

export const PACKING_RULE_SCOPES = ["EVERY_PARCEL", "CATEGORY", "PRODUCT", "VARIANT"] as const;
export const packingRuleCreateSchema = z.object({
  scope: z.enum(PACKING_RULE_SCOPES),
  scopeId: id.optional().nullable(),
  materialVariantId: id,
  quantity: z.number().int().min(1).max(1000),
  per: z.enum(["PARCEL", "UNIT"]).default("PARCEL"),
  notes: optionalText(300),
});
export const packingRuleUpdateSchema = z.object({ isActive: z.boolean() });

// ── landed costs and quick refills (§7) ───────────────────────────────────────────────────────────────────────────────

export const landedCostCreateSchema = z.object({
  costDate: businessDate.optional(),
  description: z.string().trim().min(1).max(300),
  payee: optionalText(200),
  amount: positive,
  method: z.enum(["QUANTITY", "VALUE"]),
  goodsReceiptIds: z.array(id).min(1).max(20),
  fromFinancialAccountId: id,
  reference: optionalText(120),
});

export const quickRefillSchema = z.object({
  variantId: id,
  quantity: z.number().int().min(1).max(100000),
  used: z.array(z.object({ materialVariantId: id, quantity: z.number().int().min(0).max(100000000) })).max(30).optional(),
  note: optionalText(300),
});

// ── profit (§8) ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const profitQuerySchema = z.object({ from: businessDate.optional(), to: businessDate.optional() });

// ── courier claims (§3.5) and cancelling a landed cost (§7.1) ─────────────────────────────────────────────────────────

export const courierClaimCreateSchema = z.object({ orderId: id, amount: positive, reason: z.string().trim().min(3).max(300), claimDate: businessDate.optional() });
export const courierClaimSettleSchema = z
  .object({ kind: z.enum(["MONEY", "PAYOUT", "WRITE_OFF"]), amount: positive, date: businessDate.optional(), financialAccountId: id.optional().nullable(), note: optionalText(300) })
  .refine((v) => v.kind !== "MONEY" || Boolean(v.financialAccountId), { message: "Choose the account the money came into", path: ["financialAccountId"] });
export const landedCostCancelSchema = z.object({ reason: z.string().trim().min(3).max(500) });

// ── Finance Center (docs/FINANCE_CENTER.md) ────────────────────────────────────────────────────────────────────────────

export const ENTRY_VERIFICATIONS = ["CONFIRMED", "ESTIMATED", "NEEDS_CHECK", "DISPUTED"] as const;
export const VERIFIABLE_ENTITY_TYPES = ["Expense", "PrepaidCost", "FixedAsset", "OpeningBalanceLine", "OpeningInventoryItem", "LandedCost", "TreasuryMovement", "AdSpendDay"] as const;
export const verificationSetSchema = z.object({ entityType: z.enum(VERIFIABLE_ENTITY_TYPES), entityId: id, status: z.enum(ENTRY_VERIFICATIONS), source: optionalText(200), note: optionalText(1000) });
export const verificationListQuerySchema = z.object({ status: z.enum(ENTRY_VERIFICATIONS).optional() });
export const expenseAllocationSchema = z.object({
  lines: z.array(z.object({ accountId: id, productId: id.optional().nullable(), amount: positive, note: optionalText(300) })).max(50),
});
export const smsBalanceSchema = z.object({ balance: financeAmountSchema, takenAt: z.string().datetime({ offset: true }).optional(), note: optionalText(300) });
export const financeCenterSettingsSchema = z
  .object({ defaultUsdRate: fxRate.nullable().optional(), smsLowBalance: financeAmountSchema.nullable().optional() })
  .refine((v) => v.defaultUsdRate !== undefined || v.smsLowBalance !== undefined, "Nothing to change");

/** Autopilot (docs/FINANCE_OWNER_BOOKS.md §15). */
export const financeAutopilotSchema = z
  .object({ payoutAccountId: id.nullable().optional(), payoutsToOwner: z.boolean().optional(), profitShares: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

/** The owner's home (docs/FINANCE_OWNER_HOME.md): one month, YYYY-MM (default: this month). */
export const ownerHomeQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A month as YYYY-MM").optional() });

// ── stock check: counts and rolls (docs/FINANCE_CENTER.md §7) ─────────────────────────────────────────────────────────

export const stockCountSchema = z.object({ variantId: id, counted: z.number().int().min(0).max(10_000_000), countDate: businessDate.optional(), note: optionalText(300) });
export const materialRollOpenSchema = z.object({ materialVariantId: id, openedOn: businessDate, note: optionalText(300) });
export const materialRollFinishSchema = z.object({ finishedOn: businessDate, parcelsCounted: z.number().int().min(1).max(1_000_000).optional().nullable(), note: optionalText(300) });
