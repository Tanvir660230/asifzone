import { env } from "../../config/env";
import { liveProvidersEnabled } from "../../lib/provider-guard";
import { TikTokApiError } from "../errors";

/** TikTok Events API (v1.3, "Events API 2.0") — the provider half: the config gate and the one HTTP call. Reached only
 * through providers/registry.ts. The browser pixel (apps/web lib/pixels/tiktok.ts) sends the same Purchase with the same
 * event_id; TikTok keeps one per pixel + event + event_id within 48 hours. */

const ENDPOINT = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
const REQUEST_TIMEOUT_MS = 8000;
/** TikTok's "too many requests" business code — the only non-zero code worth retrying. */
const RATE_LIMIT_CODE = 40100;

export interface TikTokServerEvent {
  event: "Purchase";
  /** Unix seconds. */
  event_time: number;
  event_id: string;
  user: {
    /** SHA-256 of the trimmed lowercase email. */
    email?: string;
    /** SHA-256 of the E.164 phone (+8801…). */
    phone?: string;
    /** SHA-256 of our customer id. */
    external_id?: string;
    ip?: string;
    user_agent?: string;
    /** The pixel's own first-party cookie (_ttp), unhashed. */
    ttp?: string;
    /** TikTok's click id from the ad link, unhashed. */
    ttclid?: string;
  };
  page: { url: string };
  properties: {
    currency: string;
    value: number;
    order_id: string;
    content_type: "product";
    contents: Array<{ content_id: string; quantity: number; price: number }>;
  };
}

/** Configured AND allowed to send from this environment (same rule as Meta: non-production needs a test event code). */
export function isTikTokEventsEnabled(): boolean {
  const { pixelId, accessToken, testEventCode } = env.tiktok;
  if (!pixelId || !accessToken || !liveProvidersEnabled()) return false;
  return env.nodeEnv === "production" || Boolean(testEventCode);
}

interface TikTokReply {
  code?: number;
  message?: string;
  request_id?: string;
}

/** POSTs one event. Errors carry TikTok's code / message / request_id only — never the payload. */
export async function sendTikTokEvent(event: TikTokServerEvent): Promise<void> {
  const { pixelId, accessToken, testEventCode } = env.tiktok;
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Access-Token": accessToken },
      body: JSON.stringify({
        event_source: "web",
        event_source_id: pixelId,
        data: [event],
        ...(testEventCode ? { test_event_code: testEventCode } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new TikTokApiError(`request failed: ${err instanceof Error ? err.message : String(err)}`, true);
  }

  const body = (await res.json().catch(() => ({}))) as TikTokReply;
  if (res.ok && body.code === 0) return;
  const retryable = res.status >= 500 || res.status === 429 || body.code === RATE_LIMIT_CODE;
  throw new TikTokApiError(`HTTP ${res.status} code=${body.code ?? "?"} "${body.message ?? "unknown error"}" request_id=${body.request_id ?? "-"}`, retryable);
}
