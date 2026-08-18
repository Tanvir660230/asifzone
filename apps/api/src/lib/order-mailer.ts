import type { Order } from "@prisma/client";
import { sendMail } from "./mailer";
import { renderEmailLayout } from "./email-template";
import { escapeHtml } from "./html";
import { getSmsSettings } from "../modules/sms-settings/sms-settings.service";
import { env } from "../config/env";

function formatBdt(amount: number): string {
  return `৳${Math.round(amount).toLocaleString("en-BD")}`;
}

/** Fire-and-forget receipt email, fired from settlePaymentSession's success branch alongside the
 * existing "CONFIRMED" SMS — same spirit as lib/order-sms.ts's sendCustomerOrderSms. Skips silently
 * (no error) when there's no email on file or the admin has switched this off, since neither is a
 * failure — COD orders never reach this at all (settlePaymentSession is only ever called for online
 * payments), so there's no COD-specific check needed here. */
export function sendPaymentConfirmationEmail(order: Order): void {
  if (!order.customerEmail) return;

  void (async () => {
    const smsSettings = await getSmsSettings();
    if (!smsSettings.customerPaymentConfirmedEmailEnabled) return;

    const firstName = escapeHtml(order.customerName.split(" ")[0] ?? "");
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
          <td style="padding:8px 0;text-align:right;font-weight:600;">${formatBdt(Number(order.total))}</td>
        </tr>
      </table>
      <p style="margin:0;">You can track this order any time using the link below.</p>
    `;

    await sendMail({
      to: order.customerEmail!,
      subject: `Payment confirmed — Order ${order.orderNumber}`,
      html: renderEmailLayout({
        bodyHtml,
        ctaLabel: "View order",
        ctaUrl: `${env.webOrigin}/order-confirmation/${order.orderNumber}`,
      }),
    });
  })().catch((err) => console.error(`[order-mailer] payment confirmation email failed for ${order.orderNumber}:`, err));
}
