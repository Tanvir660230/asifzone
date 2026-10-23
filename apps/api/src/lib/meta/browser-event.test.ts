import { describe, it, expect } from "vitest";
import { metaBrowserEventSchema } from "@clothing-brand/shared";
import { buildBrowserEvent } from "./browser-event";
import { sha256 } from "./capi";

const WEB = "https://asifzone.com";
const NOW = new Date("2026-10-21T10:00:00Z");

const input = (overrides: Record<string, unknown> = {}) =>
  metaBrowserEventSchema.parse({
    eventName: "InitiateCheckout",
    eventId: "ev_123",
    eventSourceUrl: `${WEB}/checkout`,
    customData: { currency: "BDT", value: 1500, content_type: "product", content_ids: ["v1"], num_items: 1 },
    ...overrides,
  });

describe("buildBrowserEvent", () => {
  it("is the browser event's server twin: same name and event_id, hashed identity, browser signals unhashed", () => {
    const event = buildBrowserEvent(input({ customer: { phone: "01712345678", fullName: "Md Rahim Uddin" } }), {
      context: { clientIpAddress: "203.0.113.9", clientUserAgent: "UA", fbp: "fb.1.1700000000000.1", fbc: "fb.1.1700000000000.IwAR0abc" },
      externalId: "cust_1",
      webOrigin: WEB,
      now: NOW,
    });

    expect(event).toEqual({
      event_name: "InitiateCheckout",
      event_id: "ev_123",
      event_time: Math.floor(NOW.getTime() / 1000),
      action_source: "website",
      event_source_url: `${WEB}/checkout`,
      user_data: {
        ph: [sha256("8801712345678")],
        fn: [sha256("md")],
        ln: [sha256("uddin")],
        country: [sha256("bd")],
        external_id: [sha256("cust_1")],
        client_ip_address: "203.0.113.9",
        client_user_agent: "UA",
        fbp: "fb.1.1700000000000.1",
        fbc: "fb.1.1700000000000.IwAR0abc",
      },
      custom_data: { currency: "BDT", value: 1500, content_type: "product", content_ids: ["v1"], num_items: 1 },
    });
  });

  it("sends an anonymous visitor with only the browser signals, and no empty custom_data", () => {
    const event = buildBrowserEvent(input({ eventName: "PageView", customData: {} }), {
      context: { clientUserAgent: "UA" },
      externalId: null,
      webOrigin: WEB,
      now: NOW,
    });
    expect(event!.user_data).toEqual({ client_user_agent: "UA" });
    expect("custom_data" in event!).toBe(false);
  });

  it("refuses a page that isn't this store's", () => {
    const ctx = { context: {}, externalId: null, webOrigin: WEB, now: NOW };
    expect(buildBrowserEvent(input({ eventSourceUrl: "https://evil.example/checkout" }), ctx)).toBeNull();
    expect(buildBrowserEvent(input({ eventSourceUrl: "https://asifzone.com.evil.example/" }), ctx)).toBeNull();
    expect(buildBrowserEvent(input({ eventSourceUrl: "not a url" }), ctx)).toBeNull();
    expect(buildBrowserEvent(input({ eventSourceUrl: `${WEB}/admin/orders` }), ctx)).toBeNull();
  });
});

describe("metaBrowserEventSchema", () => {
  it("never relays Purchase (the API sends that from the order) or parameters the Pixel doesn't build", () => {
    expect(metaBrowserEventSchema.safeParse({ eventName: "Purchase", eventId: "x", eventSourceUrl: WEB }).success).toBe(false);
    expect(
      metaBrowserEventSchema.safeParse({ eventName: "PageView", eventId: "x", eventSourceUrl: WEB, customData: { em: "a@b.com" } }).success,
    ).toBe(false);
  });
});
