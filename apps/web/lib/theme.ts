import tokens from "@clothing-brand/ui-tokens";

/**
 * The installation's brand theme (multi-brand layer): an id from @clothing-brand/ui-tokens `themes`, chosen at runtime by
 * STORE_THEME and applied as `<html data-brand="…">`, under which the theme's CSS variables override the base tokens.
 * Components never branch on the theme — they use tokens, and the theme changes what the tokens resolve to.
 */

export type ThemeId = string;

let warnedAbout: string | null = null;

/** A known theme id, else `default` (an unknown STORE_THEME is reported once, never fatal). */
export function resolveThemeId(requested: string | null | undefined): ThemeId {
  const id = requested?.trim().toLowerCase() || tokens.DEFAULT_THEME;
  if (Object.hasOwn(tokens.themes, id)) return id;
  if (warnedAbout !== id) {
    warnedAbout = id;
    console.warn(`[theme] Unknown STORE_THEME "${id}" — using "${tokens.DEFAULT_THEME}". Known: ${Object.keys(tokens.themes).join(", ")}`);
  }
  return tokens.DEFAULT_THEME;
}

