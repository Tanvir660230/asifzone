import { env } from "../config/env";

interface SmsInput {
  to: string;
  body: string;
}

const BULKSMSBD_ENDPOINT = "https://bulksmsbd.net/api/smsapi";

// BulkSMSBD expects the international "8801XXXXXXXXX" form; phones are stored/validated locally
// as "01XXXXXXXXX" (see PHONE_REGEX in packages/shared/src/schemas/customer.ts).
function toBulkSmsBdNumber(phone: string): string {
  return phone.startsWith("880") ? phone : `88${phone}`;
}

// No BULKSMSBD_API_KEY configured yet: log instead of sending, same fallback spirit as
// lib/mailer.ts, so local dev/CI never needs a real account.
export async function sendSms({ to, body }: SmsInput): Promise<void> {
  if (!env.bulkSmsBd.apiKey) {
    console.log(`[sms] (dev mode, not actually sent) To: ${to} | Body: ${body}`);
    return;
  }

  const params = new URLSearchParams({
    api_key: env.bulkSmsBd.apiKey,
    type: "text",
    number: toBulkSmsBdNumber(to),
    senderid: env.bulkSmsBd.senderId,
    message: body,
  });

  const res = await fetch(`${BULKSMSBD_ENDPOINT}?${params.toString()}`);
  const data = (await res.json().catch(() => null)) as { response_code?: number } | null;

  // BulkSMSBD responds HTTP 200 even on failure — the real status is response_code (202 = accepted).
  if (!res.ok || !data || data.response_code !== 202) {
    throw new Error(`[sms] BulkSMSBD send failed: ${data ? JSON.stringify(data) : res.status}`);
  }
}
