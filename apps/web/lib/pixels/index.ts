import { metaPurchaseEventId, type Order } from "@clothing-brand/shared";
import { getStoreConfig } from "../store-config";
import { clarityConfigured } from "./clarity";
import { hasAdTrackingConsent } from "./consent";
import { pixelDebug } from "./debug";
import { cartSignature, firedJustNow, firstTime, newEventId } from "./guards";
import { metaPixel } from "./meta";
import { tiktokPixel } from "./tiktok";
import type { ContactChannel, PixelEvent, PixelEventContext, PixelLineItem, PixelProvider } from "./types";

/** The storefront's one ad-tracking layer. Components call the typed pixel* functions below — never `fbq`/`ttq` — and
 * every business event fans out to each configured platform (Meta, TikTok) with ONE decision about whether it fires and
 * ONE shared event id. Adding a platform = a provider file + an entry in PROVIDERS; consent = consent.ts (the shopper's
 * stored choice from the consent banner); a
 * server-side sender = reuse the event id (Purchase: purchaseEventId).
 *
 * Tracking is strictly best-effort: every call is synchronous, never throws and never awaits, so a blocked script, an
 * ad blocker or a provider bug can't break add-to-cart, checkout or the confirmation page. */

export type { PixelLineItem, ContactChannel } from "./types";

const PROVIDERS: PixelProvider[] = [metaPixel, tiktokPixel];

/** Whether this build has any third-party tracker at all (an ad pixel id or Clarity) — when none is configured there is
 * nothing to consent to, so the consent banner and its footer link stay hidden. */
export const trackingConfigured = PROVIDERS.some((p) => p.enabled) || clarityConfigured;

/** Admin screens, the admin's draft-product previews and the product wizard's embedded preview frame — never a shopper,
 * so nothing there is ever reported (same exclusions PageViewTracker uses for first-party analytics). */
export function isPixelExcludedPath(pathname: string): boolean {
  return pathname.startsWith("/admin") || pathname.startsWith("/preview");
}

/** The Purchase event id every platform and both sides (browser pixel, server-side API) must share — deterministic per
 * order, so each side derives it independently and every retry collapses into one event. Meta's Conversions API
 * (apps/api/src/lib/meta/) already sends it; a TikTok Events API sender must too. */
export function purchaseEventId(orderNumber: string): string {
  return metaPurchaseEventId(orderNumber);
}

interface EmitOptions {
  eventId?: string;
  /** Suppress an identical call within a couple of seconds (Strict Mode double effects, remounts). */
  burstKey?: string;
  /** Fire at most once per key in this storage (sessionStorage: per tab session; localStorage: per browser). */
  once?: { storage: "session" | "local"; key: string };
}

function emit(event: PixelEvent, options: EmitOptions = {}): void {
  try {
    if (typeof window === "undefined") return;
    // Gates first, so a skipped event never consumes its once-guard.
    if (isPixelExcludedPath(window.location.pathname)) return;
    if (!hasAdTrackingConsent()) {
      pixelDebug(`${event.name} skipped — no ad-tracking consent`);
      return;
    }
    if (options.burstKey && firedJustNow(options.burstKey)) {
      pixelDebug(`${event.name} suppressed — repeat within the burst window`, options.burstKey);
      return;
    }
    if (options.once && !firstTime(options.once.storage, `pixels:${options.once.key}`)) {
      pixelDebug(`${event.name} suppressed — already sent`, options.once.key);
      return;
    }

    const ctx: PixelEventContext = {
      eventId: options.eventId ?? newEventId(),
      get currency() {
        return getStoreConfig().currency;
      },
    };
    const enabled = PROVIDERS.filter((p) => p.enabled);
    pixelDebug(`${event.name} → ${enabled.map((p) => p.name).join(", ") || "(no pixel ids configured)"}`, { ...event, eventId: ctx.eventId });
    for (const provider of enabled) {
      try {
        provider.send(event, ctx);
      } catch (err) {
        pixelDebug(`${provider.name} failed to send ${event.name}`, err);
      }
    }
  } catch (err) {
    pixelDebug(`${event.name} dropped`, err);
  }
}

/** Called by <AdPixels /> on first load and every client-side route change. */
export function pixelPageView(pathname: string): void {
  emit({ name: "PageView" }, { burstKey: `PageView:${pathname}` });
}

export function pixelViewContent(product: { productId: string; productName: string; price: number }): void {
  emit(
    { name: "ViewContent", product: { id: product.productId, name: product.productName, price: product.price } },
    { burstKey: `ViewContent:${product.productId}` },
  );
}

export function pixelSearch(query: string): void {
  emit({ name: "Search", query }, { burstKey: `Search:${query}` });
}

/** Call only with the quantity the cart actually gained — see useCartStore's addItem. */
export function pixelAddToCart(item: PixelLineItem): void {
  if (item.quantity <= 0) return;
  emit({ name: "AddToCart", item });
}

/** Once per distinct cart per tab session — a refresh or a coupon re-render of the same checkout isn't a new checkout,
 * but coming back with a different cart is. */
export function pixelInitiateCheckout(items: PixelLineItem[]): void {
  if (items.length === 0) return;
  emit({ name: "InitiateCheckout", items }, { once: { storage: "session", key: `ic:${cartSignature(items)}` } });
}

/** The server accepted the checkout with a payment method attached (a COD order placed, or a gateway payment session
 * opened) — once per distinct cart per tab session, so a retried gateway payment for the same cart isn't counted again.
 * `paymentMethod` is the method code (COD / SSLCOMMERZ / EPS_PG) only; no payment details ever reach this layer. */
export function pixelAddPaymentInfo(items: PixelLineItem[], paymentMethod: string): void {
  if (items.length === 0) return;
  emit({ name: "AddPaymentInfo", items, paymentMethod }, { once: { storage: "session", key: `api:${cartSignature(items)}` } });
}

// Meta and TikTok only pair a browser event with its server twin (same event_id) inside a 48h window — past that, a
// late browser copy would count as a second purchase. 24h keeps well clear of the edge; the server copy (Meta) was sent
// at order creation regardless.
const PURCHASE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A real, completed purchase as the backend reports it: COD placed and not cancelled, or an online payment the
 * gateway confirmed. An unpaid/cancelled online attempt, or an old order looked up again through the confirmation page,
 * is not. */
export function isTrackablePurchase(order: Order): boolean {
  if (order.status === "CANCELLED") return false;
  if (order.paymentMethod !== "COD" && order.paymentStatus !== "PAID") return false;
  return Date.now() - new Date(order.createdAt).getTime() < PURCHASE_MAX_AGE_MS;
}

/** Browser half of the Purchase pair, from the order exactly as the backend returned it. Fires once per order per
 * browser (localStorage — a refresh, back button, second tab or later revisit doesn't re-fire) and carries the
 * deterministic purchaseEventId, so even a copy that slips past that (cleared storage, another device) is deduplicated
 * by each platform against the first. */
export function pixelPurchase(order: Order): void {
  if (!isTrackablePurchase(order)) return;
  const items = order.items.map((i) => ({
    id: i.variantId,
    name: i.productNameSnapshot,
    quantity: i.quantity,
    price: Number(i.priceSnapshot),
  }));
  emit(
    { name: "Purchase", orderId: order.orderNumber, items, value: Number(order.total) },
    { eventId: purchaseEventId(order.orderNumber), once: { storage: "local", key: `purchase:${order.orderNumber}` } },
  );
}

/** Email sign-up only — Google and phone-OTP sign-in create an account on first use but just log an existing one in
 * after that, and the client can't tell which happened. */
export function pixelCompleteRegistration(): void {
  emit({ name: "CompleteRegistration", method: "email" });
}

export function pixelContact(channel: ContactChannel): void {
  emit({ name: "Contact", channel });
}
