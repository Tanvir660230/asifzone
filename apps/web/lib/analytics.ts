import { env } from "./env";

const COOKIE_NAME = "az_session";

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

/** Client-side, fire-and-forget pageview beacon — a failed/slow analytics call must never affect
 * the visitor's experience. `keepalive` lets it finish even if the SPA navigation that triggered
 * it unmounts the caller immediately after. */
export function trackPageView(path: string): void {
  const attribution = getSessionAttribution();
  if (!attribution.sid) return;

  fetch(`${env.apiUrl}/api/analytics/pageview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: attribution.sid,
      path,
      referrer: attribution.referrer,
      utmSource: attribution.utmSource,
      utmMedium: attribution.utmMedium,
      utmCampaign: attribution.utmCampaign,
    }),
    keepalive: true,
  }).catch(() => {});
}
