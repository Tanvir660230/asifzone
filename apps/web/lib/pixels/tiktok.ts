import type { PixelEvent, PixelEventContext, PixelLineItem, PixelProvider } from "./types";
import { publicRuntimeConfig } from "../runtime-config";

/** The one module that talks to the TikTok Pixel — it only translates the neutral events lib/pixels/index.ts dispatches
 * into `ttq` calls; when an event fires (and whether it's a repeat) is decided there, once, for every platform.
 *
 * Event names and parameters follow TikTok's current standard-events spec (Business Help Center, "Standard Events and
 * Parameters" / "TikTok's Updated Standard Events"): `Purchase` is the current name of the legacy `CompletePayment`
 * (TikTok still accepts the old name but new setups should send `Purchase`), Search carries `search_string`, and product
 * data goes in `contents` (content_id / content_type / content_name / price / quantity) with `value` = the total and
 * `currency` an ISO 4217 code (BDT is supported). Content ids follow the same variant/product convention as Meta (see
 * ./types.ts), so one catalog feed can serve both platforms.
 *
 * `event_id` (third ttq.track argument) is what TikTok deduplicates a browser event against an Events API event with:
 * same pixel + event name + event_id within 48h counts once. Purchase's id is deterministic per order (see
 * purchaseEventId in ./index.ts), which the server-side Events API sender (apps/api lib/tiktok/purchase.ts) reuses.
 *
 * Advanced matching (hashed email/phone) happens server-side in that sender, never in the browser.
 *
 * Inert (every call a no-op, nothing downloaded) until this installation's TIKTOK_PIXEL_ID is set (runtime configuration). */

/** This installation's TikTok Pixel id — runtime configuration (Phase 1A), read when used. */
const pixelId = () => publicRuntimeConfig().tiktokPixelId;
const SDK_URL = "https://analytics.tiktok.com/i18n/pixel/events.js";

interface TikTokContent {
  content_id: string;
  content_type: "product" | "product_group";
  content_name?: string;
  price?: number;
  quantity?: number;
}

interface TikTokCommerceProperties {
  contents: TikTokContent[];
  content_type: "product" | "product_group";
  value: number;
  currency: string;
}

/** Every TikTok event this store sends, with the exact properties each one takes. */
export interface TikTokEventProperties {
  ViewContent: TikTokCommerceProperties;
  Search: { search_string: string };
  AddToCart: TikTokCommerceProperties;
  InitiateCheckout: TikTokCommerceProperties;
  AddPaymentInfo: TikTokCommerceProperties;
  Purchase: TikTokCommerceProperties & { order_id: string };
  CompleteRegistration: Record<string, never>;
  Contact: Record<string, never>;
}

export type TikTokEventName = keyof TikTokEventProperties;

interface Ttq {
  page(): void;
  track(event: string, properties?: object, options?: { event_id?: string }): void;
  load(pixelId: string, options?: object): void;
}

declare global {
  interface Window {
    ttq?: Ttq;
    TiktokAnalyticsObject?: string;
  }
}

// The method list of TikTok's official base code — each is queued by the stub until events.js takes over.
const STUB_METHODS = [
  "page",
  "track",
  "identify",
  "instances",
  "debug",
  "on",
  "off",
  "once",
  "ready",
  "alias",
  "group",
  "enableCookie",
  "disableCookie",
  "holdConsent",
  "revokeConsent",
  "grantConsent",
];

type StubQueue = unknown[] & Record<string, unknown>;

/** A line-for-line port of TikTok's official base code (Events Manager -> Pixel -> Install code manually), minus its
 * trailing `ttq.load(id); ttq.page();` — load runs once in ensureLoaded and every page view comes from <AdPixels />,
 * which is what keeps the first load from counting twice. */
function installStub(): void {
  const ttq = [] as unknown as StubQueue;
  const setAndDefer = (target: StubQueue, method: string) => {
    target[method] = (...args: unknown[]) => {
      target.push([method, ...args]);
    };
  };
  ttq.methods = STUB_METHODS;
  ttq.setAndDefer = setAndDefer;
  for (const method of STUB_METHODS) setAndDefer(ttq, method);
  ttq.instance = (id: string) => {
    const instance = ((ttq._i as Record<string, StubQueue> | undefined)?.[id] ?? []) as StubQueue;
    for (const method of STUB_METHODS) setAndDefer(instance, method);
    return instance;
  };
  ttq.load = (id: string, options?: object) => {
    const instances = (ttq._i ??= {}) as Record<string, StubQueue>;
    instances[id] = [] as unknown as StubQueue;
    instances[id]._u = SDK_URL;
    ((ttq._t ??= {}) as Record<string, number>)[id] = Date.now();
    ((ttq._o ??= {}) as Record<string, object>)[id] = options ?? {};
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = `${SDK_URL}?sdkid=${id}&lib=ttq`;
    document.head.appendChild(script);
  };
  window.TiktokAnalyticsObject = "ttq";
  window.ttq = ttq as unknown as Ttq;
}

/** TikTok's click id (`?ttclid=` on an ad link), kept 7 days in a first-party cookie so the API can attach it to the
 * server-side Purchase — the browser pixel matches clicks by itself, the server copy needs it handed over. Only reached
 * once tracking consent is given and the pixel is configured. */
const CLICK_ID = /^[\w.-]{8,500}$/;
const CLICK_ID_DAYS = 7;

function rememberClickId(): void {
  try {
    const id = new URLSearchParams(window.location.search).get("ttclid");
    if (!id || !CLICK_ID.test(id)) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `ttclid=${id}; Max-Age=${CLICK_ID_DAYS * 24 * 60 * 60}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // tracking is best-effort
  }
}

let loaded = false;

/** Installs the queueing stub and loads events.js exactly once per page load — events tracked before the script arrives
 * are buffered by the stub, not lost. Also refuses to load a second copy when one is already on the page (a hot reload
 * re-evaluating this module), since the stub records every pixel it has loaded. */
function ensureLoaded(): boolean {
  if (!pixelId() || typeof window === "undefined") return false;
  if (loaded) return true;
  loaded = true;

  const alreadyLoaded = (window.ttq as unknown as { _i?: Record<string, unknown> } | undefined)?._i?.[pixelId()];
  if (!window.ttq) installStub();
  if (!alreadyLoaded) window.ttq!.load(pixelId());
  return true;
}

/** The typed entry point — the only place a `ttq.track` call is made. */
export function trackTikTokEvent<E extends TikTokEventName>(event: E, properties: TikTokEventProperties[E], eventId: string): void {
  if (!ensureLoaded()) return;
  window.ttq!.track(event, properties, { event_id: eventId });
}

function commerce(items: PixelLineItem[], currency: string): TikTokCommerceProperties {
  return {
    contents: items.map((i) => ({ content_id: i.id, content_type: "product", content_name: i.name, price: i.price, quantity: i.quantity })),
    content_type: "product",
    value: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    currency,
  };
}

function send(event: PixelEvent, ctx: PixelEventContext): void {
  switch (event.name) {
    case "PageView":
      // events.js also detects SPA history changes by itself and counts one Pageview per URL, deduplicating an explicit
      // page() for a URL it already counted (verified in e2e/ad-pixels.spec.ts) — so this is exactly one Pageview per
      // page either way, and still correct if that auto-detection is ever off for the pixel.
      if (ensureLoaded()) {
        rememberClickId();
        window.ttq!.page();
      }
      return;
    case "ViewContent": {
      const { id, name, price } = event.product;
      return trackTikTokEvent(
        "ViewContent",
        {
          contents: [{ content_id: id, content_type: "product_group", content_name: name, price, quantity: 1 }],
          content_type: "product_group",
          value: price,
          currency: ctx.currency,
        },
        ctx.eventId,
      );
    }
    case "Search":
      return trackTikTokEvent("Search", { search_string: event.query }, ctx.eventId);
    case "AddToCart":
      return trackTikTokEvent("AddToCart", commerce([event.item], ctx.currency), ctx.eventId);
    case "InitiateCheckout":
      return trackTikTokEvent("InitiateCheckout", commerce(event.items, ctx.currency), ctx.eventId);
    case "AddPaymentInfo":
      // Only which items are being paid for — the payment method/instrument is never sent.
      return trackTikTokEvent("AddPaymentInfo", commerce(event.items, ctx.currency), ctx.eventId);
    case "Purchase":
      return trackTikTokEvent(
        "Purchase",
        { ...commerce(event.items, ctx.currency), value: event.value, order_id: event.orderId },
        ctx.eventId,
      );
    case "CompleteRegistration":
      return trackTikTokEvent("CompleteRegistration", {}, ctx.eventId);
    case "Contact":
      return trackTikTokEvent("Contact", {}, ctx.eventId);
  }
}

export const tiktokPixel: PixelProvider = {
  name: "tiktok",
  get enabled() {
    return Boolean(pixelId());
  },
  send,
};
