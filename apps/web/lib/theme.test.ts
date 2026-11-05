import { describe, expect, it } from "vitest";
import tokens from "@clothing-brand/ui-tokens";
import { themeColorHex } from "./theme";

const hex = (channels: string) => `#${channels.split(" ").map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`;

describe("themeColorHex", () => {
  it("follows the base var() chain to a hex literal", () => {
    // canvas -> var(--color-cream-100) -> "r g b"
    expect(themeColorHex("default", "canvas")).toBe(hex(tokens.cssVariables["--color-cream-100"]!));
  });

  it("prefers the theme's own values", () => {
    const override = tokens.themes.tahafi!.cssVariables["--color-cream-100"]!;
    expect(themeColorHex("tahafi", "canvas")).toBe(hex(override));
  });

  it("paints an always-dark store in its dark colours", () => {
    expect(themeColorHex("nasihamart", "canvas")).toBe("#14110e");
  });

  it("falls back to white for an unknown colour", () => {
    expect(themeColorHex("default", "no-such-colour")).toBe("#ffffff");
  });
});
