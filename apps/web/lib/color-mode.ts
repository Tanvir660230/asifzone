/** A shopper's light/dark choice on a store whose theme has a dark colour mode (packages/ui-tokens `dark`). Stored in a
 * cookie so the root layout renders `<html data-mode>` before the first paint; no cookie = follow the device. */
export type ColorMode = "light" | "dark";

export const COLOR_MODE_COOKIE = "color-mode";

export function parseColorMode(value: string | undefined | null): ColorMode | null {
  return value === "light" || value === "dark" ? value : null;
}

/** Applies a choice at once (the `<html>` attribute) and remembers it for a year; `null` goes back to the device setting. */
export function setColorMode(mode: ColorMode | null) {
  const root = document.documentElement;
  if (mode) {
    root.dataset.mode = mode;
    document.cookie = `${COLOR_MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
  } else {
    delete root.dataset.mode;
    document.cookie = `${COLOR_MODE_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }
}

/** The mode the page shows now: the choice made, else the device's. */
export function shownColorMode(): ColorMode {
  const chosen = parseColorMode(document.documentElement.dataset.mode);
  if (chosen) return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
