import twilio from "twilio";
import { env } from "../config/env";

interface SmsInput {
  to: string;
  body: string;
}

const client =
  env.twilio.accountSid && env.twilio.authToken
    ? twilio(env.twilio.accountSid, env.twilio.authToken)
    : null;

// No TWILIO_* credentials configured yet: log instead of sending, same fallback spirit as
// lib/mailer.ts, so local dev/CI never needs a real Twilio account.
export async function sendSms({ to, body }: SmsInput): Promise<void> {
  if (!client) {
    console.log(`[sms] (dev mode, not actually sent) To: ${to} | Body: ${body}`);
    return;
  }

  await client.messages.create({ to, body, from: env.twilio.fromNumber });
}
