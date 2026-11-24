import { describe, expect, it } from "vitest";
import { policyHighlights, returnPolicySentence, shippingAndReturnsText, storePolicy, type PolicySettings } from "@clothing-brand/shared";

// Phase 5: store policy is store configuration (StoreSetting), never storefront code.

/** What the 20261010100000_store_policy migration backfills into an existing store — what Asif Zone has always stated. */
const EXISTING_STORE: PolicySettings = {
  returnWindowDays: 7,
  returnPolicyKind: "RETURN",
  returnConditions: "Unworn items in original condition with tags attached",
  handlingDaysMin: 1,
  handlingDaysMax: 2,
  codEnabled: true,
};
const NEW_STORE: PolicySettings = { returnWindowDays: null, returnPolicyKind: "RETURN", returnConditions: null, handlingDaysMin: null, handlingDaysMax: null, codEnabled: false };

describe("store policy", () => {
  it("states exactly what the existing store's product page always said", () => {
    expect(policyHighlights(storePolicy(EXISTING_STORE)).map((l) => l.label)).toEqual([
      "Nationwide delivery, 1–5 business days",
      "7-day easy returns",
      "Cash on Delivery available",
    ]);
    expect(shippingAndReturnsText(storePolicy(EXISTING_STORE))).toBe(
      "Dispatched within 1–2 business days. Inside Dhaka: 1–2 days, outside Dhaka: 2–5 days. " +
        "Unworn items in original condition with tags attached can be returned or exchanged within 7 days of delivery.",
    );
  });

  it("claims nothing a new store hasn't set", () => {
    const policy = storePolicy(NEW_STORE);
    expect(policy.returns).toBeNull();
    expect(policy.handlingDays).toBeNull();
    expect(returnPolicySentence(policy)).toBeNull();
    expect(policyHighlights(policy).map((l) => l.kind)).toEqual(["delivery"]);
    expect(shippingAndReturnsText(policy)).toBe("Inside Dhaka: 1–2 days, outside Dhaka: 2–5 days.");
  });

  it("an exchange-only store promises an exchange, never a return window", () => {
    const policy = storePolicy({ ...EXISTING_STORE, returnPolicyKind: "EXCHANGE" });
    expect(policy.returns).toBeNull();
    expect(policy.exchange).not.toBeNull();
    expect(policyHighlights(policy).map((l) => l.label)).toContain("Easy size exchange");
    expect(returnPolicySentence(policy)).toMatch(/exchanged/);
    expect(returnPolicySentence(policy)).not.toMatch(/return/i);
  });

  it("follows each store's own settings — two stores, two policies, no code change", () => {
    const other = storePolicy({ ...NEW_STORE, returnWindowDays: 14, returnConditions: "Unopened items", handlingDaysMin: 2, handlingDaysMax: 2, codEnabled: true });
    expect(policyHighlights(other).map((l) => l.label)).toEqual(["Nationwide delivery, 1–5 business days", "14-day easy returns", "Cash on Delivery available"]);
    expect(returnPolicySentence(other)).toBe("Unopened items can be returned or exchanged within 14 days of delivery.");
    expect(shippingAndReturnsText(other)).toMatch(/^Dispatched within 2 business days\./);
    // Only Cash on Delivery's switch decides that line — it can never claim a disabled payment method.
    expect(policyHighlights(storePolicy({ ...EXISTING_STORE, codEnabled: false })).some((l) => l.kind === "cashOnDelivery")).toBe(false);
  });
});
