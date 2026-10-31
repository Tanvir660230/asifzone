import { z } from "zod";
import type { OrderStatus } from "./schemas/order";
import { isBdMobileLocal, normalizeBdPhone } from "./country/bd";

/**
 * Dispatch and return scanning (Order Operations plan, phase 4). A scan records a physical fact only — the parcel was
 * handed to the courier, or it physically came back — never stock, money or the order's status. Courier booking, physical
 * handover, the courier's "returned" report, physical receipt and inspection (the only step that restocks) stay separate.
 *
 * Codes the resolver knows: our own label's barcode (Order.trackingNumber), the courier consignment id, our order number,
 * and a URL / QR payload carrying one of them. Anything else (e.g. a courier sticker code nobody has confirmed yet — M6)
 * is logged as unknown and does nothing.
 */

export const PARCEL_SCAN_KINDS = ["DISPATCH", "RETURN"] as const;
export type ParcelScanKind = (typeof PARCEL_SCAN_KINDS)[number];

export const PARCEL_SCAN_RESULTS = ["ACCEPTED", "DUPLICATE", "ALREADY_PROCESSED", "INVALID", "INELIGIBLE"] as const;
export type ParcelScanResult = (typeof PARCEL_SCAN_RESULTS)[number];

export const PARCEL_SCAN_RESULT_LABELS: Record<ParcelScanResult, string> = {
  ACCEPTED: "Added",
  DUPLICATE: "Already in this batch",
  ALREADY_PROCESSED: "Already done",
  INVALID: "Unknown code",
  INELIGIBLE: "Can't be scanned",
};

/** A scanner wedge can add stray whitespace / control characters; codes compare case-insensitively. */
export function normalizeScanCode(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

/**
 * Steadfast's own label and return-slip barcode: dashed digit groups ending in the zero-padded consignment id —
 * `003-0102-001-00311971298` (return slip) or `002-0356-001-00311971298` (the parcel label) both name consignment
 * 311971298. Seen on real parcels, 2026-10-31. Returns the consignment id, or null for any other code.
 */
export function steadfastSlipConsignment(raw: string): string | null {
  const m = /^\d+(?:-\d+){2,}-0*(\d{6,})$/.exec(normalizeScanCode(raw));
  return m ? m[1]! : null;
}

/**
 * The tokens a scanned code may name an order by, in the order they are tried: the code itself, then — for a URL or a
 * QR payload — its path segments and query values (e.g. https://shop/track?order=ORD-… or …/t/AZT123); for a Steadfast
 * label or return slip, the consignment id it ends in.
 */
export function scanCodeCandidates(raw: string): string[] {
  const code = normalizeScanCode(raw);
  if (!code) return [];
  const out = new Set<string>([code]);
  if (/^https?:\/\//i.test(code)) {
    // Parsed by hand (this package has no DOM / URL global): query values first, then the path from its end.
    const decode = (s: string) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, " ")).trim();
      } catch {
        return s.trim();
      }
    };
    const [beforeHash] = code.split("#");
    const [base, query = ""] = beforeHash!.split("?");
    for (const pair of query.split("&")) {
      const value = decode(pair.slice(pair.indexOf("=") + 1));
      if (pair.includes("=") && value) out.add(value);
    }
    const path = base!.replace(/^https?:\/\/[^/]+/i, "");
    for (const seg of path.split("/").map(decode).filter(Boolean).reverse()) out.add(seg);
  }
  const slip = steadfastSlipConsignment(code);
  if (slip) out.add(slip);
  return [...out].filter((c) => c.length >= 3 && c.length <= 120);
}

/** How a scanned code named its order (ParcelScanEvent.resolvedBy) — shown to the operator, so a surprising match is seen. */
export const SCAN_MATCH_KINDS = ["ORDER_NUMBER", "TRACKING", "CONSIGNMENT", "STEADFAST_LINK", "STEADFAST_SLIP", "ALIAS"] as const;
export type ScanMatchKind = (typeof SCAN_MATCH_KINDS)[number];

export const SCAN_MATCH_LABELS: Record<ScanMatchKind | "PRODUCT" | "PHONE", string> = {
  ORDER_NUMBER: "Order number",
  TRACKING: "Our label barcode",
  CONSIGNMENT: "Consignment id",
  STEADFAST_LINK: "Steadfast QR",
  STEADFAST_SLIP: "Steadfast slip barcode",
  ALIAS: "Code linked by hand",
  PRODUCT: "Product barcode / SKU",
  PHONE: "Customer phone",
};

/** A phone number as scanned or typed (01XXXXXXXXX, +8801…, 8801…), or null when the code is not one. */
export function scannedPhone(raw: string): string | null {
  const code = normalizeScanCode(raw);
  // Only digits, spaces, dashes and a leading + — a barcode with letters is never read as a phone.
  if (!/^\+?[\d\s-]{10,17}$/.test(code)) return null;
  const local = normalizeBdPhone(code);
  return isBdMobileLocal(local) ? local : null;
}

// ─── The scanner page (Order Operations, "Receive and inspect") ────────────────────────────────────────────────────────

/** What a code is, for the scanner page: one parcel, several possible parcels (a product or a phone number matched more
 * than one order — the operator picks, never the first), or nothing. Resolving changes nothing. */
export type ParcelResolveKind = "ORDER" | "CANDIDATES" | "UNKNOWN";

export interface ParcelCandidate {
  orderId: string;
  orderNumber: string;
  customerName: string;
  area: string;
  status: OrderStatus;
  total: number;
  createdAt: string;
  consignmentId: string | null;
}

export interface ParcelResolveResult {
  kind: ParcelResolveKind;
  code: string;
  matchedBy: ScanMatchKind | "PRODUCT" | "PHONE" | null;
  orderId: string | null;
  candidates: ParcelCandidate[];
  /** The product the code named (a SKU or product barcode). */
  product: { sku: string; name: string; size: string; color: string } | null;
  message: string;
}

export const resolveParcelCodeSchema = z.object({ code: z.string().min(1).max(500), mode: z.enum(PARCEL_SCAN_KINDS) });

/** Where a parcel stands, in the words the scanner shows (one badge). */
export const PARCEL_STATES = [
  "READY_FOR_DISPATCH",
  "ALREADY_DISPATCHED",
  "NOT_BOOKED",
  "NOT_CONFIRMED",
  "CANCELLED",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "RETURNED",
  "IN_TRASH",
] as const;
export type ParcelState = (typeof PARCEL_STATES)[number];

export const PARCEL_STATE_LABELS: Record<ParcelState, string> = {
  READY_FOR_DISPATCH: "Ready for dispatch",
  ALREADY_DISPATCHED: "Already dispatched",
  NOT_BOOKED: "Not booked with a courier",
  NOT_CONFIRMED: "Not confirmed yet",
  CANCELLED: "Cancelled",
  DELIVERED: "Delivered",
  PARTIALLY_DELIVERED: "Partly delivered",
  RETURNED: "Returned",
  IN_TRASH: "In Trash",
};

/**
 * What receiving this parcel will do (decided on the server from the order's status and lines):
 * - DECIDE_OUTCOME — the courier hasn't reported it back (still Shipped): the operator says whether the customer kept
 *   anything. Kept nothing → the order is cancelled (no customer SMS); kept some → partly delivered, and what they kept
 *   stays sold.
 * - RECONCILE — the courier said partly delivered and nobody has said what the customer kept: the operator does, here.
 * - INSPECT — a return already decided (cancelled after shipping, returned, reconciled): only the inspection is left.
 * - NOTHING — nothing is waiting to come back (delivered with no return recorded, or everything already received).
 */
export type ParcelReceiveMode = "DECIDE_OUTCOME" | "RECONCILE" | "INSPECT" | "NOTHING";

export interface ParcelLineView {
  orderItemId: string;
  name: string;
  sku: string;
  size: string;
  color: string;
  /** Ordered = dispatched (one order is one parcel; there are no split shipments). */
  ordered: number;
  /** Known delivered to the customer: ordered − returned once the outcome is known, else 0. */
  delivered: number;
  /** Decided as coming back (OrderItem.returnedQuantity). */
  returned: number;
  /** Already back in stock or written off (OrderItem.restockedQuantity). */
  received: number;
  /** Units that may still physically come back — the ceiling for this receipt. */
  awaiting: number;
}

export interface ParcelReceiptView {
  id: string;
  kind: "RECEIPT" | "CORRECTION";
  outcome: string | null;
  statusBefore: OrderStatus;
  statusAfter: OrderStatus;
  createdAt: string;
  by: string | null;
  code: string | null;
  lines: Array<{ orderItemId: string; kept?: number; good?: number; damaged?: number; missing?: number; wrong?: number; other?: number; note?: string | null; from?: string; to?: string; quantity?: number }>;
  actualCollected: number | null;
  courierCharge: number | null;
  reason: string | null;
  note: string | null;
  correctsReceiptId: string | null;
}

export interface ParcelView {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  state: ParcelState;
  customerName: string;
  customerPhone: string;
  address: string;
  paymentMethod: string;
  createdAt: string;
  courier: { consignmentId: string | null; trackingNumber: string | null; trackingLink: string | null; courierStatus: string | null; bookedAt: string | null };
  handedOver: { at: string; by: string | null } | null;
  receivedBack: { at: string; by: string | null } | null;
  inspectedAt: string | null;
  lines: ParcelLineView[];
  receive: { mode: ParcelReceiveMode; awaitingUnits: number; message: string };
  /** Present only for staff who may see money (payments.read). */
  money: {
    expectedCod: number;
    /** What Steadfast reported the rider collected (partial delivery webhook), if it did. */
    courierReported: number | null;
    /** COD and return-charge money already recorded on the order — a second recording here is refused. */
    recorded: Array<{ id: string; amount: number; purpose: "ORDER" | "RETURN_CHARGE"; provider: string; at: string }>;
    /** The viewer holds payments.record. */
    canRecord: boolean;
    /** The viewer holds courier_costs.record (the courier charge goes on the parcel's shipment record). */
    canRecordCharge: boolean;
  } | null;
  receipts: ParcelReceiptView[];
  scans: Array<{ id: string; kind: ParcelScanKind; result: ParcelScanResult; code: string; at: string; by: string | null }>;
  /** Echoed back on receive: the receipt is refused (409 PARCEL_CHANGED) if the parcel changed since this view. */
  version: string;
}

export const PARCEL_MONEY_REASONS = ["PARTIAL_DELIVERY", "CUSTOMER_REFUSED", "COURIER_CHARGE_ONLY", "COD_ADJUSTMENT", "OTHER"] as const;
export type ParcelMoneyReason = (typeof PARCEL_MONEY_REASONS)[number];
export const PARCEL_MONEY_REASON_LABELS: Record<ParcelMoneyReason, string> = {
  PARTIAL_DELIVERY: "Partial delivery",
  CUSTOMER_REFUSED: "Customer refused",
  COURIER_CHARGE_ONLY: "Courier charge only",
  COD_ADJUSTMENT: "COD adjustment",
  OTHER: "Other",
};

const units = z.number().int().min(0).max(10_000);
const amount = z.number().min(0).max(10_000_000);

export const receiveParcelLineSchema = z.object({
  orderItemId: z.string().min(1),
  /** DECIDE_OUTCOME / RECONCILE: units the customer kept (they stay sold). */
  kept: units.default(0),
  /** Back in hand and sellable — the only units that become sellable stock. */
  good: units.default(0),
  /** Back in hand but unsellable — taken in and written off at the line's cost. */
  damaged: units.default(0),
  /** Not in the parcel — stays waiting (a courier claim); written off as lost later, by hand, if ever (owner D1). */
  missing: units.default(0),
  /** Something else came back in its place — the ordered unit stays waiting; the note says what came (owner D2). */
  wrong: units.default(0),
  /** Any other finding — stays waiting, with the note. */
  other: units.default(0),
  note: z.string().trim().max(300).nullish(),
});
export type ReceiveParcelLineInput = z.infer<typeof receiveParcelLineSchema>;

export const receiveParcelSchema = z
  .object({
    orderId: z.string().min(1),
    /** The view's version — the receipt is refused if the parcel changed since (another operator, the courier). */
    version: z.string().min(1).max(200),
    code: z.string().trim().max(500).nullish(),
    /** DECIDE_OUTCOME only: the customer kept nothing (FULL_RETURN) or kept some (PARTIAL). */
    outcome: z.enum(["FULL_RETURN", "PARTIAL"]).optional(),
    lines: z.array(receiveParcelLineSchema).min(1).max(200),
    /** Money the courier handed over for this parcel (payments.record). Omitted = none recorded here. */
    money: z
      .object({
        actualCollected: amount,
        courierCharge: amount.nullish(),
        reason: z.enum(PARCEL_MONEY_REASONS).nullish(),
        note: z.string().trim().max(300).nullish(),
      })
      .optional(),
    note: z.string().trim().max(500).nullish(),
  })
  .refine((v) => new Set(v.lines.map((l) => l.orderItemId)).size === v.lines.length, { message: "Each item can be listed once", path: ["lines"] });
export type ReceiveParcelInput = z.infer<typeof receiveParcelSchema>;

/** Corrections (owner decision D6): a mistaken inspection is fixed by compensating entries, never by editing it. */
export const PARCEL_CORRECTION_FROM = ["GOOD", "DAMAGED"] as const;
export const PARCEL_CORRECTION_TO = ["GOOD", "DAMAGED", "UNRESOLVED"] as const;
export const correctParcelReceiptSchema = z.object({
  lines: z
    .array(z.object({ orderItemId: z.string().min(1), from: z.enum(PARCEL_CORRECTION_FROM), to: z.enum(PARCEL_CORRECTION_TO), quantity: z.number().int().min(1).max(10_000) }))
    .min(1)
    .max(200)
    .refine((ls) => ls.every((l) => l.from !== l.to), { message: "A correction moves units from one condition to another" }),
  reason: z.string().trim().min(3, "Say what was wrong").max(500),
});
export type CorrectParcelReceiptInput = z.infer<typeof correctParcelReceiptSchema>;

export const linkParcelCodeSchema = z.object({ code: z.string().trim().min(3).max(500), orderId: z.string().min(1) });

export const createScanBatchSchema = z.object({ kind: z.enum(PARCEL_SCAN_KINDS), note: z.string().trim().max(300).optional() });

/** "The rider took these" from the orders list — a dispatch batch without a scanner (POST /api/parcel-scans/handover). */
export const handOverFromListSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1, "Select at least one order").max(200, "At most 200 parcels at once"),
  note: z.string().trim().max(200).optional(),
});

export const recordScanSchema = z.object({
  code: z.string().min(1).max(500),
  /** Generated on the device when the scan happens, so a retried (offline-queued) scan is recorded once. */
  clientScanId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Bad scan id"),
});
export type RecordScanInput = z.infer<typeof recordScanSchema>;

export interface ParcelScanEventRow {
  id: string;
  clientScanId: string;
  code: string;
  result: ParcelScanResult;
  message: string;
  orderId: string | null;
  orderNumber: string | null;
  customerName: string | null;
  /** RETURN only: the courier hasn't reported this parcel as coming back — it is held for a person to check. */
  discrepancy: boolean;
  /** How the code named the order — e.g. the Steadfast slip barcode or QR. Null for an unknown code. */
  resolvedBy: ScanMatchKind | null;
  voided: boolean;
  createdAt: string;
}

export interface ParcelScanBatchView {
  id: string;
  kind: ParcelScanKind;
  status: "OPEN" | "CONFIRMED" | "CANCELLED";
  createdAt: string;
  confirmedAt: string | null;
  createdBy: string | null;
  confirmedBy: string | null;
  accepted: number;
  events: ParcelScanEventRow[];
}

/** The parcel-operations queues (Order list filters), counted with the same predicates the list uses. */
export const PARCEL_QUEUES = ["handoverPending", "comingBack", "inspectionPending", "scanDiscrepancy", "stuckInTransit", "returnOverdue"] as const;
export type ParcelQueue = (typeof PARCEL_QUEUES)[number];
