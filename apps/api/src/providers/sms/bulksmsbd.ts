import { toBdInternationalDigits } from "@clothing-brand/shared";
import { env } from "../../config/env";
import { liveProvidersEnabled } from "../../lib/provider-guard";
import { logger, maskText } from "../../lib/observability/logger";
import { SmsProviderError } from "../errors";

export interface SmsInput {
  to: string;
  body: string;
}


const BULKSMSBD_ENDPOINT = "https://bulksmsbd.net/api/smsapi";
/** Well inside the outbox worker's 5-min lease (Phase 9 D-5): a hung provider call can never outlive the lease and be
 * delivered a second time while still in flight. A timeout is a plain (retryable) error. */
export const SMS_TIMEOUT_MS = 20_000;

// BulkSMSBD expects the international "8801XXXXXXXXX" form. Phones are validated/normalized to
// local "01XXXXXXXXX" at every input (see bdPhoneSchema in packages/shared/src/schemas/common.ts),
// but normalization runs again here (toBdInternationalDigits) as a defense against rows written before that validation
// existed — otherwise a stray "+880..."/"00880..." value stored back then would silently fail to
// send forever, since BulkSMSBD returns HTTP 200 even on a rejected number.
function toBulkSmsBdNumber(phone: string): string {
  return toBdInternationalDigits(phone);
}

// No BULKSMSBD_API_KEY configured yet: log instead of sending, same fallback spirit as
// providers/email/resend.ts, so local dev/CI never needs a real account.
export async function sendSms({ to, body }: SmsInput): Promise<void> {
  if (!env.bulkSmsBd.apiKey || !liveProvidersEnabled()) {
    logger.info("[sms] (dev mode, not actually sent)", { to, bodyLength: body.length });
    return;
  }

  const params = new URLSearchParams({
    api_key: env.bulkSmsBd.apiKey,
    type: "text",
    number: toBulkSmsBdNumber(to),
    senderid: env.bulkSmsBd.senderId,
    message: body,
  });

  // BulkSMSBD's API takes the key in the query string (provider-imposed). The URL is never logged, and a transport failure
  // (network/timeout) is rethrown with a masked message so neither logs nor the outbox's lastError can carry the key
  // (Phase 12 W7). Still retryable, exactly as before.
  let res: Response;
  try {
    res = await fetch(`${BULKSMSBD_ENDPOINT}?${params.toString()}`, { signal: AbortSignal.timeout(SMS_TIMEOUT_MS) });
  } catch (err) {
    throw new SmsProviderError(`[sms] BulkSMSBD request failed: ${maskText(err instanceof Error ? err.message : String(err))}`, true);
  }
  if (!res.ok) throw new SmsProviderError(`[sms] BulkSMSBD HTTP ${res.status}`, res.status >= 500 || res.status === 429);
  const data = (await res.json().catch(() => null)) as { response_code?: number } | null;

  // BulkSMSBD responds HTTP 200 even on failure — the real status is response_code (202 = accepted). An unreadable body is
  // treated as transient; any other response code is the provider rejecting this message.
  if (!data) throw new SmsProviderError("[sms] BulkSMSBD returned an unreadable response", true);
  if (data.response_code !== 202) throw new SmsProviderError(`[sms] BulkSMSBD rejected the message: ${JSON.stringify(data)}`, false);
}
