import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo";

// Same reasoning as sitemap.ts: with no data fetch, Next would otherwise statically prerender this at build time, freezing
// in one installation's site URL — the URL is runtime configuration (lib/runtime-config.ts).
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/account", "/cart", "/checkout", "/order-confirmation", "/track-order", "/wishlist", "/pay"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
