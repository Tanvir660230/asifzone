import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { getSiteSettings } from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { buildOrganizationJsonLd, buildWebsiteJsonLd } from "@/lib/structured-data";

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

// Every page fetches live data (settings, prices, stock, auth) — static prerendering has no real
// value here and would require the API to be reachable at `next build` time, which it isn't during
// a Docker image build (the api container doesn't exist yet at that stage).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getSiteSettings();
  const siteUrl = getSiteUrl();
  return {
    title: { default: settings.storeName, template: `%s | ${settings.storeName}` },
    description: settings.tagline ?? undefined,
    alternates: { canonical: siteUrl },
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
  const { settings } = await getSiteSettings();
  const siteUrl = getSiteUrl();
  const organizationJsonLd = buildOrganizationJsonLd(settings, siteUrl);
  const websiteJsonLd = buildWebsiteJsonLd(settings, siteUrl);

  return (
    <html lang="en" className={`${inter.variable} ${playfairDisplay.variable}`}>
      <body>
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
