import { describe, it, expect } from "vitest";
import {
  DISPLAY_LOCALE,
  SUPPORTED_CURRENCIES,
  currencySymbol,
  formatDate,
  formatDateTime,
  formatMoney,
  isSupportedCurrency,
  updateSettingsSchema,
} from "@clothing-brand/shared";
import { currencyChangeBlocked } from "../modules/settings/settings.service";

// Phase 7 (docs/PHASE_7_AUDIT.md): display derives from the configured currency/timezone; the store currency is validated
// and locked once orders exist.

describe("configuration-derived formatting", () => {
  it("money uses the given currency's own symbol — nothing is BDT-specific", () => {
    expect(formatMoney(1500, "BDT")).toBe("৳1,500");
    expect(formatMoney(1500.25, "USD")).toBe("$1,500.25");
    expect(formatMoney(99.9, "EUR")).toBe("€99.9");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
    expect([currencySymbol("BDT"), currencySymbol("USD")]).toEqual(["৳", "$"]);
    expect(DISPLAY_LOCALE).toBe("en-BD"); // the one declared display locale
  });

  it("dates follow the given timezone, not the process or browser timezone", () => {
    const instant = new Date("2026-09-30T18:30:00Z"); // 00:30 on Oct 1 in Dhaka, still Sep 30 in UTC
    expect(formatDateTime(instant, "Asia/Dhaka")).toBe("1 Oct 2026, 00:30");
    expect(formatDateTime(instant, "UTC")).toBe("30 Sept 2026, 18:30");
    expect(formatDate(instant, "America/New_York")).toBe("30 Sept 2026");
  });
});

describe("store currency validity and lock (D-8, P6-4)", () => {
  it("the settings writer accepts only currencies the money engine represents exactly", () => {
    for (const code of SUPPORTED_CURRENCIES) expect(updateSettingsSchema.safeParse({ currency: code }).success).toBe(true);
    for (const bad of ["Taka", "৳", "bdt", "XYZ", "KWD", ""]) {
      expect(updateSettingsSchema.safeParse({ currency: bad }).success, bad).toBe(false);
      expect(isSupportedCurrency(bad)).toBe(false);
    }
  });

  it("before the first order the currency may be configured; after it, a change is blocked; the same value is never a change", () => {
    expect(currencyChangeBlocked("USD", "BDT", false)).toBe(false);
    expect(currencyChangeBlocked("USD", "BDT", true)).toBe(true);
    expect(currencyChangeBlocked("BDT", "BDT", true)).toBe(false);
    expect(currencyChangeBlocked(undefined, "BDT", true)).toBe(false);
  });
});
