import tokens from "@clothing-brand/ui-tokens";
import { accentForeground, darken, hexToRgb, isHexColor, type DesignTheme } from "@clothing-brand/shared";

/** The id of the <style> element that carries the store's published design (the Studio preview swaps its contents). */
export const DESIGN_STYLE_ELEMENT_ID = "storefront-design";

const HEADING_FONT: Record<NonNullable<DesignTheme["headingFont"]>, string> = {
  playfair: '"Ampersand Fix", var(--font-display)',
  editorial: "var(--font-editorial)",
  grotesk: "var(--font-grotesk)",
  inter: "var(--font-sans)",
};

const BODY_FONT: Record<NonNullable<DesignTheme["bodyFont"]>, string> = {
  inter: "var(--font-sans)",
  grotesk: "var(--font-grotesk)",
};

const RHYTHM: Record<NonNullable<DesignTheme["rhythm"]>, string> = { compact: "0.8", default: "1", airy: "1.25" };

const channels = (rgb: [number, number, number]) => rgb.join(" ");

function block(selector: string, vars: Record<string, string>) {
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return body ? `${selector}{${body}}` : "";
}

/**
 * The CSS for a store's design choices: token re-values on top of its brand theme, under the same selectors the theme
 * uses (and emitted after the theme's stylesheet, so they win). Admin surfaces re-declare their own complete token set,
 * so the console never inherits any of it. Empty string when nothing is chosen.
 */
export function designCss(themeId: string, theme: DesignTheme | null | undefined): string {
  if (!theme) return "";
  const root = `:root[data-brand="${themeId}"]`;
  const vars: Record<string, string> = {};

  if (isHexColor(theme.accent)) {
    const accent = hexToRgb(theme.accent);
    const hover = darken(accent);
    vars["--color-accent"] = channels(accent);
    vars["--color-accent-fg"] = channels(accentForeground(accent));
    vars["--color-accent-hover"] = channels(hover);
    vars["--accent-hover"] = `rgb(${channels(hover)})`;
  }
  if (theme.headingFont) vars["--font-display-family"] = HEADING_FONT[theme.headingFont];
  if (theme.bodyFont) vars["--font-body-family"] = BODY_FONT[theme.bodyFont];
  // A corner style is the complete radius set from ui-tokens, so nothing keeps another style's corners.
  if (theme.corners) Object.assign(vars, tokens.cornerPresets[theme.corners]);
  if (theme.rhythm) vars["--section-rhythm"] = RHYTHM[theme.rhythm];

  let css = block(root, vars);
  // Every dark band at once — except a section that chose its own tone (`data-tone`).
  const toneVars = theme.bands ? tokens.themes[themeId]?.toneVariables?.[theme.bands] : undefined;
  if (toneVars) css += block(`${root} .ui-band-inverse:not([data-tone])`, toneVars);
  return css;
}
