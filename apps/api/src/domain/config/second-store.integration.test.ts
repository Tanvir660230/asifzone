import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Capture what the SMS provider is asked to send (the real adapter would only dev-log under LIVE_PROVIDERS=off).
const sent = vi.hoisted(() => [] as Array<{ to: string; body: string }>);
vi.mock("../../providers/sms/bulksmsbd", () => ({ sendSms: vi.fn(async (m: { to: string; body: string }) => void sent.push(m)) }));

import request from "supertest";
import { createHash } from "node:crypto";
import {
  DEFAULT_CUSTOMER_SMS_TEMPLATES,
  normalizeBdPhone,
  PHONE_REGEX,
  renderOrderSms,
  toBdInternationalDigits,
  updateSettingsSchema,
} from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { renderEmailLayout } from "../../lib/email-template";
import { getSettings, updateSettings } from "../../modules/settings/settings.service";
import { requestOtp } from "../../modules/customers/customer.service";
import { ProviderNotConfiguredError } from "../../providers/errors";
import { getProviders, providerStatus, setProviderSelectionForTests } from "../../providers/registry";
import { resolveProviderSelection } from "../../providers/selection";

/**
 * Phase 12 second-store proof (contract §20, acceptance 2): the SAME source represents a fictional second store —
 * "Northwind Test Goods" — purely through configuration (StoreSetting identity + provider selection), while the
 * Bangladesh behaviour Asif Zone relies on stays intact and no historical row changes. Nothing here is a real store;
 * the original settings are restored afterwards.
 */

const STORE_B = {
  storeName: "Northwind Test Goods",
  tagline: "A fictional second store",
  legalName: "Northwind Test Goods Ltd.",
  addressLine: "12 Example Road",
  addressCity: "Chattogram",
  addressRegion: "Chattogram",
  addressPostalCode: "4000",
  addressCountry: "bd",
  legalJurisdiction: "Bangladesh",
  supportHours: "Sat–Thu, 10am–6pm",
};
const IDENTITY_KEYS = ["storeName", "tagline", "legalName", "addressLine", "addressCity", "addressRegion", "addressPostalCode", "addressCountry", "legalJurisdiction", "supportHours"] as const;
const RUN = Date.now().toString().slice(-7);
const phone = `0171${RUN}`; // valid BD mobile, unique per run

let original: Record<string, unknown>;
let historyBefore: string;

/** Every historical business row an identity/provider change could conceivably touch, hashed. */
async function historyHash(): Promise<string> {
  const [orders, items, payments, ledger] = await Promise.all([
    prisma.order.findMany({ orderBy: { id: "asc" }, select: { id: true, orderNumber: true, total: true, status: true, paymentStatus: true, customerPhone: true, updatedAt: true } }),
    prisma.orderItem.findMany({ orderBy: { id: "asc" }, select: { id: true, priceSnapshot: true, productNameSnapshot: true, productIdSnapshot: true } }),
    prisma.payment.findMany({ orderBy: { id: "asc" }, select: { id: true, amount: true, status: true, provider: true } }),
    prisma.refund.findMany({ orderBy: { id: "asc" }, select: { id: true, amount: true, status: true } }),
  ]);
  return createHash("sha256").update(JSON.stringify({ orders, items, payments, ledger })).digest("hex");
}

beforeAll(async () => {
  const current = await getSettings();
  original = Object.fromEntries(IDENTITY_KEYS.map((k) => [k, (current as Record<string, unknown>)[k] ?? null]));
  historyBefore = await historyHash();
});

afterAll(async () => {
  setProviderSelectionForTests(null);
  await updateSettings(updateSettingsSchema.parse(original));
  await prisma.phoneOtp.deleteMany({ where: { phone } });
  await prisma.$disconnect();
});

describe("second store — identity is configuration", () => {
  it("the same code serves Store B's identity once it is saved through the identity owner", async () => {
    await updateSettings(updateSettingsSchema.parse(STORE_B));
    const s = await getSettings();
    expect(s).toMatchObject({ ...STORE_B, addressCountry: "BD" }); // ISO code normalised by the schema

    // Public settings API (what the storefront renders from).
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ storeName: STORE_B.storeName, legalName: STORE_B.legalName, legalJurisdiction: "Bangladesh" });

    // Customer communications.
    const html = await renderEmailLayout({ bodyHtml: "<p>Your order</p>" });
    expect(html).toContain(STORE_B.storeName);
    expect(html).not.toMatch(/asif\s*zone/i);
    const sms = renderOrderSms(DEFAULT_CUSTOMER_SMS_TEMPLATES.PLACED, { orderNumber: "ORD-1", total: 100, storeName: s.storeName, customerName: "C" });
    expect(sms.startsWith(`${STORE_B.storeName}:`)).toBe(true);
  });

  it("the OTP SMS names the configured store (D-13) and Bangladesh phone handling is unchanged", async () => {
    setProviderSelectionForTests(null); // default wiring, like Asif Zone
    sent.length = 0;
    await requestOtp(phone);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(phone);
    expect(sent[0]!.body).toMatch(new RegExp(`^${STORE_B.storeName}: your verification code is \\d{6}\\. It expires in 5 minutes\\.$`));
    // BD rules: same validation and the same international form the SMS gateway receives.
    expect(PHONE_REGEX.test(normalizeBdPhone(`+880${phone.slice(1)}`))).toBe(true);
    expect(toBdInternationalDigits(phone)).toBe(`880${phone.slice(1)}`);
  });
});

describe("second store — provider selection is configuration", () => {
  it("Store B without SMS or courier and with only EPS: capabilities follow the selection, never faking success", async () => {
    const storeB = resolveProviderSelection({ paymentGateways: "eps", sms: "none", email: "", courier: "none", push: "none" });
    expect(storeB.problems).toEqual([]);
    setProviderSelectionForTests(storeB.selection);

    const otp = await requestOtp(`0181${RUN}`).then(() => null, (e: unknown) => e);
    expect(otp).toBeInstanceOf(ProviderNotConfiguredError);
    expect((otp as ProviderNotConfiguredError).statusCode).toBe(400);

    const p = getProviders();
    expect(() => p.payments.forNewSession("SSLCOMMERZ")).toThrow(ProviderNotConfiguredError);
    expect(p.payments.forNewSession("EPS_PG").id).toBe("EPS_PG");
    await expect(p.courier.balance()).rejects.toBeInstanceOf(ProviderNotConfiguredError);

    const status = Object.fromEntries(providerStatus().map((x) => [x.capability, x]));
    expect(status.sms).toMatchObject({ provider: "none", enabled: false });
    expect(status.payments).toMatchObject({ provider: "eps", enabled: true });
    expect(status.email).toMatchObject({ provider: "resend", enabled: true });
    await prisma.phoneOtp.deleteMany({ where: { phone: `0181${RUN}` } });
  });

  it("switching back to the default selection restores Asif Zone's wiring", () => {
    setProviderSelectionForTests(null);
    const p = getProviders();
    expect([p.sms.id, p.courier.id, p.payments.enabled("SSLCOMMERZ"), p.payments.enabled("EPS_PG")]).toEqual(["bulksmsbd", "steadfast", true, true]);
  });
});

describe("second store — history is untouched", () => {
  it("identity and provider changes rewrite no order, order line, payment or refund", async () => {
    expect(await historyHash()).toBe(historyBefore);
  });
});
