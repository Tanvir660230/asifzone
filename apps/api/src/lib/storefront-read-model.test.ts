import { describe, it, expect } from "vitest";
import { PRICING_VERSION, productAvailability, variantStockState } from "@clothing-brand/shared";
import { deriveProductReadModel, nextPriceBoundary, type ReadModelOfferFacts } from "../domain/storefront/read-model.derive";
import type { ProductPricingDto } from "../domain/pricing/pricing.service";

// Storefront Read Model (docs/STOREFRONT_READ_MODEL.md) — pure derivations: stock state from canonical inventory
// state, and the projection row from the canonical display pricing. No database.

const NOW = new Date("2026-09-30T12:00:00Z");
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);

function pricing(over: Partial<ProductPricingDto> = {}): ProductPricingDto {
  return {
    currency: "BDT",
    from: 800,
    to: 1200,
    listFrom: 1000,
    compareAt: 1000,
    flash: null,
    variants: {
      v1: { list: 1000, selling: 800, compareAt: 1000, flash: null },
      v2: { list: 1200, selling: 1200, compareAt: null, flash: null },
    },
    ...over,
  };
}
const offer = (over: Partial<ReadModelOfferFacts> = {}): ReadModelOfferFacts => ({ enabled: true, startsAt: at(-60), endsAt: at(60), stockLimit: null, ...over });

describe("stock state (canonical inventory state + D5)", () => {
  it("per variant: untracked is UNLIMITED whatever the stock; tracked is OUT / LOW (≤ threshold) / IN", () => {
    expect(variantStockState(false, 0, 5)).toBe("UNLIMITED");
    expect(variantStockState(false, -3, 5)).toBe("UNLIMITED");
    expect(variantStockState(true, 0, 5)).toBe("OUT_OF_STOCK");
    expect(variantStockState(true, -1, 5)).toBe("OUT_OF_STOCK");
    expect(variantStockState(true, 5, 5)).toBe("LOW_STOCK");
    expect(variantStockState(true, 6, 5)).toBe("IN_STOCK");
  });

  it("per product: only ACTIVE variants count; sellable units, in-stock flag and state", () => {
    const tracked = productAvailability({
      trackInventory: true,
      lowStockThreshold: 5,
      variants: [
        { id: "a", stock: 3 },
        { id: "b", stock: 0 },
        { id: "gone", stock: 99, isActive: false },
      ],
    });
    expect([tracked.state, tracked.inStock, tracked.sellableUnits]).toEqual(["LOW_STOCK", true, 3]);
    expect(Object.keys(tracked.variants).sort()).toEqual(["a", "b"]); // an inactive variant is never offered
    expect(tracked.variants.b).toEqual({ state: "OUT_OF_STOCK", sellable: false, maxQuantity: 0 });
    expect(tracked.variants.a).toEqual({ state: "LOW_STOCK", sellable: true, maxQuantity: 3 });

    const plenty = productAvailability({ trackInventory: true, lowStockThreshold: 5, variants: [{ id: "a", stock: 30 }] });
    expect([plenty.state, plenty.variants.a!.maxQuantity]).toEqual(["IN_STOCK", 20]); // capped at the line maximum

    const none = productAvailability({ trackInventory: true, lowStockThreshold: 5, variants: [{ id: "a", stock: 0 }] });
    expect([none.state, none.inStock]).toEqual(["OUT_OF_STOCK", false]);

    const untracked = productAvailability({ trackInventory: false, lowStockThreshold: 5, variants: [{ id: "a", stock: 0 }] });
    expect([untracked.state, untracked.inStock, untracked.sellableUnits, untracked.variants.a!.sellable]).toEqual(["UNLIMITED", true, null, true]);

    const noActive = productAvailability({ trackInventory: false, lowStockThreshold: 5, variants: [{ id: "a", stock: 5, isActive: false }] });
    expect(noActive.inStock).toBe(false);
  });
});

describe("read-model row derivation", () => {
  it("copies every price from the canonical pricing — never computes one", () => {
    const row = deriveProductReadModel({ productId: "p1", pricing: pricing(), offers: [], sourceHash: "h1", now: NOW });
    expect(row).toMatchObject({
      productId: "p1",
      minSellingPrice: 800,
      maxSellingPrice: 1200,
      listPriceOfMin: 1000,
      hasLiveFlashSale: false,
      currency: "BDT",
      pricingVersion: PRICING_VERSION,
      sourceHash: "h1",
      validUntil: null,
      volatile: false,
      computedAt: NOW,
    });
  });

  it("a flash-priced variant marks the row as flash-priced even when it isn't the cheapest", () => {
    const p = pricing({ variants: { v1: { list: 1000, selling: 800, compareAt: null, flash: null }, v2: { list: 2000, selling: 1600, compareAt: 2000, flash: { flashSaleId: "s", name: "S", endsAt: at(60).toISOString(), discountType: "PERCENTAGE", discountValue: 20, remaining: null } } } });
    expect(deriveProductReadModel({ productId: "p", pricing: p, offers: [offer()], sourceHash: "h", now: NOW }).hasLiveFlashSale).toBe(true);
  });

  it("validUntil is the next clock boundary: a scheduled start, or 1 ms after a live sale's end; disabled sales don't count", () => {
    expect(nextPriceBoundary([offer({ startsAt: at(30), endsAt: at(90) })], NOW)).toEqual(at(30));
    expect(nextPriceBoundary([offer({ endsAt: at(45) })], NOW)).toEqual(new Date(at(45).getTime() + 1));
    expect(nextPriceBoundary([offer({ endsAt: at(45) }), offer({ startsAt: at(10), endsAt: at(20) })], NOW)).toEqual(at(10));
    expect(nextPriceBoundary([offer({ enabled: false, startsAt: at(5), endsAt: at(10) })], NOW)).toBeNull();
    expect(nextPriceBoundary([offer({ startsAt: at(-90), endsAt: at(-30) })], NOW)).toBeNull(); // expired
    expect(nextPriceBoundary([], NOW)).toBeNull();
  });

  it("a live, quantity-limited offer makes the row volatile (D4: any order can change the price)", () => {
    const d = (o: ReadModelOfferFacts[]) => deriveProductReadModel({ productId: "p", pricing: pricing(), offers: o, sourceHash: "h", now: NOW });
    expect(d([offer({ stockLimit: 5 })]).volatile).toBe(true);
    expect(d([offer({ stockLimit: null })]).volatile).toBe(false);
    expect(d([offer({ stockLimit: 5, startsAt: at(10), endsAt: at(20) })]).volatile).toBe(false); // not live yet
    expect(d([offer({ stockLimit: 5, enabled: false })]).volatile).toBe(false);
  });

  it("is deterministic: same inputs, same row", () => {
    const input = { productId: "p", pricing: pricing(), offers: [offer({ stockLimit: 3 }), offer({ startsAt: at(5) })], sourceHash: "h", now: NOW };
    expect(JSON.stringify(deriveProductReadModel(input))).toBe(JSON.stringify(deriveProductReadModel(structuredClone(input))));
  });
});
