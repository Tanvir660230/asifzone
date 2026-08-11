import type { Metadata } from "next";
import nextDynamic from "next/dynamic";
import { Hero } from "@/components/storefront/hero";
import { HeroCarousel } from "@/components/storefront/hero-carousel";
import { TrustStrip } from "@/components/storefront/trust-strip";
import { CategoryGrid } from "@/components/storefront/category-grid";
import { ProductGrid } from "@/components/storefront/product-grid";
import { FlashSaleSection } from "@/components/storefront/flash-sale-section";
import { PersonalizedLeadSection } from "@/components/storefront/personalized-lead-section";
import { getActiveBanners, getActiveFlashSale, getCategoryTree, getSiteSettings, listStorefrontProducts } from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";

// Below-the-fold sections — split out of the main bundle since they're not needed for first paint.
const BrandStory = nextDynamic(() => import("@/components/storefront/brand-story").then((m) => m.BrandStory));
const ValuesGrid = nextDynamic(() => import("@/components/storefront/values-grid").then((m) => m.ValuesGrid));
const SmartRecommendations = nextDynamic(() =>
  import("@/components/storefront/smart-recommendations").then((m) => m.SmartRecommendations),
);

// Flat route with a real server-side settings fetch — without this, `next build` would try to
// prerender it and fail (the api container isn't reachable during the Docker image build).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getSiteSettings();
  const url = getSiteUrl();
  return {
    alternates: { canonical: url },
    ...buildOpenGraph({
      title: settings.storeName,
      description: settings.tagline ?? undefined,
      url,
      siteName: settings.storeName,
      images: settings.logoUrl ? [settings.logoUrl] : undefined,
    }),
  };
}

export default async function HomePage() {
  const [{ tree }, featured, { banners }, { flashSale }, { settings }] = await Promise.all([
    getCategoryTree(),
    listStorefrontProducts({ featured: true, pageSize: 8 }),
    getActiveBanners("HERO_CAROUSEL"),
    getActiveFlashSale(),
    getSiteSettings(),
  ]);

  const products = featured.items.length > 0 ? featured : await listStorefrontProducts({ pageSize: 8 });

  return (
    <>
      {/* The visible hero headline is styled as an h2 (its content is admin-editable banner text
          that may be empty) — this sr-only h1 guarantees the page always has exactly one, real,
          crawlable top-level heading regardless of what the active banner contains. */}
      <h1 className="sr-only">
        {settings.storeName}
        {settings.tagline ? ` — ${settings.tagline}` : ""}
      </h1>
      {banners.length > 0 ? <HeroCarousel banners={banners} /> : <Hero tagline={settings.tagline} />}
      <TrustStrip />
      <PersonalizedLeadSection categoryTree={tree} />
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="mb-8 text-center font-display text-2xl text-ink-900">
          {featured.items.length > 0 ? "Featured" : "New Arrivals"}
        </h2>
        <ProductGrid products={products.items} />
      </section>
      {flashSale && <FlashSaleSection flashSale={flashSale} />}
      <CategoryGrid categories={tree} />
      <BrandStory storeName={settings.storeName} tagline={settings.tagline} />
      <ValuesGrid storeName={settings.storeName} />
      <SmartRecommendations />
    </>
  );
}
