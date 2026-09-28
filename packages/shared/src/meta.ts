/** Single source of truth for anything the browser Pixel (apps/web/lib/meta-pixel.ts) and the
 * server-side Conversions API (apps/api/src/lib/meta/) must agree on byte-for-byte — Meta only
 * deduplicates a browser/server pair of the same event when event_name AND event_id match exactly. */

export const META_CURRENCY = "BDT";

/** Deterministic, so both sides derive the same id independently from data they each already have
 * (the order number) — no id ever needs to be minted on one side and shipped to the other. Order
 * numbers are unique and never change, which also makes every server retry of the same Purchase
 * collapse into one event on Meta's side. */
export function metaPurchaseEventId(orderNumber: string): string {
  return `purchase_${orderNumber}`;
}
