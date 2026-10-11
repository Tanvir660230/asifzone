import { describe, expect, it } from "vitest";
import { currentInstallationProviderConfig, installationProviderConfigFrom, resolveInstallationProviders } from "./registry";
import { ProviderConfigError } from "./errors";

// Phase 1D: Installation → provider configuration → the existing registry. Each installation's providers come from its
// own environment; one installation's credentials never make another's capability available.

const ASIF = {
  NODE_ENV: "production",
  SMS_PROVIDER: "bulksmsbd",
  COURIER_PROVIDER: "steadfast",
  PAYMENT_GATEWAYS: "sslcommerz",
  BULKSMSBD_API_KEY: "k",
  BULKSMSBD_SENDER_ID: "s",
  STEADFAST_API_KEY: "a",
  STEADFAST_SECRET_KEY: "b",
  SSLCOMMERZ_STORE_ID: "id",
  SSLCOMMERZ_STORE_PASSWORD: "pw",
};
const CLIENT_B = {
  NODE_ENV: "production",
  SMS_PROVIDER: "none",
  COURIER_PROVIDER: "none",
  PAYMENT_GATEWAYS: "eps",
  EPS_USERNAME: "u",
  EPS_PASSWORD: "p",
  EPS_HASH_KEY: "h",
  EPS_MERCHANT_ID: "m",
  EPS_STORE_ID: "st",
};

describe("installation-scoped provider configuration", () => {
  it("resolves different providers for different installations through the same registry", () => {
    const a = resolveInstallationProviders(installationProviderConfigFrom(ASIF, "asifzone"));
    const b = resolveInstallationProviders(installationProviderConfigFrom(CLIENT_B, "client-b"));

    expect(a.installId).toBe("asifzone");
    expect(a.selection).toMatchObject({ sms: "bulksmsbd", courier: "steadfast", paymentGateways: ["sslcommerz"] });
    expect(a.capabilities).toMatchObject({ sms: true, courier: true, payments: { SSLCOMMERZ: true, EPS_PG: false } });
    expect(a.providers.courier.id).toBe("steadfast");

    expect(b.installId).toBe("client-b");
    expect(b.selection).toMatchObject({ sms: "none", courier: "none", paymentGateways: ["eps"] });
    expect(b.capabilities).toMatchObject({ sms: false, courier: false, payments: { SSLCOMMERZ: false, EPS_PG: true } });
    expect(b.providers.courier.id).toBe("none");
    expect(b.providers.payments.enabled("SSLCOMMERZ")).toBe(false);
  });

  it("judges credentials by the installation's own environment only", () => {
    // Client B selects Steadfast but has no Steadfast credentials of its own — Asif's do not count.
    const config = installationProviderConfigFrom({ ...CLIENT_B, COURIER_PROVIDER: "steadfast" }, "client-b");
    expect(() => resolveInstallationProviders(config)).toThrow(ProviderConfigError);
  });

  it("describes this process's installation the same way", () => {
    const current = currentInstallationProviderConfig();
    expect(current.installId).toBe("test");
    const resolved = resolveInstallationProviders(current);
    expect(resolved.installId).toBe("test");
    expect(resolved.providers.sms).toBeDefined();
  });
});
