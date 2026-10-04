import crypto from "crypto";
import type { Request } from "express";
import { normalizeBdPhone } from "@clothing-brand/shared";
import { env } from "../../config/env";
import { liveProvidersEnabled } from "../provider-guard";

/** Low-level Meta Conversions API client — config gate, Meta's customer-information normalization
 * + SHA-256 hashing rules, and the one HTTP call to the Graph API. Knows nothing about orders; see
 * purchase.ts for the Purchase event built on top of this. */

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

/** Thrown for a failed send. `retryable` separates "try again later" (network, timeout, 5xx, 429,
 * Meta's own is_transient flag) from a payload/credential problem that no retry will ever fix. */
export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

const REQUEST_TIMEOUT_MS = 8000;

/** Configured AND allowed to send from this environment — see env.meta for why non-production
 * additionally requires a test event code. */
export function isMetaCapiEnabled(): boolean {
  const { pixelId, accessToken, testEventCode } = env.meta;
  if (!pixelId || !accessToken || !liveProvidersEnabled()) return false;
  return env.nodeEnv === "production" || Boolean(testEventCode);
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
  return /^01\d{9}$/.test(local) ? `880${local.slice(1)}` : null;
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

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean; fbtrace_id?: string };
  events_received?: number;
}

/** POSTs one event to /{pixel-id}/events with a hard timeout. The access token goes in the JSON
 * body, not the query string, so it can't end up in any proxy/access log. Error messages carry
 * Meta's own error code/message/fbtrace_id only — never the request payload. */
export async function sendMetaEvent(event: MetaServerEvent): Promise<{ eventsReceived: number }> {
  const { pixelId, accessToken, apiVersion, testEventCode } = env.meta;
  const url = `https://graph.facebook.com/${apiVersion}/${pixelId}/events`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [event],
        access_token: accessToken,
        ...(testEventCode ? { test_event_code: testEventCode } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new MetaApiError(`request failed: ${err instanceof Error ? err.message : String(err)}`, true);
  }

  const body = (await res.json().catch(() => ({}))) as GraphErrorBody;
  if (!res.ok) {
    const e = body.error ?? {};
    const retryable = res.status >= 500 || res.status === 429 || e.is_transient === true;
    throw new MetaApiError(
      `HTTP ${res.status} code=${e.code ?? "?"}/${e.error_subcode ?? "-"} "${e.message ?? "unknown error"}" fbtrace_id=${e.fbtrace_id ?? "-"}`,
      retryable,
    );
  }
  return { eventsReceived: body.events_received ?? 0 };
}
