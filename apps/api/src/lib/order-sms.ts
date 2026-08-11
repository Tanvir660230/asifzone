import type { Order } from "@prisma/client";
import { DEFAULT_CUSTOMER_SMS_TEMPLATES, renderOrderSms, type CustomerSmsTouchpoint } from "@clothing-brand/shared";
import { sendSms } from "./sms";
import * as smsTemplates from "./sms-templates";
import { getSmsSettings } from "../modules/sms-settings/sms-settings.service";
import { getSettings } from "../modules/settings/settings.service";

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

/** Fire-and-forget — never awaited by the caller in a way that could block or throw into the order
 * flow, same spirit as lib/notify.ts. */
export function sendCustomerOrderSms(order: Order, touchpoint: CustomerTouchpoint): void {
  void (async () => {
    const [smsSettings, storeSettings] = await Promise.all([getSmsSettings(), getSettings()]);
    if (!smsSettings[TOGGLE_KEY[touchpoint]]) return;

    const customTemplate = smsSettings[TEMPLATE_KEY[touchpoint]] as string | null;
    const template = customTemplate?.trim() ? customTemplate : DEFAULT_CUSTOMER_SMS_TEMPLATES[touchpoint];
    const body = renderOrderSms(template, {
      orderNumber: order.orderNumber,
      total: Number(order.total),
      storeName: storeSettings.storeName,
      customerName: order.customerName,
    });
    await sendSms({ to: order.customerPhone, body });
  })().catch((err) => console.error(`[order-sms] customer ${touchpoint} sms failed for ${order.orderNumber}:`, err));
}

/** Fire-and-forget alert to every configured admin phone, independently — one bad number must not
 * stop the others from receiving it. */
export function sendAdminOrderAlertSms(order: Order): void {
  void (async () => {
    const smsSettings = await getSmsSettings();
    if (!smsSettings.adminOrderAlertEnabled) return;

    const phones = smsSettings.adminAlertPhones
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!phones.length) return;

    const body = smsTemplates.newOrderAdminAlertSms({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      total: Number(order.total),
    });
    await Promise.all(
      phones.map((to) => sendSms({ to, body }).catch((err) => console.error(`[order-sms] admin alert to ${to} failed:`, err))),
    );
  })().catch((err) => console.error(`[order-sms] admin alert failed for ${order.orderNumber}:`, err));
}
