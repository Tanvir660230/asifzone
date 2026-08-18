import { env } from "./env";

const COOKIE_NAME = "az_session";
const VISITOR_COOKIE_NAME = "az_visitor";
const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

interface SessionAttribution {
  sid: string;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

const EMPTY_ATTRIBUTION: SessionAttribution = { sid: "", referrer: null, utmSource: null, utmMedium: null, utmCampaign: null };

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  // No max-age — a session cookie, cleared when the browser closes, matching what "session" means
  // for traffic-source/bounce-rate/conversion-rate analytics (see PageView in the Prisma schema).
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Persistent (1yr) visitor id, separate from the per-browser-session `az_session` cookie above —
 * written once and reused on every later visit so BI metrics can tell a returning visitor from a
 * brand-new one. Deliberately its own cookie rather than reusing `sid`, since `sid` is designed to
 * churn every session for traffic-source/bounce-rate accuracy. */
export function getVisitorId(): string {
  if (typeof document === "undefined") return "";

  const existing = readCookie(VISITOR_COOKIE_NAME);
  if (existing) return existing;

  const id = randomId();
  document.cookie = `${VISITOR_COOKIE_NAME}=${encodeURIComponent(id)}; path=/; max-age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  return id;
}

/** First-touch attribution (referrer + UTM params) captured once per browser session and cached in
 * a cookie — every later call in the same session returns the same values, even from a page with
 * no referrer/UTM of its own, so a purchase three pages into the visit still attributes back to
 * whatever brought the visitor in. */
export function getSessionAttribution(): SessionAttribution {
  if (typeof document === "undefined") return EMPTY_ATTRIBUTION;

  const existing = readCookie(COOKIE_NAME);
  if (existing) {
    try {
      return JSON.parse(existing) as SessionAttribution;
    } catch {
      // corrupted cookie value — fall through and mint a fresh session below
    }
  }

  const params = new URLSearchParams(window.location.search);
  const attribution: SessionAttribution = {
    sid: randomId(),
    referrer: document.referrer || null,
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
  };
  writeCookie(COOKIE_NAME, JSON.stringify(attribution));
  return attribution;
}

export function getSessionId(): string {
  return getSessionAttribution().sid;
}

/** Reads the (deliberately non-httpOnly) csrf_token cookie — same double-submit pattern as
 * `apiFetch` in `lib/api-client.ts`. Needed here because `credentials: "include"` on the beacon
 * below now carries the customer session cookie (so the API can tell isLoggedIn), which puts this
 * POST under csrfProtection's check (see apps/api/src/middlewares/csrf.ts). */
function readCsrfCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match?.[1];
}

/** Client-side, fire-and-forget pageview beacon — a failed/slow analytics call must never affect
 * the visitor's experience. `keepalive` lets it finish even if the SPA navigation that triggered
 * it unmounts the caller immediately after. Returns the created row's id (or null on failure) so
 * the caller can later attach an exit beacon (see sendPageExit) to this exact pageview. */
export async function trackPageView(path: string): Promise<string | null> {
  const attribution = getSessionAttribution();
  if (!attribution.sid) return null;

  try {
    const res = await fetch(`${env.apiUrl}/api/analytics/pageview`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(readCsrfCookie() ? { "X-CSRF-Token": readCsrfCookie()! } : {}),
      },
      body: JSON.stringify({
        sessionId: attribution.sid,
        visitorId: getVisitorId(),
        path,
        referrer: attribution.referrer,
        utmSource: attribution.utmSource,
        utmMedium: attribution.utmMedium,
        utmCampaign: attribution.utmCampaign,
      }),
      keepalive: true,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id: string };
    return data.id;
  } catch {
    return null;
  }
}

/** Fire-and-forget "exit" beacon — sent once a visitor leaves the page whose id this is, carrying
 * engagement data that's only known at that point (time on page, max scroll depth, click count).
 * navigator.sendBeacon is used when available since it's the one API designed to reliably survive
 * a page unload; fetch's `keepalive` (used elsewhere in this file) is the fallback for the rare
 * browser without sendBeacon support. */
export function sendPageExit(id: string, payload: { durationMs: number; scrollDepthPct: number; clickCount: number }): void {
  const url = `${env.apiUrl}/api/analytics/pageview/${id}/exit`;
  const body = JSON.stringify(payload);

  if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
    navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    return;
  }

  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

export type FunnelEventType = "VARIANT_SELECTED" | "ADD_TO_CART" | "REMOVE_FROM_CART";

/** Fire-and-forget purchase-funnel event beacon (Sections 3 &amp; 5 BI) — journey/product-interest
 * steps that leave no other trace, especially for guest shoppers whose cart never touches the
 * server at all. No credentials/CSRF pairing needed here (unlike trackPageView) since the API
 * doesn't read the customer session for this endpoint. */
export function trackFunnelEvent(type: FunnelEventType, payload: { productId?: string; variantId?: string; path?: string } = {}): void {
  const attribution = getSessionAttribution();
  if (!attribution.sid) return;

  fetch(`${env.apiUrl}/api/analytics/funnel-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: attribution.sid,
      visitorId: getVisitorId(),
      type,
      productId: payload.productId ?? null,
      variantId: payload.variantId ?? null,
      path: payload.path ?? (typeof window !== "undefined" ? window.location.pathname : null),
    }),
    keepalive: true,
  }).catch(() => {});
}

/** Fire-and-forget search-session correlation beacon (Section 4 BI) — the search-results page
 * (`app/(storefront)/search/page.tsx`) is a Server Component that fetches results through an
 * ISR-cached, session-agnostic request, so the SearchLog row `listStorefrontProducts` creates has
 * no session id at write time. This beacon, fired client-side once the page has rendered,
 * best-effort attaches one after the fact (see attributeSearchSession in analytics.service.ts). */
export function trackSearchSession(query: string): void {
  const attribution = getSessionAttribution();
  if (!attribution.sid) return;

  fetch(`${env.apiUrl}/api/analytics/search-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: attribution.sid, visitorId: getVisitorId(), query }),
    keepalive: true,
  }).catch(() => {});
}
