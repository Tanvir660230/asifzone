/** WhatsApp deep links. The store's number lives in its WHATSAPP social link (wa.me/… or api.whatsapp.com/send?phone=…);
 * both formats accept a `text` parameter, so a prefilled message works whichever style the link was pasted in as. */

/** Sets (or replaces) the prefilled message on a WhatsApp link. An unparseable link is returned unchanged. */
export function withWhatsAppMessage(url: string, message: string | null): string {
  if (!message) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("text", message);
    return parsed.toString();
  } catch {
    return url;
  }
}

export interface WhatsAppOrderLine {
  productName: string;
  /** The chosen options, each with its label ("Size", "Colour"); unchosen ones are left out. */
  options: { label: string; value: string }[];
  quantity: number;
  /** The product page, so the store sees exactly which item is meant. */
  url: string;
}

/** The message a shopper sends to order one product over WhatsApp: the item, the options they picked, how many, and the
 * page link. Plain lines, no prices: the store confirms the price and delivery fee in the chat, so a stale page can never
 * promise an amount. */
export function productOrderMessage({ productName, options, quantity, url }: WhatsAppOrderLine): string {
  const lines = ["Hi, I'd like to order:", productName];
  for (const { label, value } of options) lines.push(`${label}: ${value}`);
  lines.push(`Quantity: ${Math.max(1, Math.floor(quantity))}`, url);
  return lines.join("\n");
}
