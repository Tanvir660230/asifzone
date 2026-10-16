import type { MetadataRoute } from "next";
import { getSiteSettingsSafe } from "@/lib/api/storefront";
import { publicRuntimeConfig } from "@/lib/runtime-config";
import { resolveThemeId, themeColorHex } from "@/lib/theme";

/**
 * The Store Console's own web app manifest, linked from app/admin/layout.tsx. Without it, "Add to Home Screen" / "Install
 * app" on an admin page used the store's manifest (app/manifest.ts) and the installed icon opened the shop. This one opens
 * the console, full screen, scoped to /admin — a separate app from the storefront's, with its own id.
 *
 * Served at /console.webmanifest, not under /admin: browsers fetch a manifest without cookies, and middleware sends every
 * cookieless /admin request to the sign-in page.
 */
export async function GET() {
  const { settings } = await getSiteSettingsSafe();
  const theme = resolveThemeId(publicRuntimeConfig().theme);
  const canvas = themeColorHex(theme, "canvas", "admin");
  const icon = settings.faviconUrl ?? "/icon.png";

  const manifest: MetadataRoute.Manifest = {
    id: "/admin",
    name: `${settings.storeName} Admin`,
    short_name: "Admin",
    description: `Orders, products and stock for ${settings.storeName}.`,
    start_url: "/admin/dashboard?source=app",
    scope: "/admin",
    display: "standalone",
    orientation: "portrait",
    background_color: canvas,
    theme_color: canvas,
    icons: [
      { src: icon, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icon, sizes: "192x192", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Orders", url: "/admin/orders" },
      { name: "Create order", url: "/admin/orders/new" },
      { name: "Products", url: "/admin/products" },
      { name: "Stock", url: "/admin/inventory" },
    ],
  };

  return Response.json(manifest, {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" },
  });
}
