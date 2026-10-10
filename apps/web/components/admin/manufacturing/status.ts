import type { BomStatus, CostGroup, ProductionOrderStatus } from "@/lib/api/manufacturing";

/** Badge variant and wording of each manufacturing status (docs/MANUFACTURING.md) — one place for every page. */
export const MO_STATUS_BADGE = { DRAFT: "neutral", APPROVED: "info", IN_PRODUCTION: "warning", PARTIALLY_RECEIVED: "warning", RECEIVED: "success", CLOSED: "neutral", CANCELLED: "neutral" } as const;
export const MO_STATUS_LABEL: Record<ProductionOrderStatus, string> = { DRAFT: "draft", APPROVED: "approved", IN_PRODUCTION: "in production", PARTIALLY_RECEIVED: "partly received", RECEIVED: "received", CLOSED: "closed", CANCELLED: "cancelled" };
export const BOM_STATUS_BADGE = { DRAFT: "neutral", APPROVED: "success", ARCHIVED: "neutral" } as const;
export const BOM_STATUS_LABEL: Record<BomStatus, string> = { DRAFT: "draft", APPROVED: "approved", ARCHIVED: "archived" };
export const COST_GROUP_LABEL: Record<CostGroup, string> = { MATERIAL: "Materials", LABOUR: "Labour", EXTERNAL_SERVICE: "External services", OVERHEAD: "Overhead", OTHER: "Other" };
