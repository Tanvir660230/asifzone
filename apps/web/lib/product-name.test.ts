import { describe, expect, it } from "vitest";
import { splitStyleColour } from "./product-name";

describe("splitStyleColour", () => {
  it("splits on an en dash", () => {
    expect(splitStyleColour("Haven Sleeveless Jacket – Light Ash")).toEqual({ style: "Haven Sleeveless Jacket", colour: "Light Ash" });
  });

  it("splits on a spaced hyphen or em dash", () => {
    expect(splitStyleColour("Haven Full-Sleeve Jacket - Black")).toEqual({ style: "Haven Full-Sleeve Jacket", colour: "Black" });
    expect(splitStyleColour("Haven Jacket — Navy")).toEqual({ style: "Haven Jacket", colour: "Navy" });
  });

  it("leaves a name without a separator whole (a hyphen inside a word is not one)", () => {
    expect(splitStyleColour("Haven Full-Sleeve Jacket")).toEqual({ style: "Haven Full-Sleeve Jacket", colour: null });
  });

  it("splits on the last separator and trims", () => {
    expect(splitStyleColour("  Coat – Long – Dark Ash  ")).toEqual({ style: "Coat – Long", colour: "Dark Ash" });
  });

  it("keeps the name whole when either side would be empty", () => {
    expect(splitStyleColour("Jacket – ")).toEqual({ style: "Jacket –", colour: null });
    expect(splitStyleColour(" – Black")).toEqual({ style: "– Black", colour: null });
  });
});
