import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { trackPageView } from "./analytics.service";
import { getChannelPerformance, getTrafficSources } from "./traffic.service";

// A fixed Dhaka business day long ago, so no other test's pageviews fall inside it.
const DAY = "2005-05-10";
const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+06:00`);
const RUN = `vt-traffic-${Date.now()}`;
const sid = (k: string) => `${RUN}-${k}`;
const from = local(DAY, "00:00");
const to = local(DAY, "23:00");

async function pageview(session: string, at: Date, data: { referrer?: string; utmSource?: string; utmMedium?: string; path?: string; visitorId?: string }) {
  await prisma.pageView.create({ data: { sessionId: session, createdAt: at, path: data.path ?? "/", referrer: data.referrer ?? null, utmSource: data.utmSource ?? null, utmMedium: data.utmMedium ?? null, visitorId: data.visitorId ?? null } });
}

async function orderFrom(session: string | null, at: Date) {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
  const o = await createManualOrder(
    {
      items: [{ variantId: variants[0]!.id, quantity: 1 }],
      customerName: "Vitest Traffic",
      customerPhone: `0181${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
    } as never,
    await ownerId(),
  );
  trackOrder(o.id);
  await prisma.order.update({ where: { id: o.id }, data: { createdAt: at, sessionId: session } });
}

beforeAll(async () => {
  // Five Facebook sessions under three hosts and the app, one of them an ad click.
  await pageview(sid("fb1"), local(DAY, "09:00"), { referrer: "https://lm.facebook.com/" });
  await pageview(sid("fb2"), local(DAY, "09:05"), { referrer: "http://m.facebook.com/", path: "/products/x?fbclid=IwAR1" });
  await pageview(sid("fb3"), local(DAY, "09:10"), { path: "/lp/eid?fbclid=IwAR2" }); // in-app browser, no referrer
  await pageview(sid("fbad"), local(DAY, "09:15"), { utmSource: "fb", utmMedium: "paid", path: "/?fbclid=IwAR3" });
  await pageview(sid("google"), local(DAY, "09:20"), { referrer: "https://www.google.com/" });
  // A visitor who came from a Facebook ad two days earlier, then returned "direct" on DAY and ordered.
  await pageview(sid("lnd-before"), local("2005-05-08", "20:00"), { utmSource: "fb", utmMedium: "paid", visitorId: `${RUN}-v1` });
  await pageview(sid("lnd-order"), local(DAY, "10:00"), { visitorId: `${RUN}-v1` });
  await pageview(sid("lnd-order"), local(DAY, "10:05"), { path: "/checkout", visitorId: `${RUN}-v1` });
  // A direct visitor with no earlier visit stays direct.
  await pageview(sid("direct"), local(DAY, "11:00"), { visitorId: `${RUN}-v2` });

  await orderFrom(sid("lnd-order"), local(DAY, "10:10"));
  await orderFrom(sid("direct"), local(DAY, "11:10"));
  await orderFrom(sid("fbad"), local(DAY, "09:30"));
  await orderFrom(null, local(DAY, "12:00")); // a phone order
});

afterAll(async () => {
  await prisma.pageView.deleteMany({ where: { sessionId: { startsWith: RUN } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("traffic channels", () => {
  it("folds Facebook's hosts, the app and fbclid-only visits into one channel, with ads apart", async () => {
    const rows = await getTrafficSources(undefined, 20, from, to);
    const by = Object.fromEntries(rows.map((r) => [r.source, r.sessions]));
    expect(by.Facebook).toBe(3);
    expect(by["Facebook ads"]).toBe(1);
    expect(by.Google).toBe(1);
    expect(by.Direct).toBe(2); // lnd-order and direct (lnd-before started on another day)
  });

  it("credits a direct order to the visitor's last non-direct visit within 30 days; phone orders have no visit", async () => {
    const { channels, totals } = await getChannelPerformance(undefined, from, to);
    const by = Object.fromEntries(channels.map((c) => [c.key, c]));
    expect(by["facebook:paid"]).toMatchObject({ sessions: 1, orders: 2 }); // its own ad session + the returning visitor
    expect(by["direct:organic"]).toMatchObject({ sessions: 2, orders: 1 });
    expect(by.none).toMatchObject({ orders: 1, conversionRate: null, label: "No website visit (phone, admin)" });
    expect(by["facebook:paid"]!.conversionRate).toBe(2);
    expect(totals).toMatchObject({ orders: 4, reattributedFromDirect: 1 });
  });

  it("never stores a pageview from a bot", async () => {
    const id = await trackPageView({ sessionId: sid("bot"), path: "/" } as never, "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36", null, null, false);
    expect(id).toBeNull();
    expect(await prisma.pageView.count({ where: { sessionId: sid("bot") } })).toBe(0);
    const human = await trackPageView({ sessionId: sid("human"), path: "/" } as never, "Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36", null, null, false);
    expect(human).toEqual(expect.any(String));
  });
});
