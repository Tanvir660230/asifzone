import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./sms/bulksmsbd", () => ({ sendSms: vi.fn(async () => undefined) }));
vi.mock("./email/resend", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("./push/web-push", () => ({ sendPush: vi.fn(async () => undefined) }));
vi.mock("./courier/steadfast", () => ({
  createSteadfastConsignment: vi.fn(async () => ({ consignment_id: 1, invoice: "I", tracking_code: "T", tracking_link: "L", status: "in_review" })),
  createBulkSteadfastConsignments: vi.fn(async () => []),
  getSteadfastStatusByConsignmentId: vi.fn(async () => "in_review"),
  getSteadfastBalance: vi.fn(async () => 42),
  getSteadfastFraudCheck: vi.fn(async () => ({ deliveryRatio: 1 })),
}));
vi.mock("./payment/sslcommerz", () => ({
  initSslcommerzSession: vi.fn(async () => ({ gatewayUrl: "https://ssl.example/pay", sessionKey: "SK1" })),
  validateSslcommerzTransaction: vi.fn(async () => ({ tranId: "T", amount: 1, status: "VALID" })),
}));
vi.mock("./payment/eps", () => ({
  initEpsSession: vi.fn(async () => ({ gatewayUrl: "https://eps.example/pay", transactionId: "E1" })),
  verifyEpsTransaction: vi.fn(async () => ({ merchantTransactionId: "M", epsTransactionId: "E", amount: 1, status: "Success" })),
}));

import { env } from "../config/env";
import * as bulksmsbd from "./sms/bulksmsbd";
import * as steadfast from "./courier/steadfast";
import * as sslcommerz from "./payment/sslcommerz";
import * as eps from "./payment/eps";
import { gatewayIdForPaymentMethod } from "./capabilities";
import { ProviderNotConfiguredError } from "./errors";
import { buildProviders, capabilities, getProviders, providerStatus, setProviderSelectionForTests } from "./registry";
import { resolveProviderSelection, type RawProviderSelection } from "./selection";

const UNSET: RawProviderSelection = { paymentGateways: "", sms: "", email: "", courier: "", push: "" };
const sel = (raw: Partial<RawProviderSelection>) => resolveProviderSelection({ ...UNSET, ...raw }).selection;
const params = { orderNumber: "ORD-1", amount: 100, customerName: "N", customerEmail: null, customerPhone: "01700000000", customerAddress: "A" };

afterEach(() => {
  setProviderSelectionForTests(null);
  vi.clearAllMocks();
});

describe("provider registry — default wiring (unchanged behaviour)", () => {
  it("routes each capability to today's implementation", async () => {
    const p = getProviders();
    expect([p.sms.id, p.email.id, p.push.id, p.courier.id, p.serverEvents.id]).toEqual(["bulksmsbd", "resend", "webpush", "steadfast", "meta"]);
    await p.sms.send({ to: "01700000000", body: "hi" });
    expect(bulksmsbd.sendSms).toHaveBeenCalledWith({ to: "01700000000", body: "hi" });
    await p.courier.createShipment({ invoice: "I", recipientName: "R", recipientPhone: "01700000000", recipientAddress: "A", codAmount: 1 });
    expect(steadfast.createSteadfastConsignment).toHaveBeenCalledTimes(1);
    expect(await p.courier.balance()).toBe(42);
  });

  it("both gateways are enabled by default and map their own session ids, exactly as the old inline ternary did", async () => {
    const p = getProviders().payments;
    expect(p.enabled("SSLCOMMERZ") && p.enabled("EPS_PG")).toBe(true);
    expect(await p.forNewSession("SSLCOMMERZ").createSession(params)).toEqual({ gatewayUrl: "https://ssl.example/pay", providerTransactionId: "SK1" });
    expect(await p.forNewSession("EPS_PG").createSession(params)).toEqual({ gatewayUrl: "https://eps.example/pay", providerTransactionId: "E1" });
    expect(sslcommerz.initSslcommerzSession).toHaveBeenCalledWith(params);
    expect(eps.initEpsSession).toHaveBeenCalledWith(params);
  });

  it("gatewayIdForPaymentMethod keeps the old mapping (EPS_PG → EPS, anything else online → SSLCommerz)", () => {
    expect(gatewayIdForPaymentMethod("EPS_PG")).toBe("EPS_PG");
    expect(gatewayIdForPaymentMethod("SSLCOMMERZ")).toBe("SSLCOMMERZ");
  });
});

describe("provider registry — explicit 'none' never fakes success", () => {
  it("a disabled capability rejects with a non-retryable 400 naming the variable, and never calls the provider", async () => {
    setProviderSelectionForTests(sel({ sms: "none", email: "none", push: "none", courier: "none" }));
    const p = getProviders();
    const cases: Array<[Promise<unknown>, string]> = [
      [p.sms.send({ to: "01700000000", body: "x" }), "SMS_PROVIDER"],
      [p.email.send({ to: "a@b.c", subject: "s", html: "h" }), "EMAIL_PROVIDER"],
      [p.push.send({ subscription: { endpoint: "e", p256dh: "p", auth: "a" }, title: "t", body: "b" }), "PUSH_PROVIDER"],
      [p.courier.createShipment({ invoice: "I", recipientName: "R", recipientPhone: "0", recipientAddress: "A", codAmount: 1 }), "COURIER_PROVIDER"],
      [p.courier.deliveryScore("01700000000"), "COURIER_PROVIDER"],
    ];
    for (const [promise, envVar] of cases) {
      const err = await promise.then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect((err as ProviderNotConfiguredError).statusCode).toBe(400);
      expect((err as ProviderNotConfiguredError).retryable).toBe(false);
      expect((err as Error).message).toContain(envVar);
    }
    expect(bulksmsbd.sendSms).not.toHaveBeenCalled();
    expect(steadfast.createSteadfastConsignment).not.toHaveBeenCalled();
    expect(steadfast.getSteadfastFraudCheck).not.toHaveBeenCalled();
  });

  it("a gateway left out of PAYMENT_GATEWAYS cannot start a new session, but its callbacks still verify", async () => {
    setProviderSelectionForTests(sel({ paymentGateways: "eps" }));
    const p = getProviders().payments;
    expect(p.enabled("SSLCOMMERZ")).toBe(false);
    expect(() => p.forNewSession("SSLCOMMERZ")).toThrow(ProviderNotConfiguredError);
    expect(sslcommerz.initSslcommerzSession).not.toHaveBeenCalled();
    // A session opened before the change still settles:
    await p.adapter("SSLCOMMERZ").validate("VAL1");
    expect(sslcommerz.validateSslcommerzTransaction).toHaveBeenCalledWith("VAL1");
    expect(p.forNewSession("EPS_PG").id).toBe("EPS_PG");
  });

  it("PAYMENT_GATEWAYS=none disables every online gateway for new sessions", () => {
    const p = buildProviders(sel({ paymentGateways: "none" })).payments;
    expect(() => p.forNewSession("EPS_PG")).toThrow(/PAYMENT_GATEWAYS/);
    expect(() => p.forNewSession("SSLCOMMERZ")).toThrow(/PAYMENT_GATEWAYS/);
  });
});

describe("provider status — booleans only", () => {
  it("reports provider names and presence flags, never a credential value", () => {
    const sentinel = { apiKey: "SENTINEL-SMS-KEY-9f8e7d", senderId: "SENTINEL-SENDER" };
    const before = { ...env.bulkSmsBd };
    Object.assign(env.bulkSmsBd, sentinel);
    try {
      setProviderSelectionForTests(sel({ sms: "bulksmsbd", courier: "none" }));
      const status = providerStatus();
      const json = JSON.stringify(status);
      expect(json).not.toContain(sentinel.apiKey);
      expect(json).not.toContain(sentinel.senderId);
      expect(status.find((s) => s.capability === "sms")).toEqual({ capability: "sms", provider: "bulksmsbd", enabled: true, credentialsPresent: true, available: true, missingCredentials: [] });
      expect(status.find((s) => s.capability === "courier")).toEqual({ capability: "courier", provider: "none", enabled: false, credentialsPresent: false, available: false, missingCredentials: [] });
      for (const entry of status) expect(Object.keys(entry).sort()).toEqual(["available", "capability", "credentialsPresent", "enabled", "missingCredentials", "provider"]);
    } finally {
      Object.assign(env.bulkSmsBd, before);
    }
  });
});

describe("provider availability (D-4) — what the UI may offer", () => {
  it("a selected provider with missing credentials is unavailable, and the status names the missing variables (never values)", () => {
    const before = { ...env.steadfast };
    Object.assign(env.steadfast, { apiKey: "SENTINEL-COURIER-KEY-31f", secretKey: "" });
    try {
      setProviderSelectionForTests(sel({ courier: "steadfast" }));
      expect(capabilities().courier).toBe(false);
      const courier = providerStatus().find((s) => s.capability === "courier")!;
      expect(courier).toMatchObject({ provider: "steadfast", enabled: true, credentialsPresent: false, available: false, missingCredentials: ["STEADFAST_SECRET_KEY"] });
      expect(JSON.stringify(providerStatus())).not.toContain("SENTINEL-COURIER-KEY-31f");
      Object.assign(env.steadfast, { secretKey: "SENTINEL-COURIER-SECRET-9" });
      expect(capabilities().courier).toBe(true);
      expect(JSON.stringify({ c: capabilities(), s: providerStatus() })).not.toMatch(/SENTINEL/);
    } finally {
      Object.assign(env.steadfast, before);
    }
  });

  it("an explicitly disabled capability or a gateway left out of PAYMENT_GATEWAYS is unavailable even with credentials", () => {
    const before = { sms: { ...env.bulkSmsBd }, ssl: { ...env.sslcommerz } };
    Object.assign(env.bulkSmsBd, { apiKey: "k", senderId: "s" });
    Object.assign(env.sslcommerz, { storeId: "id", storePassword: "pw" });
    try {
      setProviderSelectionForTests(sel({ sms: "none", paymentGateways: "eps" }));
      expect(capabilities()).toMatchObject({ sms: false, payments: { SSLCOMMERZ: false } });
      setProviderSelectionForTests(sel({}));
      expect(capabilities()).toMatchObject({ sms: true, payments: { SSLCOMMERZ: true } });
    } finally {
      Object.assign(env.bulkSmsBd, before.sms);
      Object.assign(env.sslcommerz, before.ssl);
    }
  });

  it("capabilities() is booleans only", () => {
    const c = capabilities();
    expect(Object.keys(c).sort()).toEqual(["courier", "email", "payments", "push", "sms"]);
    for (const v of [c.sms, c.email, c.push, c.courier, c.payments.SSLCOMMERZ, c.payments.EPS_PG]) expect(typeof v).toBe("boolean");
  });
});
