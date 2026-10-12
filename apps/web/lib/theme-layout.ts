import tokens from "@clothing-brand/ui-tokens";
import { publicRuntimeConfig } from "@/lib/runtime-config";
import { resolveThemeId } from "@/lib/theme";

/**
 * The storefront's structural preset — the second half of a brand theme. Tokens change what things look like; a preset
 * changes how a few chrome components are composed (header, footer, hero, product card …). The theme declares it
 * (`layout` in @clothing-brand/ui-tokens); components ask for the preset, never for the brand, so any installation may
 * pick any preset. `classic` is the base design.
 *
 * Works on the server and in the browser: both read the same runtime config (STORE_THEME), which never changes while the
 * app runs, so a component may branch on it during render without a hydration mismatch.
 */
export type StoreLayout = "classic" | "mihrab";

export function storeLayout(): StoreLayout {
  const layout = tokens.themes[resolveThemeId(publicRuntimeConfig().theme)]?.layout;
  return layout === "mihrab" ? "mihrab" : "classic";
}
