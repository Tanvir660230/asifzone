/**
 * Cost & profit planning (docs/COST_SHEET.md): what one sale costs, set for the shop, a category or a product. A planning
 * aid — nothing here is booked. Money in MAJOR units (≤ 2 decimals); percentages 0–100 (≤ 2 decimals).
 */
import { z } from "zod";

export const COST_PROFILE_SCOPES = ["BUSINESS", "CATEGORY", "PRODUCT"] as const;
export type CostProfileScope = (typeof COST_PROFILE_SCOPES)[number];
export const COST_LINE_KINDS = ["MAKING", "PACKAGING", "COURIER", "PAYMENT_FEE", "RETURN_RESERVE", "ADS", "LABOUR", "OTHER"] as const;
export type CostLineKind = (typeof COST_LINE_KINDS)[number];
export const COST_LINE_MODES = ["AUTO", "FIXED", "PERCENT_OF_PRICE"] as const;
export type CostLineMode = (typeof COST_LINE_MODES)[number];

const pct = (max: number) => z.number().min(0).max(max).refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "At most 2 decimals");

export const costProfileSchema = z
  .object({
    insideDhakaPct: pct(100).nullable().optional(),
    codPct: pct(100).nullable().optional(),
    returnRatePct: pct(100).nullable().optional(),
    targetMarginPct: pct(95).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    /** The profile's own lines — replaces them as a whole. A kind left out follows the level above (or AUTO). */
    lines: z
      .array(
        z
          .object({
            kind: z.enum(COST_LINE_KINDS),
            variantId: z.string().trim().min(1).max(64).nullable().optional(),
            mode: z.enum(COST_LINE_MODES),
            amount: z.number().min(0).max(10_000_000).nullable().optional(),
            label: z.string().trim().max(80).nullable().optional(),
          })
          .refine((l) => (l.mode === "AUTO") === (l.amount === null || l.amount === undefined), { message: "An amount for a fixed or percent line, none for auto", path: ["amount"] })
          .refine((l) => l.mode !== "PERCENT_OF_PRICE" || (l.amount ?? 0) <= 100, { message: "A percent is at most 100", path: ["amount"] }),
      )
      .max(100)
      .refine((ls) => new Set(ls.map((l) => `${l.kind}:${l.variantId ?? ""}`)).size === ls.length, "Each cost once per size")
      .default([]),
  });
export type CostProfileInput = z.input<typeof costProfileSchema>;

export const costProfileScopeParams = z.object({ scope: z.enum(COST_PROFILE_SCOPES), scopeId: z.string().trim().max(64).default("") });
