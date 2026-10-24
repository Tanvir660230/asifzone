/**
 * Per-item stock settings (docs/STOCK_HUB.md §7): who the item is usually bought from, how many days it takes to arrive and
 * how many days of stock a reorder should cover. They drive the reorder suggestion on /admin/stock.
 */
import { z } from "zod";

export const STOCK_ITEM_DEFAULTS = { preferredSupplierId: null, leadTimeDays: 3, coverDays: 30 } as const;

export const stockItemSettingsSchema = z
  .object({
    preferredSupplierId: z.string().trim().min(1).max(64).nullable(),
    leadTimeDays: z.number().int("Whole days").min(0).max(120, "At most 120 days"),
    coverDays: z.number().int("Whole days").min(7, "At least 7 days").max(180, "At most 180 days"),
  })
  .strict();

export type StockItemSettingsInput = z.input<typeof stockItemSettingsSchema>;
export type StockItemSettings = z.output<typeof stockItemSettingsSchema>;

/** The stock list's filters (GET /stock/items): status, group, search and paging. */
export const STOCK_STATUSES = ["NEEDS_FILL", "OUT", "LOW", "OK", "EMPTY"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];
export const stockItemsQuerySchema = z.object({
  status: z.enum(STOCK_STATUSES).optional(),
  group: z.enum(["FINISHED", "FILL_TO_ORDER", "MATERIAL"]).optional(),
  q: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type StockItemsQuery = z.input<typeof stockItemsQuerySchema>;

/** Deciding a count loss that waits for the owner (POST /stock/approvals/:id/decision). */
export const stockApprovalDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(300).optional().nullable().transform((v) => (v ? v : null)),
});
export type StockApprovalDecisionInput = z.input<typeof stockApprovalDecisionSchema>;
export const stockApprovalsQuerySchema = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional() });
