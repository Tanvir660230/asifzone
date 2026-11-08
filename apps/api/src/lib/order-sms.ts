import type { Order } from "@prisma/client";
import { DEFAULT_CUSTOMER_SMS_TEMPLATES, renderOrderSms, type CustomerSmsTouchpoint } from "@clothing-brand/shared";
import * as smsTemplates from "./sms-templates";
import { getSmsSettings } from "../modules/sms-settings/sms-settings.service";
import { getSettings } from "../modules/settings/settings.service";
import { captureError } from "./observability/error-capture";
import { getProviders } from "../providers/registry";
import { env } from "../config/env";
import { selfConfirmCode } from "../modules/orders/self-confirm-code";

export type CustomerTouchpoint = CustomerSmsTouchpoint;
type SmsSettings = Awaited<ReturnType<typeof getSmsSettings>>;

const TOGGLE_KEY: Record<CustomerTouchpoint, keyof SmsSettings> = {
  PLACED: "customerOrderPlacedEnabled",
  CONFIRMED: "customerOrderConfirmedEnabled",
  SHIPPED: "customerOrderShippedEnabled",
  DELIVERED: "customerOrderDeliveredEnabled",
  CANCELLED: "customerOrderCancelledEnabled",
};

// Blank/null in this column means "no custom template saved" — fall back to the shared default.
const TEMPLATE_KEY: Record<CustomerTouchpoint, keyof SmsSettings> = {
  PLACED: "customerOrderPlacedTemplate",
  CONFIRMED: "customerOrderConfirmedTemplate",
  SHIPPED: "customerOrderShippedTemplate",
  DELIVERED: "customerOrderDeliveredTemplate",
  CANCELLED: "customerOrderCancelledTemplate",
};

type OrderSmsFacts = Pick<Order, "orderNumber" | "total" | "customerName" | "customerPhone"> & Partial<Pick<Order, "status" | "paymentMethod">>;

/** One customer order SMS — awaited by its outbox consumer (Phase 8), which retries a transient failure. The admin's toggle
 * and template are read at send time. Throws on failure (SmsProviderError carries whether a retry can help). */
export async function deliverCustomerOrderSms(order: OrderSmsFacts, touchpoint: CustomerTouchpoint): Promise<"sent" | "disabled"> {
  const [smsSettings, storeSettings] = await Promise.all([getSmsSettings(), getSettings()]);
  if (!smsSettings[TOGGLE_KEY[touchpoint]]) return "disabled";

  const customTemplate = smsSettings[TEMPLATE_KEY[touchpoint]] as string | null;
  const template = customTemplate?.trim() ? customTemplate : DEFAULT_CUSTOMER_SMS_TEMPLATES[touchpoint];
  // The customer confirms their own order from this link (modules/orders/self-confirm.ts): only on the order-placed SMS of
  // a pending cash-on-delivery order, and only when the store switched it on. A template without {confirmLink} still gets
  // it, at the end, so an owner's own wording keeps working.
  const confirmLink =
    touchpoint === "PLACED" && smsSettings.customerSelfConfirmEnabled && order.status === "PENDING" && order.paymentMethod === "COD"
      ? `${env.webOrigin.replace(/\/$/, "")}/c/${selfConfirmCode(order.orderNumber)}`
      : undefined;
  let body = renderOrderSms(template, {
    orderNumber: order.orderNumber,
    total: Number(order.total),
    storeName: storeSettings.storeName,
    customerName: order.customerName,
    confirmLink,
  });
  if (confirmLink && !template.includes("{confirmLink}")) body = `${body} নিশ্চিত করুন: ${confirmLink}`;
  await getProviders().sms.send({ to: order.customerPhone, body });
  return "sent";
}

/** The new-order alert to every configured admin phone, independently — one bad number must not stop the others. Throws
 * (so the outbox retries) only when EVERY phone failed transiently; a partial failure is logged, never retried, because a
 * retry would re-alert the phones that already received it. */
export async function deliverAdminOrderAlertSms(order: OrderSmsFacts): Promise<"sent" | "disabled"> {
  const smsSettings = await getSmsSettings();
  if (!smsSettings.adminOrderAlertEnabled) return "disabled";

  const phones = smsSettings.adminAlertPhones
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!phones.length) return "disabled";

  const body = smsTemplates.newOrderAdminAlertSms({
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    total: Number(order.total),
  });
  const results = await Promise.allSettled(phones.map((to) => getProviders().sms.send({ to, body })));
  const failures = results.flatMap((r, i) => (r.status === "rejected" ? [{ to: phones[i]!, err: r.reason as unknown }] : []));
  for (const f of failures) captureError(f.err, { msg: `[order-sms] admin alert to ${f.to} failed:` });
  if (failures.length === phones.length) throw failures[0]!.err;
  return "sent";
}
