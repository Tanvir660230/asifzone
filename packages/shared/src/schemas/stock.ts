/**
 * Request schemas of the stock hub (docs/STOCK_HUB.md, /admin/stock): Bought — one form for a purchase (items, extras,
 * who paid) — and Counted. Money is sent in MAJOR units with at most 2 decimals, like the rest of the finance API.
 */
import { z } from "zod";
import { isBusinessDate } from "../finance/periods";
import { financeAmountSchema } from "./finance-money";

const businessDate = z.string().refine(isBusinessDate, "Use a valid date (YYYY-MM-DD)");
const id = z.string().trim().min(1).max(64);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
/** Each amount at most 1,000,000,000; a whole purchase at most 10,000,000,000 (keeps sums far inside exact numbers). */
export const STOCK_PURCHASE_MAX_AMOUNT = 1_000_000_000;
export const STOCK_PURCHASE_MAX_TOTAL = 10_000_000_000;
const positive = financeAmountSchema.refine((v) => v > 0, "Amount must be more than zero").refine((v) => v <= STOCK_PURCHASE_MAX_AMOUNT, "At most 1,000,000,000");
const quantity = z.number().int("Whole units (stock units: ml, pcs…)").min(1).max(1_000_000);
const onceEach = (lines: Array<{ variantId: string }>) => new Set(lines.map((l) => l.variantId)).size === lines.length;
/** Who pays: a money account (cash, bank, wallet) or the owner's own money (owner-only). */
const paidFrom = z.union([z.object({ financialAccountId: id }).strict(), z.object({ ownerPocket: z.literal(true) }).strict()]);

/** Bought: what arrived, the line total paid for each item, extras spread over the items by value, and who paid. */
export const stockPurchaseSchema = z
  .object({
    date: businessDate.optional(),
    /** Find-or-create by name; empty → "Local market". */
    supplierName: z.string().trim().max(120).optional().nullable().transform((v) => (v ? v : null)).refine((v) => v === null || v.length >= 2, "At least 2 characters"),
    reference: optionalText(100),
    note: optionalText(500),
    lines: z.array(z.object({ variantId: id, quantity, amount: positive })).min(1).max(100).refine(onceEach, "Each item once — add the quantities together"),
    extras: z.array(z.object({ description: z.string().trim().min(1).max(120), amount: positive })).max(20).default([]),
    paidFrom,
  })
  .refine((p) => [...p.lines, ...p.extras].reduce((s, x) => s + x.amount, 0) <= STOCK_PURCHASE_MAX_TOTAL, { message: "A purchase is at most 10,000,000,000 in all", path: ["lines"] });
export type StockPurchaseInput = z.input<typeof stockPurchaseSchema>;

/** Finishing a purchase stuck mid-way: optionally from another account (only while nothing has been paid for it). */
export const stockPurchaseFinishSchema = z.object({ paidFrom: paidFrom.optional() });
export type StockPurchaseFinishInput = z.input<typeof stockPurchaseFinishSchema>;

export const stockPurchaseListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/** Why a count differs: a loss (DAMAGED, LOST, SAMPLE given away) or a gain / correction (FOUND, COUNT_FIX). */
export const STOCK_COUNT_REASONS = ["DAMAGED", "LOST", "SAMPLE", "FOUND", "COUNT_FIX"] as const;
export type StockCountReason = (typeof STOCK_COUNT_REASONS)[number];

/** Counted: what is on the shelf for each item; a shortfall needs a reason. */
export const stockCountsSchema = z.object({
  date: businessDate.optional(),
  lines: z
    .array(z.object({ variantId: id, counted: z.number().int().min(0).max(10_000_000), reason: z.enum(STOCK_COUNT_REASONS).optional().nullable(), note: optionalText(300) }))
    .min(1)
    .max(500)
    .refine(onceEach, "Each item once"),
});
export type StockCountsInput = z.input<typeof stockCountsSchema>;
