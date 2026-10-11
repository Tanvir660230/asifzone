import { env } from "../../config/env";
import { liveProvidersEnabled } from "../../lib/provider-guard";
import type { MetaServerEvent } from "../../lib/meta/capi";
import { MetaApiError } from "../errors";

/** Meta Conversions API — the provider half (moved verbatim from lib/meta/capi.ts in Phase 12 W2): the config gate and
 * the one HTTP call to the Graph API. Reached only through providers/registry.ts. */

const REQUEST_TIMEOUT_MS = 8000;

/** Configured AND allowed to send from this environment — see env.meta for why non-production
 * additionally requires a test event code. */
export function isMetaCapiEnabled(): boolean {
  const { pixelId, accessToken, testEventCode } = env.meta;
  if (!pixelId || !accessToken || !liveProvidersEnabled()) return false;
  return env.nodeEnv === "production" || Boolean(testEventCode);
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
