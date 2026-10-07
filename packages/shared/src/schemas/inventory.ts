import { z } from "zod";
import { nullableString, paginationQuerySchema } from "./common";

export const stockMovementReasonEnum = z.enum(["ORDER", "RESTOCK", "ADJUSTMENT", "RETURN", "CANCELLATION", "IMPORT", "DAMAGED", "LOST"]);

/** Reasons an admin may pick for a manual adjustment. ORDER/RETURN/CANCELLATION/IMPORT are written only by the
 * system as a side effect of orders, returns and CSV imports. DAMAGED/LOST are write-offs, so they must reduce stock. */
export const manualStockReasonEnum = z.enum(["RESTOCK", "ADJUSTMENT", "DAMAGED", "LOST"]);

export const stockMovementListQuerySchema = paginationQuerySchema.extend({
  variantId: z.string().cuid().optional(),
  productId: z.string().cuid().optional(),
  reason: stockMovementReasonEnum.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const adjustStockSchema = z
  .object({
    delta: z.number().int().refine((v) => v !== 0, "Delta cannot be zero"),
    reason: manualStockReasonEnum,
    note: nullableString(300),
  })
  .refine((v) => !(v.reason === "DAMAGED" || v.reason === "LOST") || v.delta < 0, {
    message: "Damaged or lost stock is a write-off — the change must be negative",
    path: ["delta"],
  })
  .refine((v) => v.reason !== "RESTOCK" || v.delta > 0, { message: "A restock must add stock", path: ["delta"] });

/** Stock levels list (Blueprint V2 §O): one row per variant. `state` follows the shared variantStockState rule
 * (UNLIMITED = inventory not tracked). Default order puts what needs restocking first. */
export const stockLevelStateEnum = z.enum(["OUT_OF_STOCK", "LOW_STOCK", "IN_STOCK", "UNLIMITED"]);
export const stockLevelsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  state: stockLevelStateEnum.optional(),
  sort: z.enum(["attention", "available", "-available", "name"]).default("attention"),
});

export interface StockLevelRow {
  variantId: string;
  productId: string;
  productName: string;
  imageUrl: string | null;
  sku: string;
  size: string;
  color: string;
  /** ProductVariant.stock — what can still be sold (units are taken off at order placement). */
  available: number;
  /** Units held by orders that haven't shipped yet (PENDING, CONFIRMED, PROCESSING, PACKED): Σ quantity − restocked. */
  reserved: number;
  /** In the warehouse: available + reserved. */
  onHand: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  active: boolean;
  state: z.infer<typeof stockLevelStateEnum>;
  /** Available ÷ average daily units ordered over the last 30 days; null with no sales in that window or untracked. */
  daysOfCover: number | null;
}

export interface StockLevelsResult {
  items: StockLevelRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Variants per state for the current search (tab badges). */
  counts: Record<z.infer<typeof stockLevelStateEnum> | "ALL", number>;
}

export type StockLevelsQuery = z.infer<typeof stockLevelsQuerySchema>;
export type StockMovementListQuery = z.infer<typeof stockMovementListQuerySchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type StockMovementReason = z.infer<typeof stockMovementReasonEnum>;
export type ManualStockReason = z.infer<typeof manualStockReasonEnum>;
