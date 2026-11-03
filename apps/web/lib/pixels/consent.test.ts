import { afterEach, describe, expect, it, vi } from "vitest";

// The store's consent rule (Settings › Integrations › Tracking consent) decides only what an undecided shopper gets;
// an explicit Allow or Decline always wins.

let mode = "";
vi.mock("../runtime-config", () => ({ publicRuntimeConfig: () => ({ trackingConsent: mode }) }));

function browser(stored: string | null) {
  const data = new Map<string, string>(stored ? [["az_tracking_consent_v1", stored]] : []);
  vi.stubGlobal("window", {
    localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) },
  });
}

async function consent() {
  vi.resetModules();
  return import("./consent");
}

afterEach(() => vi.unstubAllGlobals());

describe("tracking consent", () => {
  it("ask (the default): nothing runs until the shopper allows", async () => {
    for (const m of ["", "ask", "anything-else"]) {
      mode = m;
      browser(null);
      const c = await consent();
      expect(c.trackingConsentMode()).toBe("ask");
      expect(c.hasAdTrackingConsent()).toBe(false);
    }
    browser("granted");
    expect((await consent()).hasAdTrackingConsent()).toBe(true);
  });

  it("notice: runs for an undecided shopper, and Decline stops it", async () => {
    mode = "notice";
    browser(null);
    expect((await consent()).hasAdTrackingConsent()).toBe(true);
    browser("denied");
    expect((await consent()).hasAdTrackingConsent()).toBe(false);
    browser("granted");
    expect((await consent()).hasAdTrackingConsent()).toBe(true);
  });

  it("never reports consent on the server", async () => {
    mode = "notice";
    vi.stubGlobal("window", undefined);
    expect((await consent()).hasAdTrackingConsent()).toBe(false);
  });
});
