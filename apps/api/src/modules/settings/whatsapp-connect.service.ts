import { randomInt } from "node:crypto";
import type { WhatsAppConnectInput } from "@clothing-brand/shared";
import { AppError } from "../../lib/app-error";
import { captureError } from "../../lib/observability/error-capture";
import { getProviders } from "../../providers/registry";
import { MetaApiError } from "../../providers/errors";
import { updateIntegrations } from "./integrations.service";

/**
 * Settings › Integrations › Connect WhatsApp: finishes Meta's Embedded Signup on the server (Meta: "perform all of the
 * requests using server-to-server requests"). The browser only relays the one-time code and the account ids.
 *
 * - Current number (coexistence, owner 2026-10-17): it stays on the WhatsApp Business app; it is already registered, so
 *   instead the app's contacts and then chat history are synced — each once, within 24 hours (Meta refuses a repeat,
 *   so a failure there is reported, not retried, and doesn't undo the connection).
 * - A new number is registered with a fresh 6-digit two-step PIN, saved with the other values.
 * Nothing is saved until the token, the number and the webhook subscription all worked.
 */
export async function connectWhatsApp(input: WhatsAppConnectInput, adminId: string | null) {
  const signup = getProviders().social.whatsAppSignup;
  let token: string;
  try {
    token = await signup.exchangeCode(input.code);
  } catch (err) {
    throw toBadRequest(err, "Meta didn't accept the sign-up (the code is valid for 30 seconds) — press Connect WhatsApp again.");
  }

  let phoneNumberId = input.phoneNumberId;
  let phoneNumber: string | null = null;
  try {
    const numbers = await signup.phoneNumbers(input.wabaId, token);
    const match = phoneNumberId ? numbers.find((n) => n.id === phoneNumberId) : numbers[0];
    phoneNumberId ??= match?.id;
    phoneNumber = match?.display ?? null;
  } catch (err) {
    if (!phoneNumberId) throw toBadRequest(err, "Couldn't read the WhatsApp number from Meta — try again.");
  }
  if (!phoneNumberId) throw AppError.badRequest("This WhatsApp Business account has no phone number yet — finish adding it in Meta's sign-up, then connect again.");

  try {
    await signup.subscribe(input.wabaId, token);
  } catch (err) {
    throw toBadRequest(err, "Couldn't subscribe the store to this WhatsApp account's messages — try again.");
  }

  const warnings: string[] = [];
  let pin: string | null = null;
  if (input.coexistence) {
    for (const [syncType, what] of [
      ["smb_app_state_sync", "contacts"],
      ["history", "chat history"],
    ] as const) {
      try {
        await signup.syncBusinessApp(phoneNumberId, token, syncType);
      } catch (err) {
        captureError(err, { msg: `[whatsapp-connect] ${syncType} sync failed:` });
        warnings.push(`WhatsApp didn't sync the app's ${what}: ${err instanceof Error ? err.message : "unknown error"}. New messages still arrive.`);
      }
    }
  } else {
    pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      await signup.register(phoneNumberId, token, pin);
    } catch (err) {
      throw toBadRequest(err, "Meta couldn't register the number — check it in WhatsApp Manager, then connect again.");
    }
  }

  await updateIntegrations(
    {
      values: {
        WHATSAPP_PHONE_NUMBER_ID: phoneNumberId,
        WHATSAPP_ACCESS_TOKEN: token,
        WHATSAPP_WABA_ID: input.wabaId,
        ...(pin ? { WHATSAPP_PIN: pin } : {}),
      },
    },
    adminId,
  );
  return { phoneNumber, warnings };
}

function toBadRequest(err: unknown, fallback: string): AppError {
  if (err instanceof AppError) return err;
  captureError(err, { msg: "[whatsapp-connect]" });
  return AppError.badRequest(err instanceof MetaApiError ? `${fallback} (Meta: ${err.message})` : fallback, { code: "WHATSAPP_CONNECT_FAILED" });
}
