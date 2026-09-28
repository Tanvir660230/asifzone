import { META_CURRENCY, metaPurchaseEventId, type Order } from "@clothing-brand/shared";

/** The one module that talks to the Meta Pixel — components call the typed pixel* functions below
 * and never touch `fbq` directly. Server-side counterpart (Conversions API, Purchase only):
 * apps/api/src/lib/meta/. Anything both sides must agree on (currency, the Purchase event_id)
 * comes from @clothing-brand/shared's meta.ts.
 *
 * Content ids: the product VARIANT id for every cart/checkout/purchase event (the exact size/colour
 * bought — and the only id the order rows carry), the PRODUCT id with content_type "product_group"
 * for ViewContent, since a product page is viewed before any variant is picked. A future Meta
 * catalog feed should therefore use variant id as `id` and product id as `item_group_id`.
 *
 * Inert (every call a no-op) until NEXT_PUBLIC_META_PIXEL_ID is set at build time — only the
 * production build gets it, so dev/CI traffic never reaches the real pixel. */

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: Fbq;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export interface MetaLineItem {
  /** Variant id — see the content-id note above. */
  id: string;
  quantity: number;
  /** Unit price. */
  price: number;
}

/** Admin screens, the admin's draft-product previews and the product wizard's embedded preview
 * frame — never a shopper, so nothing there is ever reported (same exclusions PageViewTracker uses
 * for first-party analytics). */
export function isMetaExcludedPath(pathname: string): boolean {
  return pathname.startsWith("/admin") || pathname.startsWith("/preview");
}

let initialized = false;

/** Loads fbevents.js and runs `fbq('init')` exactly once per page load, however many times it's
 * called. Installs Meta's standard queueing stub first, so events tracked before the script finishes
 * downloading are buffered rather than lost. Returns whether the pixel is usable. */
function ensureInitialized(): boolean {
  if (!PIXEL_ID || typeof window === "undefined") return false;
  if (initialized) return true;
  initialized = true;

  if (!window.fbq) {
    const stub = function (...args: unknown[]) {
      if (stub.callMethod) stub.callMethod(...args);
      else stub.queue.push(args);
    } as Fbq;
    stub.push = stub;
    stub.loaded = true;
    stub.version = "2.0";
    stub.queue = [];
    window.fbq = stub;
    window._fbq ??= stub;

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }

  window.fbq!("init", PIXEL_ID);
  return true;
}

function track(event: string, params?: Record<string, unknown>, eventId?: string): void {
  if (isMetaExcludedPath(window.location.pathname) || !ensureInitialized()) return;
  if (eventId) window.fbq!("track", event, params ?? {}, { eventID: eventId });
  else if (params) window.fbq!("track", event, params);
  else window.fbq!("track", event);
}

// Same key within this window = the same moment firing twice (React Strict Mode's dev-only double
// effect run, a remount), not a second genuine view — a real revisit is always further apart.
const REPEAT_WINDOW_MS = 2000;
const lastFiredAt = new Map<string, number>();
function firedJustNow(key: string): boolean {
  const now = Date.now();
  const last = lastFiredAt.get(key);
  lastFiredAt.set(key, now);
  return last !== undefined && now - last < REPEAT_WINDOW_MS;
}

/** True the first time `key` is seen in this storage (and records it). Storage being unavailable
 * (private mode, blocked site data) fails open — the event still fires; Purchase stays protected
 * by its event_id either way. */
function firstTime(kind: "session" | "local", key: string): boolean {
  try {
    const storage = kind === "session" ? window.sessionStorage : window.localStorage;
    if (storage.getItem(key)) return false;
    storage.setItem(key, "1");
  } catch {
    // fall through
  }
  return true;
}

function cartParams(items: MetaLineItem[]) {
  return {
    content_type: "product",
    content_ids: [...new Set(items.map((i) => i.id))],
    contents: items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
    num_items: items.reduce((sum, i) => sum + i.quantity, 0),
    value: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    currency: META_CURRENCY,
  };
}

/** Stable per cart contents — "the same checkout" for the once-per-cart guards below. */
function cartSignature(items: MetaLineItem[]): string {
  return items
    .map((i) => `${i.id}x${i.quantity}`)
    .sort()
    .join(",");
}

/** Called by <MetaPixel /> on first load and every client-side route change. */
export function pixelPageView(pathname: string): void {
  if (firedJustNow(`PageView:${pathname}`)) return;
  track("PageView");
}

export function pixelViewContent(params: { productId: string; productName: string; price: number }): void {
  if (firedJustNow(`ViewContent:${params.productId}`)) return;
  track("ViewContent", {
    content_type: "product_group",
    content_ids: [params.productId],
    content_name: params.productName,
    value: params.price,
    currency: META_CURRENCY,
  });
}

export function pixelSearch(query: string): void {
  if (firedJustNow(`Search:${query}`)) return;
  track("Search", { search_string: query, content_type: "product" });
}

/** Call only with the quantity the cart actually gained — see useCartStore's addItem. */
export function pixelAddToCart(item: MetaLineItem, productName: string): void {
  track("AddToCart", { ...cartParams([item]), content_name: productName });
}

/** Once per distinct cart per tab session — a refresh or a coupon re-render of the same checkout
 * isn't a new checkout, but coming back with a different cart is. */
export function pixelInitiateCheckout(items: MetaLineItem[]): void {
  if (items.length === 0 || !firstTime("session", `meta:ic:${cartSignature(items)}`)) return;
  track("InitiateCheckout", cartParams(items));
}

/** The server accepted the checkout with a payment method attached (a COD order placed, or a
 * gateway payment session opened) — once per distinct cart per tab session, so a retried gateway
 * payment for the same cart isn't counted again. */
export function pixelAddPaymentInfo(items: MetaLineItem[], paymentMethod: string): void {
  if (items.length === 0 || !firstTime("session", `meta:api:${cartSignature(items)}`)) return;
  track("AddPaymentInfo", { ...cartParams(items), payment_type: paymentMethod });
}

// Meta only pairs a browser event with its server twin (same event_id) inside a 48h window — past
// that, a late browser copy would count as a second purchase. 24h keeps well clear of the edge;
// the server copy was sent at order creation regardless.
const PURCHASE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A real, completed purchase as the backend reports it: COD placed and not cancelled, or an online
 * payment the gateway confirmed. An unpaid/cancelled online attempt, or an old order looked up again
 * through the confirmation page, is not. */
export function isTrackablePurchase(order: Order): boolean {
  if (order.status === "CANCELLED") return false;
  if (order.paymentMethod !== "COD" && order.paymentStatus !== "PAID") return false;
  return Date.now() - new Date(order.createdAt).getTime() < PURCHASE_MAX_AGE_MS;
}

/** Browser half of the Purchase pair — the server sent the other half (Conversions API) when the
 * order was written, with the same event_id, so Meta keeps one. Also guarded per browser
 * (localStorage, not sessionStorage) so a refresh, a second tab or a later revisit doesn't re-fire. */
export function pixelPurchase(order: Order): void {
  if (!isTrackablePurchase(order) || !firstTime("local", `meta:purchase:${order.orderNumber}`)) return;
  const items = order.items.map((i) => ({ id: i.variantId, quantity: i.quantity, price: Number(i.priceSnapshot) }));
  track(
    "Purchase",
    { ...cartParams(items), value: Number(order.total), order_id: order.orderNumber },
    metaPurchaseEventId(order.orderNumber),
  );
}

/** Email sign-up only — Google and phone-OTP sign-in create an account on first use but just log an
 * existing one in after that, and the client can't tell which happened. */
export function pixelCompleteRegistration(): void {
  track("CompleteRegistration", { registration_method: "email", status: true });
}

export function pixelContact(channel: "form" | "whatsapp" | "call"): void {
  track("Contact", { contact_channel: channel });
}
