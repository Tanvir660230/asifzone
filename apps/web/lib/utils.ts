import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Bare icon-only buttons (row actions in admin tables — view/edit/delete) render just a 16-20px
 * lucide icon with no padding, well under the ~44px touch-target guideline on mobile. Negative
 * margin keeps the visual icon size and row spacing unchanged while padding expands the actual
 * hit area; apply directly to the button's className alongside `cn`. */
export const ICON_BUTTON_HIT = "p-2 -m-2 rounded-md transition-colors duration-150 ease-smooth hover:bg-ink-100";

/** Near-white swatches (e.g. #ffffff, #f8f8f8) have almost no contrast against the cream-50 card
 * background, so callers rendering a color swatch should darken the border for these instead of
 * relying on the default light border. Uses perceptual luminance, not a flat whitelist, so it
 * catches any pale shade an admin might upload — not just pure white. */
export function isPaleColor(hex: string | null | undefined): boolean {
  if (!hex) return false;
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return false;
  const [r, g, b] = [match[1]!, match[2]!, match[3]!].map((c) => parseInt(c, 16));
  const luminance = (0.299 * r! + 0.587 * g! + 0.114 * b!) / 255;
  return luminance > 0.88;
}
