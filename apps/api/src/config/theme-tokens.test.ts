import { describe, expect, it } from "vitest";
import tokens from "@clothing-brand/ui-tokens";

// Brand themes (packages/ui-tokens): one component tree, many stores — a theme may only re-value tokens.

/** Tokens deliberately left undefined at :root (the property inherits, as before they existed); a theme may set them. */
const OPT_IN_TOKENS = new Set(["--font-display-weight", "--font-display-tracking", "--eyebrow-weight", "--hero-cta-text"]);

function channels(value: string): [number, number, number] {
  const parts = value.split(" ").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) throw new Error(`not RGB channels: ${value}`);
  return parts as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]) {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A palette step's channels as a theme renders it: the theme's override, else the base value. */
function step(theme: string, name: string, scope: "root" | "band" = "root"): [number, number, number] {
  const t = tokens.themes[theme]!;
  const value = (scope === "band" ? t.bandVariables[`--color-${name}`] : undefined) ?? t.cssVariables[`--color-${name}`] ?? tokens.cssVariables[`--color-${name}`];
  return channels(value!);
}

describe("brand themes", () => {
  it("keeps the default theme exactly the base tokens", () => {
    expect(tokens.DEFAULT_THEME).toBe("default");
    expect(tokens.themes.default!.cssVariables).toEqual({});
    expect(tokens.themes.default!.bandVariables).toEqual({});
  });

  it("only re-values tokens that exist (or are documented opt-ins) — a theme never invents styling", () => {
    for (const [id, theme] of Object.entries(tokens.themes)) {
      for (const name of [...Object.keys(theme.cssVariables), ...Object.keys(theme.bandVariables)]) {
        expect(name in tokens.cssVariables || OPT_IN_TOKENS.has(name), `${id}: ${name}`).toBe(true);
      }
    }
  });

  it("gives Nasihamart a sans title face and its own palette", () => {
    const n = tokens.themes.nasihamart!.cssVariables;
    expect(n["--font-display-family"]).toBe("var(--font-sans)");
    expect(n["--caps-transform"]).toBe("none");
    expect(n["--color-cream-100"]).not.toBe(tokens.cssVariables["--color-cream-100"]);
  });

  it("keeps Nasihamart's text legible (WCAG AA 4.5:1) on its surfaces, inside the light band too", () => {
    const canvas = step("nasihamart", "cream-100");
    const surface = step("nasihamart", "cream-50");
    for (const text of ["ink-900", "ink-700", "ink-500", "ink-400"]) {
      expect(contrast(step("nasihamart", text), canvas), `${text} on canvas`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(step("nasihamart", text), surface), `${text} on surface`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast([255, 255, 255], step("nasihamart", "sale-500")), "white on sale badge").toBeGreaterThanOrEqual(4.5);
    // In the band, the section is painted ink-950 and its text uses the dark-palette names (cream-50, ink-300, ink-400).
    const band = step("nasihamart", "ink-950", "band");
    for (const text of ["cream-50", "cream-200", "ink-300", "ink-400"]) {
      expect(contrast(step("nasihamart", text, "band"), band), `band ${text}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
