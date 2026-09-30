import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { contributions, formatDateTime, sumOf } from "@clothing-brand/shared";

// The storefront revalidation call is captured (no web server in the test run) — Phase 7 D-7.
const revalidated = vi.hoisted(() => [] as string[][]);
vi.mock("../../lib/storefront-revalidate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storefront-revalidate")>();
  return { ...actual, revalidateStorefrontTags: async (tags: string[]) => void revalidated.push(tags) };
});

import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { cacheDel, cacheGet, cacheSet } from "../../config/redis";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { getSettings, updateSettings } from "../../modules/settings/settings.service";
import { holdOrderForFollowUp, updateOrderStatus } from "../../modules/orders/order.service";
import { initSslcommerzSession } from "../../modules/payments/sslcommerz.service";
import { buildPurchaseEvent } from "../../lib/meta/purchase";
import { renderEmailLayout } from "../../lib/email-template";
import { recordRefund } from "../payments/payment-ledger.service";
import { loadOrderFacts } from "../metrics/facts.repository";
import { resolveStoreRange, storeContext } from "../metrics/store-time";
import { quoteCart } from "../pricing/pricing.service";
import { getCommerceSettings, getCurrency, getTimezone } from "./commerce-settings";

// Phase 7 (docs/PHASE_7_AUDIT.md): currency and timezone resolve through one path over the one owner; money paths and
// display use them; settings updates never leave a stale copy and never touch historical facts.

let admin: string;
let original: { timezone: string; storeName: string; tagline: string | null; currency: string };
const lifetime = { startUtc: new Date(0), endUtc: new Date(Date.now() + 86_400_000) };

beforeAll(async () => {
  admin = await ownerId();
  const s = await prisma.storeSetting.findUniqueOrThrow({ where: { id: "singleton" } });
  original = { timezone: s.timezone, storeName: s.storeName, tagline: s.tagline, currency: s.currency };
});

afterAll(async () => {
  await updateSettings({ timezone: original.timezone, storeName: original.storeName, tagline: original.tagline });
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function deliveredOrderWithRefund() {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
  await recordRefund(order.id, { amount: 100 }, admin);
  return { order, variantId: variants[0]!.id };
}

/** Everything historical about an order: its money row, lines, ledger rows and metrics. */
async function historyOf(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { total: true, subtotal: true, shippingFee: true, taxAmount: true, createdAt: true, items: { select: { priceSnapshot: true, unitCostSnapshot: true, categoryNameSnapshot: true } } },
  });
  const payments = await prisma.payment.findMany({ where: { orderId }, select: { amount: true, settledAt: true }, orderBy: { settledAt: "asc" } });
  const refunds = await prisma.refund.findMany({ where: { orderId }, select: { amount: true, completedAt: true } });
  const facts = await loadOrderFacts([orderId], await getCurrency());
  const metrics = ["realised_net_sales", "refunds", "collected_cash", "gross_merchandise_sales"].map((k) => sumOf(contributions(k, facts, lifetime)));
  return JSON.stringify({ order, payments, refunds, metrics });
}

describe("one resolution path (D-1)", () => {
  it("commerce settings = the stored row; metrics context, quote, read model and gateway all use the same currency", async () => {
    const row = await prisma.storeSetting.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(await getCommerceSettings()).toEqual({ currency: row.currency, timezone: row.timezone });
    expect(await storeContext()).toEqual({ currency: row.currency, timezone: row.timezone });
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const { quote } = await quoteCart({ items: [{ variantId: variants[0]!.id, quantity: 1 }], promotions: "FLASH_ONLY", customerId: null });
    expect(quote.currency).toBe(row.currency);
  });

  it("SSLCommerz is charged in the store currency (not a hard-coded code)", async () => {
    let sent = "";
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      sent = String(init?.body ?? "");
      return new Response(JSON.stringify({ status: "FAILED", failedreason: "test" }), { status: 200 });
    }) as typeof fetch;
    try {
      await initSslcommerzSession({ orderNumber: "P7-TEST", amount: 1060, customerName: "T", customerEmail: null, customerPhone: "01700000000", customerAddress: "A", customerCity: "Dhaka" } as never).catch(() => undefined);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(new URLSearchParams(sent).get("currency")).toBe(await getCurrency());
  });

  it("the Meta purchase event reports the store currency", async () => {
    const { order } = await deliveredOrderWithRefund();
    const event = await buildPurchaseEvent(order.id, {});
    expect(event!.custom_data!.currency).toBe(await getCurrency());
  });
});

describe("currency lock keeps history (P6-4 preserved)", () => {
  it("a change after orders exist is refused (service + HTTP) and no amount, ledger row or metric moves", async () => {
    const { order } = await deliveredOrderWithRefund();
    const before = await historyOf(order.id);
    const other = original.currency === "USD" ? "EUR" : "USD";
    try {
      await expect(updateSettings({ currency: other })).rejects.toMatchObject({ statusCode: 409, details: { code: "CURRENCY_LOCKED" } });
      const http = await (await asOwner()).patch("/api/settings", { currency: other });
      expect([http.status, http.body.details?.code]).toEqual([409, "CURRENCY_LOCKED"]);
      expect(await getCurrency()).toBe(original.currency);
      expect(await historyOf(order.id)).toBe(before);
    } finally {
      // Even if a regression let the change through, the shared test DB keeps its currency (the lock blocks the app path).
      await prisma.storeSetting.update({ where: { id: "singleton" }, data: { currency: original.currency } });
      await cacheDel("settings:singleton");
    }
  });

  it("an unsupported code is rejected by validation before it could ever be stored", async () => {
    const http = await (await asOwner()).patch("/api/settings", { currency: "Taka" });
    expect(http.status).toBe(400);
    expect((await prisma.storeSetting.findUniqueOrThrow({ where: { id: "singleton" } })).currency).toBe(original.currency);
  });
});

describe("timezone is configuration, not history", () => {
  it("the configured timezone drives business days and store-time display at once; stored timestamps and every amount stay the same", async () => {
    const { order } = await deliveredOrderWithRefund();
    const before = await historyOf(order.id);
    const next = original.timezone === "UTC" ? "Asia/Dhaka" : "UTC";
    try {
      await updateSettings({ timezone: next });
      expect(await getTimezone()).toBe(next); // no stale cached value
      expect((await resolveStoreRange({ preset: "today" })).timezone).toBe(next);
      const followUpAt = new Date(Date.now() + 3 * 3_600_000);
      const pending = await placeOrder([{ variantId: (await createStockedProduct({ stocks: [3] })).variants[0]!.id, quantity: 1 }]);
      const held = await holdOrderForFollowUp(pending.id, { followUpAt, note: "call back" }, admin);
      const note = held.statusHistory.at(-1)!.note!;
      expect(note).toContain(formatDateTime(followUpAt, next)); // the order note uses the store timezone, not a fixed one
      expect(await historyOf(order.id)).toBe(before);
    } finally {
      await updateSettings({ timezone: original.timezone });
    }
    expect(await getTimezone()).toBe(original.timezone);
  });
});

describe("one writer, no stale copies (D-7)", () => {
  it("a settings save replaces the API cache and revalidates the storefront's settings tag", async () => {
    await getSettings(); // prime the cache (a no-op without Redis)
    // A stale copy planted in the cache must not survive the save.
    await cacheSet("settings:singleton", { ...(await getSettings()), tagline: "stale tagline" }, 300);
    revalidated.length = 0;
    try {
      await updateSettings({ tagline: "P7 fresh tagline" });
      expect((await getSettings()).tagline).toBe("P7 fresh tagline");
      const cached = await cacheGet<{ tagline: string | null }>("settings:singleton");
      if (cached) expect(cached.tagline).not.toBe("stale tagline");
      expect(revalidated).toContainEqual(["settings"]);
    } finally {
      await updateSettings({ tagline: original.tagline });
    }
  });

  it("the public settings endpoint serves the same currency/timezone the API resolves", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(200);
    expect({ currency: res.body.settings.currency, timezone: res.body.settings.timezone }).toEqual(await getCommerceSettings());
  });
});

describe("store identity in emails comes from settings (D-5)", () => {
  it("the layout shows the configured name and tagline — no hard-coded brand", async () => {
    try {
      await updateSettings({ storeName: "P7 Test Store", tagline: "Configured tagline" });
      const html = await renderEmailLayout({ bodyHtml: "<p>x</p>" });
      expect(html).toContain("P7 TEST STORE");
      expect(html).toContain("Configured tagline");
      expect(html).toContain(`${new Date().getFullYear()} P7 Test Store. All rights reserved.`);
    } finally {
      await updateSettings({ storeName: original.storeName, tagline: original.tagline });
    }
  });
});
