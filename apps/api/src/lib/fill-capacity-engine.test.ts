import { describe, it, expect } from "vitest";
import { makeableUnits, sellable, type RecipeLine } from "@clothing-brand/shared";

// docs/STOCK_HUB.md §3 — fill to order: what the approved recipe can still make from the materials orders haven't claimed.
const line = (finishedVariantId: string, materialVariantId: string, qtyPerUnit: number, wastagePct = 0): RecipeLine => ({
  finishedVariantId,
  materialVariantId,
  qtyPerUnit,
  wastagePct,
});
const attar6 = (variantId: string, oil: string, wastagePct = 0) => [line(variantId, oil, 6, wastagePct), line(variantId, "bottle6", 1)];

describe("makeableUnits", () => {
  it("one recipe: the scarcer material decides (650 ml oil, 6 ml a bottle, 166 bottles → 108)", () => {
    const made = makeableUnits({
      recipes: attar6("azhaar6", "oilAzhaar"),
      materialStock: new Map([["oilAzhaar", 650], ["bottle6", 166]]),
      filled: new Map([["azhaar6", 0]]),
    });
    expect(made.get("azhaar6")).toBe(108);
  });

  it("shared bottle: each fragrance reads the whole free stock (the shared limit is enforced at checkout)", () => {
    const made = makeableUnits({
      recipes: [...attar6("azhaar6", "oilAzhaar"), ...attar6("royal6", "oilRoyal")],
      materialStock: new Map([["oilAzhaar", 1000], ["oilRoyal", 1000], ["bottle6", 10]]),
      filled: new Map([["azhaar6", 0], ["royal6", 0]]),
    });
    expect(made.get("azhaar6")).toBe(10);
    expect(made.get("royal6")).toBe(10);
  });

  it("unfilled orders reserve material: stock −10 holds 60 ml of oil (free 590 → 98)", () => {
    const made = makeableUnits({
      recipes: attar6("azhaar6", "oilAzhaar"),
      materialStock: new Map([["oilAzhaar", 650], ["bottle6", 166]]),
      filled: new Map([["azhaar6", -10]]),
    });
    expect(made.get("azhaar6")).toBe(98);
  });

  it("unfilled orders of another fragrance reserve the shared bottle", () => {
    const made = makeableUnits({
      recipes: [...attar6("azhaar6", "oilAzhaar"), ...attar6("royal6", "oilRoyal")],
      materialStock: new Map([["oilAzhaar", 1000], ["oilRoyal", 1000], ["bottle6", 10]]),
      filled: new Map([["azhaar6", 0], ["royal6", -4]]),
    });
    expect(made.get("azhaar6")).toBe(6);
    expect(made.get("royal6")).toBe(6);
  });

  it("wastage rounds down: 3% on 6 ml needs 6.18 ml a bottle (650 → 105)", () => {
    const made = makeableUnits({
      recipes: attar6("azhaar6", "oilAzhaar", 3),
      materialStock: new Map([["oilAzhaar", 650], ["bottle6", 166]]),
      filled: new Map([["azhaar6", 0]]),
    });
    expect(made.get("azhaar6")).toBe(105);
    // 618 ml is exactly 100 bottles — no float drift below the boundary.
    const exact = makeableUnits({ recipes: attar6("a", "oil", 3), materialStock: new Map([["oil", 618], ["bottle6", 500]]), filled: new Map() });
    expect(exact.get("a")).toBe(100);
  });

  it("no recipe → 0, never unlimited", () => {
    const made = makeableUnits({ recipes: [], materialStock: new Map([["oilAzhaar", 650]]), filled: new Map([["azhaar6", 3]]) });
    expect(made.get("azhaar6")).toBe(0);
  });

  it("a material over-reserved by unfilled orders makes nothing (never negative)", () => {
    const made = makeableUnits({
      recipes: attar6("azhaar6", "oilAzhaar"),
      materialStock: new Map([["oilAzhaar", 30], ["bottle6", 166]]),
      filled: new Map([["azhaar6", -10]]),
    });
    expect(made.get("azhaar6")).toBe(0);
  });
});

describe("sellable", () => {
  it("is max(0, stock) + makeable", () => {
    expect(sellable(-4, 7)).toBe(7);
    expect(sellable(3, 5)).toBe(8);
    expect(sellable(0, 0)).toBe(0);
  });
});
