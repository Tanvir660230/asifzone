/**
 * A changed cash-on-delivery amount, read from a Steadfast push. Two kinds, both seen live in November 2026:
 * - `consignment_update` — someone edited the parcel in the merchant panel: `{ changed: ["cod_amount"], values: { cod_amount: 120 } }`;
 * - `tracking_update` — the hub or the rider changed it ("Amount has been changed  from "1510" to "120""), or the panel's
 *   edit as text ("Changes: COD '1510' to '1200'. By User …").
 * A rider's words ("Cod 120 tk hbe") are not a change, and an unreadable amount is null, never 0. Pure.
 */
export interface CodChange {
  /** The amount before, when the push says it. */
  from: number | null;
  to: number;
  /** Who changed it: the merchant's panel, or the courier (hub / rider). */
  source: "MERCHANT" | "COURIER";
  /** Steadfast's own time for the change, "YYYY-MM-DD HH:MM:SS" in Dhaka time; null when absent or unreadable. */
  at: string | null;
}

const NUMBER = String.raw`(\d+(?:\.\d{1,2})?)`;
/** Anchored at the start: the same words quoted inside a rider's note are not a change. */
const COURIER_CHANGE = new RegExp(String.raw`^Amount has been changed\s+from\s+["']${NUMBER}["']\s+to\s+["']${NUMBER}["']`, "i");
const PANEL_CHANGE = new RegExp(String.raw`^Changes:.*?\bCOD\s+["']${NUMBER}["']\s+to\s+["']${NUMBER}["']`, "is");

function amountOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

function timeOf(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v.trim()) ? v.trim() : null;
}

export function codChangeOf(payload: unknown): CodChange | null {
  if (!payload || typeof payload !== "object") return null;
  const b = payload as Record<string, unknown>;
  const at = timeOf(b.updated_at);
  const type = typeof b.notification_type === "string" ? b.notification_type.toLowerCase() : "";

  if (type === "consignment_update") {
    if (!Array.isArray(b.changed) || !b.changed.includes("cod_amount")) return null;
    const to = amountOf((b.values as Record<string, unknown> | null | undefined)?.cod_amount);
    return to === null ? null : { from: null, to, source: "MERCHANT", at };
  }
  if (type !== "tracking_update" || typeof b.tracking_message !== "string") return null;
  const text = b.tracking_message.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim();
  const courier = COURIER_CHANGE.exec(text);
  if (courier) return { from: Number(courier[1]), to: Number(courier[2]), source: "COURIER", at };
  const panel = PANEL_CHANGE.exec(text);
  if (panel) return { from: Number(panel[1]), to: Number(panel[2]), source: "MERCHANT", at };
  return null;
}
