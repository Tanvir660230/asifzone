import type { SectionAppearance } from "@clothing-brand/shared";

/** The `data-tone` of a dark-band section the store gave its own tone (Storefront Studio → Style → Tone). The band's
 * palette is then mirrored or restored by ui-tokens `toneVariables`; "theme" (or nothing) leaves it to the theme. */
export function bandTone(tone?: SectionAppearance["tone"]) {
  return tone === "dark" || tone === "light" ? tone : undefined;
}
