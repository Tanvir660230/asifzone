import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@clothing-brand/shared";

// Meta advanced matching through the real lib/pixels/ layer: what reaches `fbq('init')`, and when. fbevents.js only
// accepts user data from a repeat `init` while the pixel has none (see ensureInitialized in ./meta.ts), so the order of
// these calls is the behaviour under test.

vi.mock("../runtime-config", () => ({
  publicRuntimeConfig: () => ({ metaPixelId: "1606825430933398", tiktokPixelId: "", clarityId: "" }),
  apiBaseUrl: () => "https://shop.test",
}));
vi.mock("../store-config", () => ({ getStoreConfig: () => ({ currency: "BDT" }) }));

type Call = unknown[];

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

let calls: Call[];
let serverCopies: { url: string; body: Record<string, unknown> }[];

/** A fresh page load: new module state, consent given, and an fbq that records what the storefront asked of it. */
async function loadPage(path = "/checkout", localStorage = memoryStorage({ az_tracking_consent_v1: "granted" })) {
  vi.resetModules();
  calls = [];
  serverCopies = [];
  vi.stubGlobal("fetch", (url: string, init: { body: string }) => {
    serverCopies.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  const fbq = Object.assign((...args: unknown[]) => void calls.push(args), { queue: [] });
  vi.stubGlobal("window", {
    location: { pathname: path, href: `https://shop.test${path}` },
    localStorage,
    sessionStorage: memoryStorage(),
    fbq,
  });
  return import("./index");
}

const inits = () => calls.filter((c) => c[0] === "init");
const tracked = () => calls.filter((c) => c[0] === "track").map((c) => c[1]);

const order = {
  orderNumber: "AZ-1001",
  status: "PENDING",
  paymentMethod: "COD",
  paymentStatus: "UNPAID",
  createdAt: new Date().toISOString(),
  customerName: "Md Rahim Uddin",
  customerEmail: null,
  customerPhone: "01712-345678",
  shippingDistrict: "Cox's Bazar",
  shippingDivision: "Chattogram",
  total: "1500",
  items: [{ variantId: "v1", productNameSnapshot: "Panjabi", quantity: 1, priceSnapshot: "1500" }],
} as unknown as Order;

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("Meta advanced matching", () => {
  it("initializes without user data for an anonymous visitor", async () => {
    const pixels = await loadPage("/");
    pixels.pixelPageView("/");
    expect(inits()).toEqual([["init", "1606825430933398"]]);
  });

  it("sends the shopper's checkout details, normalized like the Conversions API, before the next event", async () => {
    const pixels = await loadPage();
    pixels.pixelPageView("/checkout");
    pixels.pixelIdentify({
      email: "  Rahim@Example.COM ",
      phone: "+880 1712-345678",
      fullName: "Md Rahim Uddin",
      city: "Cox's Bazar",
      state: "Chattogram",
    });
    pixels.pixelAddPaymentInfo([{ id: "v1", name: "Panjabi", quantity: 1, price: 1500 }], "COD");

    expect(inits()).toEqual([
      ["init", "1606825430933398"],
      [
        "init",
        "1606825430933398",
        { em: "rahim@example.com", ph: "8801712345678", fn: "md", ln: "uddin", ct: "coxsbazar", st: "chattogram", country: "bd" },
      ],
    ]);
    // The user data lands before the event it should be attached to.
    expect(calls.findIndex((c) => c[0] === "init" && c[2])).toBeLessThan(calls.findIndex((c) => c[1] === "AddPaymentInfo"));
  });

  it("attaches user data to the first init when the shopper is already known", async () => {
    const pixels = await loadPage();
    pixels.pixelIdentify({ phone: "01712345678" });
    pixels.pixelPageView("/checkout");
    expect(inits()).toEqual([["init", "1606825430933398", { ph: "8801712345678", country: "bd" }]]);
  });

  it("never re-sends user data on the same page load (fbevents.js would refuse it as a duplicate init)", async () => {
    const pixels = await loadPage();
    pixels.pixelIdentify({ phone: "01712345678" });
    pixels.pixelPageView("/checkout");
    pixels.pixelIdentify({ phone: "01712345678", city: "Dhaka" });
    pixels.pixelAddPaymentInfo([{ id: "v1", name: "Panjabi", quantity: 1, price: 1500 }], "COD");
    expect(inits()).toHaveLength(1);
  });

  it("identifies the buyer from the order on the confirmation page (a fresh load after a gateway redirect)", async () => {
    const pixels = await loadPage("/order-confirmation/AZ-1001");
    pixels.pixelPurchase(order);
    expect(inits()).toEqual([
      ["init", "1606825430933398", { ph: "8801712345678", fn: "md", ln: "uddin", ct: "coxsbazar", st: "chattogram", country: "bd" }],
    ]);
    expect(tracked()).toEqual(["Purchase"]);
  });

  it("sends nothing about the shopper without ad-tracking consent", async () => {
    const pixels = await loadPage();
    (window as unknown as { localStorage: ReturnType<typeof memoryStorage> }).localStorage.removeItem("az_tracking_consent_v1");
    pixels.pixelIdentify({ phone: "01712345678" });
    pixels.pixelAddPaymentInfo([{ id: "v1", name: "Panjabi", quantity: 1, price: 1500 }], "COD");
    expect(calls).toEqual([]);
  });

  it("ignores fields that aren't a usable match key", async () => {
    const pixels = await loadPage();
    pixels.pixelIdentify({ email: "   ", phone: "12345", fullName: "" });
    pixels.pixelPageView("/checkout");
    expect(inits()).toEqual([["init", "1606825430933398"]]);
  });

  it("merges what later calls add for the same person, and replaces a different person", async () => {
    const pixels = await loadPage();
    pixels.pixelIdentify({ email: "a@b.com", phone: "01712345678", fullName: "Rahim" });
    pixels.pixelIdentify({ phone: "+8801712345678", city: "Dhaka" });
    pixels.pixelPageView("/checkout");
    expect(inits()[0]![2]).toEqual({ em: "a@b.com", ph: "8801712345678", fn: "rahim", ct: "dhaka", country: "bd" });

    const next = await loadPage();
    next.pixelIdentify({ email: "a@b.com", fullName: "Rahim" });
    next.pixelIdentify({ email: "c@d.com" });
    next.pixelPageView("/checkout");
    expect(inits()[0]![2]).toEqual({ em: "c@d.com", country: "bd" });
  });
});

describe("the shopper's identity across page loads", () => {
  const consented = () => memoryStorage({ az_tracking_consent_v1: "granted" });

  it("is remembered with consent, so the next page's events carry it", async () => {
    const storage = consented();
    const first = await loadPage("/checkout", storage);
    first.pixelIdentify({ phone: "01712345678", fullName: "Rahim" });

    const next = await loadPage("/products/panjabi", storage);
    next.pixelContact("whatsapp");
    expect(inits()).toEqual([["init", "1606825430933398", { ph: "8801712345678", fn: "rahim", country: "bd" }]]);
  });

  it("is never stored without consent", async () => {
    const storage = memoryStorage();
    const first = await loadPage("/checkout", storage);
    first.pixelIdentify({ phone: "01712345678" });
    storage.setItem("az_tracking_consent_v1", "granted");

    const next = await loadPage("/", storage);
    next.pixelPageView("/");
    expect(inits()).toEqual([["init", "1606825430933398"]]);
  });

  it("is forgotten on sign-out or withdrawn consent", async () => {
    const storage = consented();
    const first = await loadPage("/checkout", storage);
    first.pixelIdentify({ phone: "01712345678" });
    first.pixelForget();

    const next = await loadPage("/", storage);
    next.pixelPageView("/");
    expect(inits()).toEqual([["init", "1606825430933398"]]);
  });
});

describe("Conversions API server copy", () => {
  it("posts every event except Purchase under the browser event's id, with the shopper's identity", async () => {
    const pixels = await loadPage();
    pixels.pixelIdentify({ phone: "01712345678" });
    pixels.pixelAddToCart({ id: "v1", name: "Panjabi", quantity: 1, price: 1500 });

    const eventId = (calls.find((c) => c[1] === "AddToCart")![3] as { eventID: string }).eventID;
    expect(serverCopies).toHaveLength(1);
    expect(serverCopies[0]!.url).toBe("https://shop.test/api/analytics/meta-event");
    expect(serverCopies[0]!.body).toMatchObject({
      eventName: "AddToCart",
      eventId,
      eventSourceUrl: "https://shop.test/checkout",
      customData: { content_ids: ["v1"], value: 1500, currency: "BDT" },
      customer: { phone: "01712345678" },
    });

    const confirmation = await loadPage("/order-confirmation/AZ-1001");
    confirmation.pixelPurchase(order);
    expect(serverCopies).toEqual([]);
  });
});
