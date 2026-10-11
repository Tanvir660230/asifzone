import { describe, expect, it } from "vitest";
import tokens from "@clothing-brand/ui-tokens";

// Brand themes (packages/ui-tokens): one component tree, many stores — a theme may only re-value tokens.

/** Tokens deliberately left undefined at :root (the property inherits, as before they existed); a theme may set them. */
const OPT_IN_TOKENS = new Set([
  "--font-display-weight",
  "--font-display-tracking",
  "--font-display-stretch",
  "--product-title-stretch",
  "--eyebrow-weight",
  "--hero-cta-text",
  "--band-accent",
]);

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

/** A palette step's channels as a theme renders it: inside a light band / a dark band, else at the root, else the base. */
function step(theme: string, name: string, scope: "root" | "band" | "dark" = "root"): [number, number, number] {
  const t = tokens.themes[theme]!;
  const scoped = scope === "band" ? t.bandVariables : scope === "dark" ? t.darkBandVariables : {};
  const value = scoped[`--color-${name}`] ?? t.cssVariables[`--color-${name}`] ?? tokens.cssVariables[`--color-${name}`];
  return channels(value!);
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

describe("brand themes", () => {
  it("keeps the default theme exactly the base tokens", () => {
    expect(tokens.DEFAULT_THEME).toBe("default");
    expect(tokens.themes.default!.cssVariables).toEqual({});
    expect(tokens.themes.default!.bandVariables).toEqual({});
    expect(tokens.themes.default!.darkBandVariables).toEqual({});
  });

  it("only re-values tokens that exist (or are documented opt-ins) — a theme never invents styling", () => {
    for (const [id, theme] of Object.entries(tokens.themes)) {
      for (const name of [...Object.keys(theme.cssVariables), ...Object.keys(theme.bandVariables), ...Object.keys(theme.darkBandVariables)]) {
        expect(name in tokens.cssVariables || OPT_IN_TOKENS.has(name), `${id}: ${name}`).toBe(true);
      }
    }
  });

  it("gives Nasihamart its own identity: navy / ivory / sand, one grotesk in two widths, square controls, the mihrab preset", () => {
    const n = tokens.themes.nasihamart!.cssVariables;
    expect(n["--color-ink-900"]).toBe("11 31 51"); // navy #0B1F33
    expect(n["--color-cream-100"]).toBe("248 246 241"); // ivory #F8F6F1
    expect(n["--color-cream-200"]).toBe("238 231 219"); // sand #EEE7DB
    // No serif in the interface: headings are the body grotesk, condensed.
    expect(n["--font-display-family"]).toBe("var(--font-grotesk)");
    expect(n["--font-body-family"]).toBe("var(--font-grotesk)");
    expect(n["--font-display-stretch"]).toBe("78%");
    for (const name of ["--control-radius", "--chip-radius", "--swatch-radius", "--fab-radius"]) {
      expect(n[name], name).not.toBe(tokens.cssVariables[name]);
    }
    // No bottom tab bar in the mihrab preset, so nothing reserves room for one.
    expect(n["--dock-tab-bar"]).toBe("0rem");
    expect(tokens.themes.nasihamart!.layout).toBe("mihrab");
    expect(tokens.themes.default!.layout).toBe("classic");
    // The hero and brand story are light; the footer, flash sale and editorial banner stay navy.
    expect(tokens.themes.nasihamart!.lightBandRoles).toEqual(["hero", "story"]);
  });

  it("keeps Nasihamart's text legible (WCAG AA 4.5:1) on navy: the dark sections' text steps and the warm-stone accent", () => {
    const navy = step("nasihamart", "ink-950", "dark");
    for (const text of ["cream-50", "cream-200", "ink-300", "ink-400", "ink-500"]) {
      expect(contrast(step("nasihamart", text, "dark"), navy), `navy section ${text}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(hex("#D6C1A2"), navy), "warm stone on navy").toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex("#123B73"), step("nasihamart", "cream-100")), "secondary blue on ivory").toBeGreaterThanOrEqual(4.5);
  });

  it("keeps Nasihamart's text legible (WCAG AA 4.5:1) on its surfaces, inside the light band too", () => {
    const canvas = step("nasihamart", "cream-100");
    const surface = step("nasihamart", "cream-50");
    for (const text of ["ink-900", "ink-700", "ink-500", "ink-400"]) {
      expect(contrast(step("nasihamart", text), canvas), `${text} on canvas`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(step("nasihamart", text), surface), `${text} on surface`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast([255, 255, 255], step("nasihamart", "sale-500")), "white on sale badge").toBeGreaterThanOrEqual(4.5);
    expect(contrast(step("nasihamart", "sale-500"), canvas), "sale price on canvas").toBeGreaterThanOrEqual(4.5);
    // The sand footer and image wells carry secondary text.
    const sand = step("nasihamart", "cream-200");
    for (const text of ["ink-900", "ink-500"]) {
      expect(contrast(step("nasihamart", text), sand), `${text} on sand`).toBeGreaterThanOrEqual(4.5);
    }
    // In the band, the section is painted ink-950 and its text uses the dark-palette names (cream-50, ink-300, ink-400).
    const band = step("nasihamart", "ink-950", "band");
    for (const text of ["cream-50", "cream-200", "ink-300", "ink-400"]) {
      expect(contrast(step("nasihamart", text, "band"), band), `band ${text}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("base tertiary text", () => {
  it("clears WCAG AA (4.5:1) on every light surface, and the grey text steps do inside the base design's dark sections", () => {
    const ink400 = channels(tokens.cssVariables["--color-ink-400"]!);
    for (const surface of ["--color-cream-50", "--color-cream-100", "--color-ink-50", "--color-ink-100"]) {
      expect(contrast(ink400, channels(tokens.cssVariables[surface]!)), surface).toBeGreaterThanOrEqual(4.5);
    }
    const darkSection = channels(tokens.cssVariables["--color-ink-950"]!);
    for (const text of ["--color-ink-400", "--color-ink-500"]) {
      expect(contrast(channels(tokens.inverseBandVariables[text]!), darkSection), `dark section ${text}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
