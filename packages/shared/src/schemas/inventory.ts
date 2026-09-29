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

export type StockMovementListQuery = z.infer<typeof stockMovementListQuerySchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type StockMovementReason = z.infer<typeof stockMovementReasonEnum>;
export type ManualStockReason = z.infer<typeof manualStockReasonEnum>;
