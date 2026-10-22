import { metaMatchKeys, type MetaMatchKeys } from "@clothing-brand/shared";
import type { PixelCustomer, PixelEvent, PixelEventContext, PixelLineItem, PixelProvider } from "./types";
import { apiBaseUrl, publicRuntimeConfig } from "../runtime-config";

/** The one module that talks to the Meta Pixel — it only translates the neutral events lib/pixels/index.ts dispatches
 * into `fbq` calls; when an event fires (and whether it's a repeat) is decided there, once, for every platform.
 * Server-side counterpart (Conversions API): apps/api/src/lib/meta/ — Purchase from the stored order, every other event
 * as the server copy sendServerCopy posts. Anything both sides must agree on
 * (currency, the Purchase event_id) comes from @clothing-brand/shared's meta.ts.
 *
 * Content ids: the product VARIANT id for every cart/checkout/purchase event (the exact size/colour bought — and the
 * only id the order rows carry), the PRODUCT id with content_type "product_group" for ViewContent, since a product page
 * is viewed before any variant is picked. A future Meta catalog feed should therefore use variant id as `id` and product
 * id as `item_group_id`.
 *
 * Advanced matching: once the shopper is known (lib/pixels/index.ts's pixelIdentify), their email / phone / name /
 * district / division go to `fbq('init')` as its third argument — normalized by the same metaMatchKeys the Conversions
 * API uses, and SHA-256 hashed by fbevents.js itself before anything leaves the browser.
 *
 * Inert (every call a no-op) until this installation's META_PIXEL_ID is set (runtime configuration) — only the production build gets it,
 * so dev/CI traffic never reaches the real pixel. */

/** This installation's Meta Pixel id — runtime configuration (Phase 1A), read when used. */
const pixelId = () => publicRuntimeConfig().metaPixelId;

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

let initialized = false;
let matched = false;

function matchKeysFor(customer: PixelCustomer | null): MetaMatchKeys | null {
  if (!customer) return null;
  const keys = metaMatchKeys(customer);
  return Object.keys(keys).length > 0 ? keys : null;
}

/** Loads fbevents.js and runs `fbq('init')` once per page load, however many times it's called. Installs Meta's
 * standard queueing stub first, so events tracked before the script finishes downloading are buffered rather than
 * lost. The base code's own PageView is deliberately not fired here — every PageView comes from <AdPixels />, which is
 * what keeps the first load from counting twice.
 *
 * Advanced matching usually becomes known after the first init (the PageView fires before the shopper's account loads
 * or they check out). fbevents.js accepts user data from a repeat `init` only while the pixel has none yet — a second
 * set is refused as "Duplicate Pixel ID" — so it's attached exactly once: with the first init when already known,
 * otherwise with one more `init` just before the first event that carries it. */
function ensureInitialized(customer: PixelCustomer | null): boolean {
  if (!pixelId() || typeof window === "undefined") return false;
  const matching = matchKeysFor(customer);
  if (initialized) {
    if (matching && !matched) {
      matched = true;
      window.fbq!("init", pixelId(), matching);
    }
    return true;
  }
  initialized = true;
  matched = matching !== null;

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

  if (matching) window.fbq!("init", pixelId(), matching);
  else window.fbq!("init", pixelId());
  return true;
}

function cartParams(items: PixelLineItem[], currency: string) {
  return {
    content_type: "product",
    content_ids: [...new Set(items.map((i) => i.id))],
    contents: items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
    num_items: items.reduce((sum, i) => sum + i.quantity, 0),
    value: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    currency,
  };
}

function toMeta(event: PixelEvent, ctx: PixelEventContext): [string, Record<string, unknown>] {
  switch (event.name) {
    case "PageView":
      return ["PageView", {}];
    case "ViewContent":
      return [
        "ViewContent",
        {
          content_type: "product_group",
          content_ids: [event.product.id],
          content_name: event.product.name,
          value: event.product.price,
          currency: ctx.currency,
        },
      ];
    case "Search":
      return ["Search", { search_string: event.query, content_type: "product" }];
    case "AddToCart":
      return ["AddToCart", { ...cartParams([event.item], ctx.currency), content_name: event.item.name }];
    case "InitiateCheckout":
      return ["InitiateCheckout", cartParams(event.items, ctx.currency)];
    case "AddPaymentInfo":
      return ["AddPaymentInfo", { ...cartParams(event.items, ctx.currency), payment_type: event.paymentMethod }];
    case "Purchase":
      return ["Purchase", { ...cartParams(event.items, ctx.currency), value: event.value, order_id: event.orderId }];
    case "CompleteRegistration":
      return ["CompleteRegistration", { registration_method: event.method, status: true }];
    case "Contact":
      return ["Contact", { contact_channel: event.channel }];
  }
}

export const metaPixel: PixelProvider = {
  name: "meta",
  get enabled() {
    return Boolean(pixelId());
  },
  send(event, ctx) {
    if (!ensureInitialized(ctx.customer)) return;
    const [name, params] = toMeta(event, ctx);
    window.fbq!("track", name, params, { eventID: ctx.eventId });
    if (event.name !== "Purchase") sendServerCopy(name, params, ctx);
  },
};

/** The same event, same eventID, to our API, which forwards it to the Conversions API with what only the request
 * carries (IP, user agent, the _fbp/_fbc cookies) — Meta keeps one of the pair, so an ad blocker or a closed tab no
 * longer loses it. Purchase is left out: the API already sends that one from the order itself. Best-effort like every
 * pixel call: never awaited, never throws. */
function sendServerCopy(name: string, params: Record<string, unknown>, ctx: PixelEventContext): void {
  try {
    fetch(`${apiBaseUrl()}/api/analytics/meta-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The Pixel's cookies have to reach the API (a different origin in development).
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({ eventName: name, eventId: ctx.eventId, eventSourceUrl: window.location.href, customData: params, customer: ctx.customer }),
    }).catch(() => {});
  } catch {
    // fetch unavailable — the browser copy still went
  }
}
