import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter, Playfair_Display, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { getSiteSettingsSafe } from "@/lib/api/storefront";
import { StoreConfig } from "@/components/store-config";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { buildOrganizationJsonLd, buildWebsiteJsonLd } from "@/lib/structured-data";
import { RUNTIME_CONFIG_ELEMENT_ID, publicRuntimeConfig } from "@/lib/runtime-config";
import { RuntimeConfig } from "@/components/runtime-config";
import { resolveThemeId } from "@/lib/theme";
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

// Covers Bengali text/glyphs (e.g. the ৳ sign) that Inter and Playfair Display don't,
// so the browser falls back to it per-glyph instead of an inconsistent system font.
const notoSansBengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  variable: "--font-bn",
  display: "swap",
  weight: "variable",
});

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getSiteSettingsSafe();
  const siteUrl = getSiteUrl();
  return {
    metadataBase: new URL(siteUrl),
    title: { default: settings.storeName, template: `%s | ${settings.storeName}` },
    description: settings.tagline ?? undefined,
    alternates: { canonical: siteUrl },
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
    verification: settings.googleSiteVerification ? { google: settings.googleSiteVerification } : undefined,
    ...buildOpenGraph({
      title: settings.storeName,
      description: settings.tagline ?? undefined,
      url: siteUrl,
      siteName: settings.storeName,
      images: settings.logoUrl ? [settings.logoUrl] : undefined,
    }),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so each response gets the nonce middleware.ts minted for
  // its Content-Security-Policy — a page prerendered at build time would carry no nonce and its scripts would be blocked.
  // Data fetches keep their own revalidate caching; nginx's micro-cache still serves hot anonymous pages.
  await headers();
  const { settings } = await getSiteSettingsSafe();
  const siteUrl = getSiteUrl();
  const runtime = publicRuntimeConfig();
  const organizationJsonLd = buildOrganizationJsonLd(settings, siteUrl);
  const websiteJsonLd = buildWebsiteJsonLd(settings, siteUrl);

  return (
    <html
      lang="en"
      data-brand={resolveThemeId(runtime.theme)}
      className={`${inter.variable} ${playfairDisplay.variable} ${notoSansBengali.variable}`}
    >
      <body>
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
