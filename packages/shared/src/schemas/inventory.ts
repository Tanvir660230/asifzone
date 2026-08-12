import { z } from "zod";
import { nullableString, paginationQuerySchema } from "./common";

export const stockMovementReasonEnum = z.enum(["ORDER", "RESTOCK", "ADJUSTMENT", "RETURN"]);

export const stockMovementListQuerySchema = paginationQuerySchema.extend({
  variantId: z.string().cuid().optional(),
  productId: z.string().cuid().optional(),
  reason: stockMovementReasonEnum.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// ORDER/RETURN are system-only reasons, written by order.service.ts as a side effect of checkout/
// returns — never admin-selectable through this endpoint.
export const adjustStockSchema = z.object({
  delta: z.number().int().refine((v) => v !== 0, "Delta cannot be zero"),
  reason: z.enum(["ADJUSTMENT", "RESTOCK"]),
  note: nullableString(300),
});

export type StockMovementListQuery = z.infer<typeof stockMovementListQuerySchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
