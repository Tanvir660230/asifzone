import tokens from "@clothing-brand/ui-tokens";

/**
 * The installation's brand theme (multi-brand layer): an id from @clothing-brand/ui-tokens `themes`, chosen at runtime by
 * STORE_THEME and applied as `<html data-brand="…">`, under which the theme's CSS variables override the base tokens.
 * Components never branch on the theme — they use tokens, and the theme changes what the tokens resolve to.
 */

export type ThemeId = string;

let warnedAbout: string | null = null;

/** A token colour as a hex literal, as the theme resolves it (its overrides over the base variables, following
 * `var(--…)` references) — for the few places outside CSS that need a literal colour: the web app manifest and the
 * offline page. `name` is a colour variable without its prefix: "canvas", "ink-900". */
export function themeColorHex(themeId: ThemeId, name: string): string {
  const overrides = tokens.themes[themeId]?.cssVariables ?? {};
  let value: string | undefined = `var(--color-${name})`;
  for (let hops = 0; hops < 8 && value; hops += 1) {
    const ref = /^var\((--[\w-]+)\)$/.exec(value.trim());
    if (!ref) break;
    value = overrides[ref[1]!] ?? tokens.cssVariables[ref[1]!];
  }
  const channels = value?.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (!channels) return "#ffffff";
  return `#${channels
    .slice(1, 4)
    .map((c) => Number(c).toString(16).padStart(2, "0"))
    .join("")}`;
}

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

