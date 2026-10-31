import { z } from "zod";
import type { OrderStatus } from "./schemas/order";

/**
 * Warehouse picking, packing and printing (docs/WAREHOUSE_OPERATIONS.md §3). A pick list groups the selected orders'
 * units by variant so one person collects each product once; the packing sheets split them back into orders. Printing is
 * recorded (who, when, first print or reprint) and never changes stock, status, handover or money.
 */

export const PRINT_KINDS = ["PICK_LIST", "PACKING_SHEET", "COURIER_LABEL", "PRODUCT_LABEL", "MANIFEST"] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];

export const PRINT_KIND_LABEL: Record<PrintKind, string> = {
  PICK_LIST: "Pick list",
  PACKING_SHEET: "Packing sheets",
  COURIER_LABEL: "Courier labels",
  PRODUCT_LABEL: "Product labels",
  MANIFEST: "Handover manifest",
};

/** One pick run is capped — a bigger batch is split, so a lost sheet costs little. */
export const PICK_LIST_MAX_ORDERS = 300;

export const pickListRequestSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1, "Select at least one order").max(PICK_LIST_MAX_ORDERS, `At most ${PICK_LIST_MAX_ORDERS} orders per pick list`),
});
export type PickListRequest = z.infer<typeof pickListRequestSchema>;

export const recordPrintRunSchema = z
  .object({
    kind: z.enum(PRINT_KINDS),
    clientRunId: z.string().min(8).max(80),
    orderIds: z.array(z.string().min(1)).max(1000).default([]),
    variants: z.array(z.object({ variantId: z.string().min(1), quantity: z.number().int().min(1).max(500) })).max(500).default([]),
    copies: z.number().int().min(1).max(50).default(1),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.orderIds.length > 0 || v.variants.length > 0, { message: "Nothing to record — no orders or products" })
  .refine((v) => (v.kind === "PRODUCT_LABEL" ? v.variants.length > 0 : v.orderIds.length > 0), { message: "Product labels list products; every other print lists orders" });
export type RecordPrintRunInput = z.infer<typeof recordPrintRunSchema>;

export const printRunListQuerySchema = z.object({
  kind: z.enum(PRINT_KINDS).optional(),
  orderId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const productLabelQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().optional(),
  /** Comma-separated variant ids — the pick list's "print product labels" hands its variants over this way. */
  variantIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500) : undefined)),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Why an order was left out of a pick list — it isn't the warehouse's to pick right now. */
export type PickSkipReason = "NOT_FOUND" | "IN_TRASH" | "NOT_CONFIRMED" | "ALREADY_LEFT" | "CLOSED";

export const PICK_SKIP_LABEL: Record<PickSkipReason, string> = {
  NOT_FOUND: "Not found",
  IN_TRASH: "In Trash",
  NOT_CONFIRMED: "Not confirmed yet",
  ALREADY_LEFT: "Already handed to the courier",
  CLOSED: "Finished or cancelled",
};

/** Statuses the warehouse picks for. SHIPPED counts only while no handover is recorded (booking marks it shipped). */
export const PICKABLE_STATUSES: readonly OrderStatus[] = ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"];

export function pickSkipReason(o: { status: OrderStatus; deletedAt: unknown; handedOverAt: unknown }): PickSkipReason | null {
  if (o.deletedAt) return "IN_TRASH";
  if (o.status === "PENDING") return "NOT_CONFIRMED";
  if (!PICKABLE_STATUSES.includes(o.status)) return "CLOSED";
  if (o.handedOverAt) return "ALREADY_LEFT";
  return null;
}

export interface PrintedSummary {
  /** How many times each kind was printed for this order (0 = never). */
  counts: Partial<Record<PrintKind, number>>;
  lastPrintedAt: string | null;
}

export interface PickListLine {
  variantId: string;
  productName: string;
  sku: string;
  size: string;
  color: string;
  barcode: string | null;
  categoryName: string | null;
  quantity: number;
  /** On hand right now (the variant's stock) — a short pick is seen before walking to the shelf. */
  stockOnHand: number | null;
  orders: Array<{ orderId: string; orderNumber: string; quantity: number }>;
}

export interface PackingSheetItem {
  orderItemId: string;
  variantId: string;
  productName: string;
  sku: string;
  size: string;
  color: string;
  barcode: string | null;
  quantity: number;
}

export interface PackingSheet {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  address: string;
  district: string | null;
  paymentMethod: string;
  codAmount: number;
  courierConsignmentId: string | null;
  trackingNumber: string | null;
  courierNote: string | null;
  createdAt: string;
  totalUnits: number;
  items: PackingSheetItem[];
  printed: PrintedSummary;
}

export interface PickListResponse {
  generatedAt: string;
  lines: PickListLine[];
  sheets: PackingSheet[];
  skipped: Array<{ orderId: string; orderNumber: string | null; reason: PickSkipReason }>;
  totals: { orders: number; units: number; products: number };
}

export interface ProductLabelVariant {
  variantId: string;
  productId: string;
  productName: string;
  categoryName: string | null;
  sku: string;
  barcode: string | null;
  size: string;
  color: string;
  price: number | null;
  /** What a scanner reads off this label: the variant's own barcode, else its SKU. */
  code: string;
}

export interface PrintRunView {
  id: string;
  kind: PrintKind;
  adminName: string | null;
  orderCount: number;
  unitCount: number;
  copies: number;
  reprint: boolean;
  reason: string | null;
  createdAt: string;
  /** Order ids (or variant ids for product labels) this run covered, and which of them were reprints. */
  items: Array<{ orderId: string | null; variantId: string | null; quantity: number; reprint: boolean }>;
}
