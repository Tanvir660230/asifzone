import { isBdMobileLocal, normalizeBdPhone, toBdInternationalDigits } from "./country/bd";

/** Single source of truth for anything the browser Pixel (apps/web/lib/pixels/meta.ts) and the
 * server-side Conversions API (apps/api/src/lib/meta/) must agree on byte-for-byte — Meta only
 * deduplicates a browser/server pair of the same event when event_name AND event_id match exactly.
 * The event currency is the store currency (both sides read it from settings — Phase 7), not a constant here. */

/** Deterministic, so both sides derive the same id independently from data they each already have
 * (the order number) — no id ever needs to be minted on one side and shipped to the other. Order
 * numbers are unique and never change, which also makes every server retry of the same Purchase
 * collapse into one event on Meta's side. */
/** Shared by every ad platform, not just Meta: the browser TikTok Pixel sends the same id (apps/web/lib/pixels/index.ts's
 * purchaseEventId), so a future TikTok Events API sender must reuse this function too. */
export function metaPurchaseEventId(orderNumber: string): string {
  return `purchase_${orderNumber}`;
}

// ── Advanced matching: the customer-information keys both senders attach ──────────────────────

/** Meta: trim + lowercase. */
export function normalizeMetaEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Meta wants digits only, country code included, no leading "+" or trunk 0 — 01712345678 → 8801712345678. null = not
 * a BD mobile number, which would only hand Meta a key that can't match anyone. */
export function normalizeMetaPhone(phone: string): string | null {
  const local = normalizeBdPhone(phone);
  return isBdMobileLocal(local) ? toBdInternationalDigits(local) : null;
}

/** Names, city, state: lowercase with punctuation and whitespace stripped. Unicode-aware so a Bengali-script name
 * survives as UTF-8 (which Meta accepts) instead of being erased. */
export function normalizeMetaText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

/** First token → first name, last token → last name. A single-word name only yields a first name — guessing a last
 * name would just hand Meta a wrong match key. */
export function splitMetaName(fullName: string): { firstName: string | null; lastName: string | null } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  return { firstName: parts[0]!, lastName: parts.length > 1 ? parts[parts.length - 1]! : null };
}

/** What the shopper told the store about themselves — only fields they typed into checkout or their own account. */
export interface MetaMatchCustomer {
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  /** The shipping district. */
  city?: string | null;
  /** The shipping division. */
  state?: string | null;
}

/** Meta's advanced-matching keys, normalized but NOT hashed: the browser Pixel hashes them itself (SHA-256, inside
 * fbevents.js) and the Conversions API hashes them in apps/api/src/lib/meta/capi.ts — so both sides hand Meta the same
 * hash for the same shopper. Unknown fields are left out, never sent empty. */
export type MetaMatchKeys = Partial<Record<"em" | "ph" | "fn" | "ln" | "ct" | "st" | "country", string>>;

export function metaMatchKeys(customer: MetaMatchCustomer): MetaMatchKeys {
  const { firstName, lastName } = splitMetaName(customer.fullName ?? "");
  const keys: Record<string, string | null> = {
    em: customer.email?.trim() ? normalizeMetaEmail(customer.email) : null,
    ph: customer.phone ? normalizeMetaPhone(customer.phone) : null,
    fn: firstName ? normalizeMetaText(firstName) : null,
    ln: lastName ? normalizeMetaText(lastName) : null,
    ct: customer.city ? normalizeMetaText(customer.city) : null,
    st: customer.state ? normalizeMetaText(customer.state) : null,
  };
  const known = Object.fromEntries(Object.entries(keys).filter(([, v]) => v)) as MetaMatchKeys;
  // Every order ships inside Bangladesh, but "bd" alone identifies no one — only sent alongside a real key.
  return Object.keys(known).length > 0 ? { ...known, country: "bd" } : {};
}
