import crypto from "crypto";
import type { Request } from "express";
import { isBdMobileLocal, normalizeBdPhone, toBdInternationalDigits } from "@clothing-brand/shared";

/** Meta Conversions API payload helpers — Meta's customer-information normalization + SHA-256 hashing rules and the
 * event shapes. The config gate and the one HTTP call to the Graph API are the provider
 * (providers/events/meta-capi.ts, reached through providers/registry.ts). Knows nothing about orders; see purchase.ts
 * for the Purchase event built on top of this. */

/** Per-request signals only the shopper's own browser request carries. Captured at checkout time
 * (never at settlement — a gateway IPN or the reconciliation cron has no shopper browser behind it)
 * and threaded through to wherever the Order finally gets written. Deliberately contains nothing
 * the checkout form itself doesn't already store on the Order. */
export interface MetaRequestContext {
  clientIpAddress?: string;
  clientUserAgent?: string;
  /** `_fbp` cookie — the Pixel's browser id; what lets Meta tie this server event to the same browser. */
  fbp?: string;
  /** `_fbc` cookie — the ad click id, set by the Pixel when the shopper landed from a Meta ad (?fbclid=). */
  fbc?: string;
}

/** Hashed fields are arrays per Meta's spec; client_* / fbp / fbc are sent unhashed, as required. */
export interface MetaUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  st?: string[];
  country?: string[];
  external_id?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string;
}

export interface MetaServerEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url: string;
  user_data: MetaUserData;
  custom_data?: Record<string, unknown>;
}



export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** Meta: trim + lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Meta wants digits only, country code included, no leading "+" or trunk 0 — 01712345678 → 8801712345678. */
export function normalizePhone(phone: string): string | null {
  const local = normalizeBdPhone(phone);
  return isBdMobileLocal(local) ? toBdInternationalDigits(local) : null;
}

/** Names, city, state: lowercase with punctuation and whitespace stripped. Unicode-aware so a
 * Bengali-script name survives as UTF-8 (which Meta accepts) instead of being erased. */
export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

/** First token → first name, last token → last name. A single-word name only yields a first name —
 * guessing a last name would just hand Meta a wrong match key. */
export function splitName(fullName: string): { firstName: string | null; lastName: string | null } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  return { firstName: parts[0]!, lastName: parts.length > 1 ? parts[parts.length - 1]! : null };
}

function hashed(value: string | null | undefined): string[] | undefined {
  return value ? [sha256(value)] : undefined;
}

// fb.<subdomainIndex>.<creationTime>.<randomOrFbclid> — a cookie that doesn't look like this was
// never written by the Pixel, so it's dropped rather than forwarded.
const FB_COOKIE_PATTERN = /^fb\.[0-2]\.\d{10,16}\.[\w.-]{1,500}$/;

function cleanFbCookie(value: unknown): string | undefined {
  return typeof value === "string" && FB_COOKIE_PATTERN.test(value) ? value : undefined;
}

/** Everything is read from the request itself — the IP/UA headers and the Pixel's own first-party
 * cookies, which reach the API because nginx serves web and API from one domain. Nothing new is
 * asked of the checkout client. */
export function metaContextFromRequest(req: Request): MetaRequestContext {
  const cookies = (req.cookies ?? {}) as Record<string, unknown>;
  const userAgent = req.get("user-agent");
  return {
    clientIpAddress: req.ip || undefined,
    clientUserAgent: userAgent ? userAgent.slice(0, 512) : undefined,
    fbp: cleanFbCookie(cookies._fbp),
    fbc: cleanFbCookie(cookies._fbc),
  };
}

export interface MetaCustomerInfo {
  email: string | null;
  phone: string | null;
  fullName: string | null;
  city: string | null;
  state: string | null;
  externalId: string | null;
}

/** Only fields the shopper typed into checkout themselves (plus their own customer id), normalized
 * and hashed per Meta's advanced-matching spec. Never payment data, never anything auth-related. */
export function buildUserData(customer: MetaCustomerInfo, context: MetaRequestContext): MetaUserData {
  const { firstName, lastName } = splitName(customer.fullName ?? "");
  const userData: MetaUserData = {
    em: hashed(customer.email ? normalizeEmail(customer.email) : null),
    ph: hashed(customer.phone ? normalizePhone(customer.phone) : null),
    fn: hashed(firstName ? normalizeText(firstName) : null),
    ln: hashed(lastName ? normalizeText(lastName) : null),
    ct: hashed(customer.city ? normalizeText(customer.city) : null),
    st: hashed(customer.state ? normalizeText(customer.state) : null),
    country: hashed("bd"),
    external_id: hashed(customer.externalId),
    client_ip_address: context.clientIpAddress,
    client_user_agent: context.clientUserAgent,
    fbp: context.fbp,
    fbc: context.fbc,
  };
  // Meta rejects empty strings/arrays in user_data — drop anything that ended up unset.
  return Object.fromEntries(Object.entries(userData).filter(([, v]) => v !== undefined && v !== "")) as MetaUserData;
}
