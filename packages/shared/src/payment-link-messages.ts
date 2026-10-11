import { formatMoney } from "./format";

/** The customer message that carries a payment link (docs/ORDER_ADJUSTMENTS.md §11.6) — one wording for every channel,
 * so SMS and email never drift. Only what the customer needs: order reference, amount due, the link, its expiry. */
export interface PaymentLinkMessageVars {
  storeName: string;
  customerName: string;
  orderNumber: string;
  amount: number;
  currency: string;
  url: string;
  /** Already formatted in the store's timezone. */
  expiresAt: string;
}

export function renderPaymentLinkSms(v: PaymentLinkMessageVars): string {
  return `${v.storeName}: Please pay ${formatMoney(v.amount, v.currency)} for order ${v.orderNumber} here: ${v.url} (valid until ${v.expiresAt})`;
}

export function paymentLinkEmailSubject(v: PaymentLinkMessageVars): string {
  return `Payment request for order ${v.orderNumber}`;
}

/** Plain lines; the API wraps them in its email layout (escaping every value). */
export function paymentLinkEmailLines(v: PaymentLinkMessageVars): string[] {
  const first = v.customerName.split(" ")[0] ?? "";
  return [
    `Hi ${first},`,
    `${formatMoney(v.amount, v.currency)} is due on your order ${v.orderNumber}. You can pay it securely online using the button below.`,
    `This link is valid until ${v.expiresAt}.`,
  ];
}
