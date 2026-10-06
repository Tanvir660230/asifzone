import { describe, it, expect } from "vitest";
import { assertPaymentGatewayMode } from "./provider-guard";

// P0-05: a live payment gateway is a production-only setting, whatever credentials a dev/test/demo .env holds.
describe("assertPaymentGatewayMode", () => {
  const sandbox = { epsLive: false, sslcommerzLive: false };

  it("allows the sandbox gateways in every environment", () => {
    for (const nodeEnv of ["development", "test", "staging", "production"]) expect(() => assertPaymentGatewayMode(nodeEnv, sandbox)).not.toThrow();
  });

  it("allows live gateways only with NODE_ENV=production", () => {
    expect(() => assertPaymentGatewayMode("production", { epsLive: true, sslcommerzLive: true })).not.toThrow();
  });

  it("refuses live EPS or SSLCommerz outside production, naming the setting", () => {
    for (const nodeEnv of ["development", "test", "staging", ""]) {
      expect(() => assertPaymentGatewayMode(nodeEnv, { epsLive: true, sslcommerzLive: false })).toThrow(/EPS_SANDBOX=false/);
      expect(() => assertPaymentGatewayMode(nodeEnv, { epsLive: false, sslcommerzLive: true })).toThrow(/SSLCOMMERZ_IS_LIVE=true/);
    }
  });
});
