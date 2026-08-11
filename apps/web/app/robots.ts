import type { MetadataRoute } from "next";

// Same reasoning as sitemap.ts: with no data fetch, Next would otherwise statically prerender this
// at build time, freezing in whatever NEXT_PUBLIC_SITE_URL happened to be set (or unset) then.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/account", "/cart", "/checkout", "/order-confirmation", "/track-order"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
