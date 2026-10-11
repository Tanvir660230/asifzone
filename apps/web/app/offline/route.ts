import { getSiteSettingsSafe } from "@/lib/api/storefront";
import { publicRuntimeConfig } from "@/lib/runtime-config";
import { resolveThemeId, themeColorHex } from "@/lib/theme";

/** What the service worker (public/sw.js) shows when a page can't be reached because the shopper is offline. One
 * self-contained HTML document (no scripts, no stylesheet to fetch) in the store's name and theme colours, cached by the
 * worker when it installs. */
export async function GET() {
  const { settings } = await getSiteSettingsSafe();
  const theme = resolveThemeId(publicRuntimeConfig().theme);
  const color = (name: string) => themeColorHex(theme, name);
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const store = escape(settings.storeName);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>You're offline | ${store}</title>
<style>
  body { margin: 0; min-height: 100svh; display: grid; place-items: center; background: ${color("canvas")}; color: ${color("ink-900")};
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 22rem; padding: 2rem 1rem; }
  p.store { margin: 0 0 1.5rem; font-size: .8125rem; letter-spacing: .08em; text-transform: uppercase; color: ${color("ink-600")}; }
  h1 { margin: 0; font-size: 1.75rem; line-height: 1.2; }
  p { margin: .75rem 0 0; color: ${color("ink-600")}; }
  a { display: inline-block; margin-top: 1.75rem; padding: .75rem 1.5rem; border-radius: 999px; background: ${color("ink-900")};
    color: ${color("cream-50")}; text-decoration: none; font-weight: 500; }
</style>
</head>
<body>
<main>
  <p class="store">${store}</p>
  <h1>You're offline</h1>
  <p>Check your connection, then try again. Your bag is saved on this device.</p>
  <a href="/">Try again</a>
</main>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
