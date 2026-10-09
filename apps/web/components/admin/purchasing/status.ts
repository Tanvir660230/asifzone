import type { GoodsReceiptStatus, PurchaseOrderStatus, PurchaseReturnStatus } from "@/lib/api/purchasing";

/** Badge variant and wording of each purchasing document status (docs/FINANCE_PHASE_4D.md) — one place for every page. */
export const PO_STATUS_BADGE = { DRAFT: "neutral", SUBMITTED: "info", APPROVED: "info", PARTIALLY_RECEIVED: "warning", RECEIVED: "success", CLOSED: "neutral", CANCELLED: "neutral" } as const;
export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = { DRAFT: "draft", SUBMITTED: "awaiting approval", APPROVED: "approved", PARTIALLY_RECEIVED: "partly received", RECEIVED: "received", CLOSED: "closed", CANCELLED: "cancelled" };
export const GRN_STATUS_BADGE = { DRAFT: "neutral", POSTED: "success", REVERSED: "neutral" } as const;
export const GRN_STATUS_LABEL: Record<GoodsReceiptStatus, string> = { DRAFT: "draft", POSTED: "posted", REVERSED: "reversed" };
export const RETURN_STATUS_BADGE = { DRAFT: "neutral", APPROVED: "info", SHIPPED: "success", CANCELLED: "neutral" } as const;
export const RETURN_STATUS_LABEL: Record<PurchaseReturnStatus, string> = { DRAFT: "draft", APPROVED: "approved", SHIPPED: "shipped", CANCELLED: "cancelled" };
