import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter, Instrument_Sans, Newsreader, Playfair_Display, Noto_Sans_Bengali } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { getSiteSettingsSafe } from "@/lib/api/storefront";
import { StoreConfig } from "@/components/store-config";
import { getSiteUrl, buildOpenGraph, storeShareImages } from "@/lib/seo";
import { buildOrganizationJsonLd, buildWebsiteJsonLd } from "@/lib/structured-data";
import { RUNTIME_CONFIG_ELEMENT_ID, publicRuntimeConfig, setIntegrationIds } from "@/lib/runtime-config";
import { RuntimeConfig } from "@/components/runtime-config";
import { resolveThemeId, themeColorHex } from "@/lib/theme";
import { storeLayout } from "@/lib/theme-layout";
import { DESIGN_STYLE_ELEMENT_ID, designCss } from "@/lib/design-css";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { HeatmapScript } from "@/components/analytics/heatmap-script";
import { AdPixels } from "@/components/analytics/ad-pixels";
import { TrackingConsentBanner } from "@/components/analytics/tracking-consent-banner";
import { jsonLdString } from "@clothing-brand/shared";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

// Faces a brand theme may choose (packages/ui-tokens `fontVariables`): an editorial serif and a refined grotesk. Not
// preloaded — the browser downloads a face only when the theme's CSS actually uses it, so other stores never fetch them.
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-editorial",
  display: "swap",
  preload: false,
  weight: "variable",
  axes: ["opsz"],
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
  preload: false,
  weight: "variable",
});

// Covers Bengali text that the Latin faces don't, so the browser falls back to it per glyph instead of an inconsistent
// system font. Not preloaded (105 KB): it is fetched only on a page that shows Bengali text — the landing pages
// preload it themselves. The ৳ on every price comes from takaSign below, not from this file.
const notoSansBengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  variable: "--font-bn",
  display: "swap",
  preload: false,
  weight: "variable",
});

// Just the ৳ sign, cut from the same Noto Sans Bengali file (1.3 KB, same outlines and metrics, SIL OFL), so a price
// never pulls in the whole Bengali font. Listed before --font-bn in every stack (ui-tokens).
const takaSign = localFont({
  src: "./fonts/taka-sign.woff2",
  variable: "--font-taka",
  display: "swap",
  weight: "100 900",
  declarations: [{ prop: "unicode-range", value: "U+09F3" }],
});

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getSiteSettingsSafe();
  const siteUrl = getSiteUrl();
  return {
    metadataBase: new URL(siteUrl),
    title: { default: settings.storeName, template: `%s | ${settings.storeName}` },
    description: settings.tagline ?? undefined,
    // No `alternates.canonical` here: every page inherits the root's metadata, so a canonical set here pointed cart,
    // checkout, sign-in and every other page without its own at the homepage. Indexable pages set their own.
    // Next.js does not merge the app/icon.png + apple-icon.png convention files into a segment
    // that also defines generateMetadata, so the fallback below is spelled out explicitly rather
    // than left to that (non-)merge — otherwise an unconfigured favicon would render no <link
    // rel="icon"> at all.
    icons: settings.faviconUrl
      ? {
          icon: [{ url: settings.faviconUrl, sizes: "512x512", type: "image/png" }],
          apple: [{ url: settings.faviconUrl, sizes: "512x512", type: "image/png" }],
        }
      : {
          icon: [{ url: "/icon.png", sizes: "512x512", type: "image/png" }],
          apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
          shortcut: ["/favicon.ico"],
        },
    // Saved to a phone's home screen, the store opens full screen like an app, under its own name
    // (app/manifest.webmanifest/route.ts; the Store Console's layout links its own instead).
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: settings.storeName, statusBarStyle: "default" },
    verification: settings.googleSiteVerification ? { google: settings.googleSiteVerification } : undefined,
    ...buildOpenGraph({
      title: settings.storeName,
      description: settings.tagline ?? undefined,
      url: siteUrl,
      siteName: settings.storeName,
      images: storeShareImages(settings),
    }),
  };
}

/** Edge to edge on notched phones (viewport-fit=cover), so env(safe-area-inset-*) reports the home indicator and the
 * bottom tab bar sits above it. The browser's own bars take the colour of the store's header, so the page and the
 * phone's chrome read as one surface, the way an app does. */
export function generateViewport(): Viewport {
  const theme = resolveThemeId(publicRuntimeConfig().theme);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: themeColorHex(theme, storeLayout() === "mihrab" ? "canvas" : "surface"),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so each response gets the nonce middleware.ts minted for
  // its Content-Security-Policy — a page prerendered at build time would carry no nonce and its scripts would be blocked.
  // Data fetches keep their own revalidate caching; nginx's micro-cache still serves hot anonymous pages.
  await headers();
  const { settings } = await getSiteSettingsSafe();
  const siteUrl = getSiteUrl();
  setIntegrationIds(settings.integrationIds);
  const runtime = publicRuntimeConfig();
  const organizationJsonLd = buildOrganizationJsonLd(settings, siteUrl);
  const websiteJsonLd = buildWebsiteJsonLd(settings, siteUrl);
  const themeId = resolveThemeId(runtime.theme);

  return (
    <html
      lang="en"
      data-brand={themeId}
      className={`${inter.variable} ${playfairDisplay.variable} ${newsreader.variable} ${instrumentSans.variable} ${notoSansBengali.variable} ${takaSign.variable}`}
    >
      <body>
        {/* The store's own design choices (Storefront Studio → Site design): token re-values only, validated on publish.
            Always present, so the Studio preview can swap in the draft's. */}
        <style id={DESIGN_STYLE_ELEMENT_ID} dangerouslySetInnerHTML={{ __html: designCss(themeId, settings.storefrontDesign?.theme) }} />
        {/* This installation's public runtime configuration (Phase 1A) — data, not script: CSP does not apply to it. */}
        <script id={RUNTIME_CONFIG_ELEMENT_ID} type="application/json" dangerouslySetInnerHTML={{ __html: jsonLdString(runtime) }} />
        <link rel="preconnect" href={runtime.apiUrl} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(websiteJsonLd) }}
        />
        <RuntimeConfig value={runtime}>
          <PageViewTracker />
          <HeatmapScript />
          <AdPixels />
          <StoreConfig currency={settings.currency} timezone={settings.timezone}>
            <Providers>{children}</Providers>
          </StoreConfig>
          <TrackingConsentBanner />
        </RuntimeConfig>
      </body>
    </html>
  );
}
