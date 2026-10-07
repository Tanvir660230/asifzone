/** Money input of the finance API (Phase 1 / 2): major units, at most 2 decimals. Its own module so finance.ts and
 * finance-treasury.ts can both use it without importing each other. */
import { z } from "zod";

/** A non-negative amount in major units, at most 2 decimals, below ৳10¹³ (Decimal(18,2)). */
export const financeAmountSchema = z
  .union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/).transform(Number)])
  .refine((v) => Number.isFinite(v) && v >= 0, "Amount must be zero or more")
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "At most 2 decimals")
  .refine((v) => v < 1e13, "Amount is too large");
