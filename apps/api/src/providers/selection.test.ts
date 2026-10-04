import { describe, it, expect } from "vitest";
import { ProviderConfigError } from "./errors";
import { credentialProblems, DEFAULT_SELECTION, REQUIRED_CREDENTIALS, resolveProviderSelection, validateProviderSelection, type RawProviderSelection } from "./selection";

// Phase 12 W5 — provider selection decision logic (contract §15, D-4b). Each `it` is written so that the obvious mutation
// of selection.ts (wrong default, blank treated as "none", unknown accepted, credentials checked outside production or
// for implicit defaults, values leaked into messages) fails it.

const UNSET: RawProviderSelection = { paymentGateways: "", sms: "", email: "", courier: "", push: "" };
const none = () => false;
const all = () => true;

describe("provider selection — defaults reproduce pre-Phase-12 wiring", () => {
  it("unset/blank variables select every existing integration, exactly as before", () => {
    const { selection, problems } = resolveProviderSelection(UNSET);
    expect(problems).toEqual([]);
    expect(selection).toMatchObject({ sms: "bulksmsbd", email: "resend", courier: "steadfast", push: "webpush", paymentGateways: ["sslcommerz", "eps"] });
    expect(Object.values(selection.explicit).every((v) => v === false)).toBe(true);
    expect(DEFAULT_SELECTION.paymentGateways).toEqual(["sslcommerz", "eps"]);
  });

  it("whitespace counts as unset (docker compose passes unset variables as empty strings)", () => {
    const { selection } = resolveProviderSelection({ paymentGateways: "  ", sms: " ", email: "", courier: "\t", push: "" });
    expect(selection.sms).toBe("bulksmsbd");
    expect(selection.paymentGateways).toEqual(["sslcommerz", "eps"]);
    expect(selection.explicit.sms).toBe(false);
  });

  it("an unchanged production env with blank credentials still starts (implicit defaults are never credential-checked)", () => {
    expect(() => validateProviderSelection(UNSET, none, "production")).not.toThrow();
  });
});

describe("provider selection — explicit choices", () => {
  it("'none' disables a capability explicitly; values are case-insensitive", () => {
    const { selection, problems } = resolveProviderSelection({ paymentGateways: "NONE", sms: "None", email: "none", courier: "none", push: "none" });
    expect(problems).toEqual([]);
    expect(selection).toMatchObject({ sms: "none", email: "none", courier: "none", push: "none", paymentGateways: [] });
    expect(selection.explicit).toEqual({ sms: true, email: true, courier: true, push: true, paymentGateways: true });
  });

  it("PAYMENT_GATEWAYS is a de-duplicated subset in the given order", () => {
    expect(resolveProviderSelection({ ...UNSET, paymentGateways: "eps" }).selection.paymentGateways).toEqual(["eps"]);
    expect(resolveProviderSelection({ ...UNSET, paymentGateways: "eps, sslcommerz,eps" }).selection.paymentGateways).toEqual(["eps", "sslcommerz"]);
  });

  it("unknown provider names are rejected in every environment, naming the variable and the allowed values", () => {
    for (const nodeEnv of ["development", "test", "production"]) {
      expect(() => validateProviderSelection({ ...UNSET, sms: "twilio" }, all, nodeEnv)).toThrow(ProviderConfigError);
      expect(() => validateProviderSelection({ ...UNSET, paymentGateways: "bkash" }, all, nodeEnv)).toThrow(/PAYMENT_GATEWAYS/);
      expect(() => validateProviderSelection({ ...UNSET, paymentGateways: "eps,bkash" }, all, nodeEnv)).toThrow(/sslcommerz, eps/);
      expect(() => validateProviderSelection({ ...UNSET, paymentGateways: "," }, all, nodeEnv)).toThrow(/PAYMENT_GATEWAYS/);
    }
    try {
      validateProviderSelection({ ...UNSET, courier: "pathao", email: "sendgrid" }, all, "test");
    } catch (err) {
      expect((err as ProviderConfigError).problems).toEqual([
        "EMAIL_PROVIDER must be one of: resend, none",
        "COURIER_PROVIDER must be one of: steadfast, none",
      ]);
    }
  });
});

describe("provider selection — credential validation", () => {
  it("in production an explicitly selected provider needs every one of its credentials", () => {
    const has = (v: string) => v !== "STEADFAST_SECRET_KEY";
    const { selection } = resolveProviderSelection({ ...UNSET, courier: "steadfast" });
    expect(credentialProblems(selection, has, "production")).toEqual(['COURIER_PROVIDER selects "steadfast" but STEADFAST_SECRET_KEY is not set']);
    expect(() => validateProviderSelection({ ...UNSET, courier: "steadfast" }, has, "production")).toThrow(ProviderConfigError);
  });

  it("each explicitly selected gateway is checked separately", () => {
    const { selection } = resolveProviderSelection({ ...UNSET, paymentGateways: "sslcommerz,eps" });
    const problems = credentialProblems(selection, (v) => v.startsWith("SSLCOMMERZ_"), "production");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^PAYMENT_GATEWAYS selects "eps" but EPS_USERNAME, EPS_PASSWORD, EPS_HASH_KEY, EPS_MERCHANT_ID, EPS_STORE_ID are not set$/);
  });

  it("outside production missing credentials are allowed (the implementations keep their dev fallbacks)", () => {
    const { selection } = resolveProviderSelection({ ...UNSET, sms: "bulksmsbd", email: "resend" });
    expect(credentialProblems(selection, none, "development")).toEqual([]);
    expect(credentialProblems(selection, none, "test")).toEqual([]);
  });

  it("an explicitly disabled capability requires no credentials", () => {
    expect(() => validateProviderSelection({ paymentGateways: "none", sms: "none", email: "none", courier: "none", push: "none" }, none, "production")).not.toThrow();
  });

  it("problems name variables only — never a credential value", () => {
    const secret = "sk_live_DO_NOT_PRINT_123";
    const hasValue = (v: string) => (v === "BULKSMSBD_API_KEY" ? Boolean(secret) : false);
    try {
      validateProviderSelection({ ...UNSET, sms: "bulksmsbd", push: "webpush" }, hasValue, "production");
      throw new Error("expected a ProviderConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderConfigError);
      expect((err as Error).message).not.toContain(secret);
      expect((err as Error).message).toMatch(/BULKSMSBD_SENDER_ID/);
      expect((err as Error).message).toMatch(/WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY/);
    }
  });

  it("every selectable provider declares its required credentials", () => {
    expect(Object.keys(REQUIRED_CREDENTIALS).sort()).toEqual(["bulksmsbd", "eps", "resend", "sslcommerz", "steadfast", "webpush"]);
  });
});
