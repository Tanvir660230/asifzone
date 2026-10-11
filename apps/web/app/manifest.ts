import type { MetadataRoute } from "next";
import { getSiteSettingsSafe } from "@/lib/api/storefront";
import { publicRuntimeConfig } from "@/lib/runtime-config";
import { resolveThemeId, themeColorHex } from "@/lib/theme";

/** The web app manifest: lets shoppers add the store to their home screen and open it like an app. Name, icon and colours
 * come from the store's settings and its brand theme, never from one store's look. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { settings } = await getSiteSettingsSafe();
  const theme = resolveThemeId(publicRuntimeConfig().theme);
  const canvas = themeColorHex(theme, "canvas");
  // The store's own icon when it has uploaded one (a 512px square PNG, as the favicon setting asks for), else the default.
  const icon = settings.faviconUrl ?? "/icon.png";

  return {
    name: settings.storeName,
    short_name: settings.storeName.length > 12 ? settings.storeName.split(/\s+/)[0]!.slice(0, 12) : settings.storeName,
    description: settings.tagline ?? undefined,
    start_url: "/?source=app",
    scope: "/",
    display: "standalone",
    background_color: canvas,
    theme_color: canvas,
    icons: [
      { src: icon, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icon, sizes: "192x192", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Track your order", url: "/track-order" },
      { name: "Your bag", url: "/cart" },
    ],
  };
}
