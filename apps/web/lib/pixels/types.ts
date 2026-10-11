/** Platform-neutral ad-pixel events — what the storefront reports, described once in its own terms. Each provider
 * (./meta.ts, ./tiktok.ts) translates these into its platform's event names and parameters; nothing outside lib/pixels/
 * ever builds a platform payload.
 *
 * Line-item ids follow the convention documented in ./meta.ts: the product VARIANT id for every cart/checkout/purchase
 * event, the PRODUCT id (content_type "product_group") for ViewContent. A future catalog feed for any platform should use
 * variant id as the item id and product id as the group id. */

export interface PixelLineItem {
  /** Variant id. */
  id: string;
  name: string;
  quantity: number;
  /** Unit price — a marketing signal from the cart's display price, never a charged amount. */
  price: number;
}

export type ContactChannel = "form" | "whatsapp" | "call";

export type PixelEvent =
  | { name: "PageView" }
  | { name: "ViewContent"; product: { id: string; name: string; price: number } }
  | { name: "Search"; query: string }
  | { name: "AddToCart"; item: PixelLineItem }
  | { name: "InitiateCheckout"; items: PixelLineItem[] }
  | { name: "AddPaymentInfo"; items: PixelLineItem[]; paymentMethod: string }
  | { name: "Purchase"; orderId: string; items: PixelLineItem[]; value: number }
  | { name: "CompleteRegistration"; method: "email" }
  | { name: "Contact"; channel: ContactChannel };

export type PixelEventName = PixelEvent["name"];

export interface PixelEventContext {
  /** Shared by every provider for this one business event — the key each platform deduplicates a browser event against
   * its server-side twin with (Meta `eventID`, TikTok `event_id`). Deterministic for Purchase (see purchaseEventId). */
  eventId: string;
  /** The store currency (store settings, via lib/store-config.ts). A getter: read only by events that carry money. */
  readonly currency: string;
}

/** One ad platform. `send` must be a cheap no-op when the platform isn't configured (no pixel id at build time). */
export interface PixelProvider {
  name: string;
  enabled: boolean;
  send(event: PixelEvent, ctx: PixelEventContext): void;
}
