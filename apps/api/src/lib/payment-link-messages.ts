import { paymentLinkEmailLines, paymentLinkEmailSubject, renderPaymentLinkSms } from "@clothing-brand/shared";
import { renderEmailLayout } from "./email-template";
import { escapeHtml } from "./html";
import { paymentLinkMessageFacts } from "../modules/payments/payment-link.service";
import { getProviders } from "../providers/registry";

/** Delivers one payment-link message (outbox consumer `customer-payment-link`). The wording is the shared template
 * (packages/shared/src/payment-link-messages.ts) — one text for every channel. "skipped" when the link is no longer ACTIVE
 * or the customer has no address for the channel; throws on a provider failure so the outbox retries. */
export async function deliverPaymentLinkMessage(paymentLinkId: string, channel: "SMS" | "EMAIL", eventId: string): Promise<"sent" | "skipped"> {
  const facts = await paymentLinkMessageFacts(paymentLinkId);
  if (!facts) return "skipped";
  if (channel === "SMS") {
    if (!facts.phone) return "skipped";
    await getProviders().sms.send({ to: facts.phone, body: renderPaymentLinkSms(facts.vars) });
    return "sent";
  }
  if (!facts.email) return "skipped";
  const bodyHtml = paymentLinkEmailLines(facts.vars)
    .map((line) => `<p style="margin:0 0 16px;">${escapeHtml(line)}</p>`)
    .join("");
  await getProviders().email.send({
    to: facts.email,
    subject: paymentLinkEmailSubject(facts.vars),
    html: await renderEmailLayout({ bodyHtml, ctaLabel: "Pay now", ctaUrl: facts.vars.url }),
    idempotencyKey: eventId,
  });
  return "sent";
}
