import { z } from "zod";

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
 * The tokens a scanned code may name an order by, in the order they are tried: the code itself, then — for a URL or a
 * QR payload — its path segments and query values (e.g. https://shop/track?order=ORD-… or …/t/AZT123).
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
  return [...out].filter((c) => c.length >= 3 && c.length <= 120);
}

export const createScanBatchSchema = z.object({ kind: z.enum(PARCEL_SCAN_KINDS), note: z.string().trim().max(300).optional() });

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
