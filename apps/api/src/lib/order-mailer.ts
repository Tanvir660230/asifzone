import type { Order } from "@prisma/client";
import { renderEmailLayout } from "./email-template";
import { escapeHtml } from "./html";
import { getSmsSettings } from "../modules/sms-settings/sms-settings.service";
import { env } from "../config/env";
import { formatMoney } from "@clothing-brand/shared";
import { getCurrency } from "../domain/config/commerce-settings";
import { getProviders } from "../providers/registry";


/** The payment receipt email — awaited by its outbox consumer (Phase 8). `idempotencyKey` (the outbox event id) makes a
 * repeat delivery a no-op at the provider. Skips (no error) when there's no email on file or the admin switched it off. */
export async function deliverPaymentConfirmationEmail(
  order: Pick<Order, "orderNumber" | "total" | "customerName" | "customerEmail">,
  idempotencyKey: string,
): Promise<"sent" | "disabled"> {
  if (!order.customerEmail) return "disabled";
  const smsSettings = await getSmsSettings();
  if (!smsSettings.customerPaymentConfirmedEmailEnabled) return "disabled";

  const firstName = escapeHtml(order.customerName.split(" ")[0] ?? "");
  const currency = await getCurrency();
  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi ${firstName},</p>
    <p style="margin:0 0 16px;">We've received your payment for order <strong>${order.orderNumber}</strong>.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 0;color:#666666;">Order number</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;">${order.orderNumber}</td>
      </tr>
      <tr style="border-top:1px solid #ececec;">
        <td style="padding:8px 0;color:#666666;">Amount paid</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;">${formatMoney(Number(order.total), currency)}</td>
      </tr>
    </table>
    <p style="margin:0;">You can track this order any time using the link below.</p>
  `;

  await getProviders().email.send({
    to: order.customerEmail,
    subject: `Payment confirmed — Order ${order.orderNumber}`,
    html: await renderEmailLayout({
      bodyHtml,
      ctaLabel: "View order",
      ctaUrl: `${env.webOrigin}/order-confirmation/${order.orderNumber}`,
    }),
    idempotencyKey,
  });
  return "sent";
}
