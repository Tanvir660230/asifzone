import type { Metadata } from "next";
import nextDynamic from "next/dynamic";
import type {
  BrandStoryConfig,
  CategoryGridConfig,
  Product,
  ProductCarouselConfig,
  PromoBannerConfig,
  TrustStripConfig,
  ValuesGridConfig,
} from "@clothing-brand/shared";
import { Hero } from "@/components/storefront/hero";
import { HeroCarousel } from "@/components/storefront/hero-carousel";
import { TrustStrip } from "@/components/storefront/trust-strip";
import { CategoryGrid } from "@/components/storefront/category-grid";
import { ProductCarouselSection } from "@/components/storefront/product-carousel-section";
import { PromoBannerSection } from "@/components/storefront/promo-banner-section";
import { FlashSaleSection } from "@/components/storefront/flash-sale-section";
import { PersonalizedLeadSection } from "@/components/storefront/personalized-lead-section";
import {
  getActiveBanners,
  getActiveFlashSale,
  getActiveHomepageSections,
  getCategoryTree,
  getSiteSettings,
  listStorefrontProducts,
} from "@/lib/api/storefront";
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

/** "featured" falls back to newest-first when nothing is currently marked featured — same
 * item-selection behavior the homepage always had, just keyed off the section's own config now
 * instead of being the one hardcoded call the page made. The heading itself is whatever the admin
 * set for this section and no longer auto-swaps to "New Arrivals" on that fallback — it's editable
 * copy now, not a computed label. */
async function resolveProductCarouselProducts(config: ProductCarouselConfig) {
  const { source, category, itemCount } = config;
  if (source === "category" && category) {
    return listStorefrontProducts({ category, pageSize: itemCount });
  }
  if (source === "new") {
    return listStorefrontProducts({ pageSize: itemCount });
  }
  const featured = await listStorefrontProducts({ featured: true, pageSize: itemCount });
  return featured.items.length > 0 ? featured : listStorefrontProducts({ pageSize: itemCount });
}

export default async function HomePage() {
  const [{ sections }, { tree }, { banners }, { flashSale }, { settings }] = await Promise.all([
    getActiveHomepageSections(),
    getCategoryTree(),
    getActiveBanners("HERO_CAROUSEL"),
    getActiveFlashSale(),
    getSiteSettings(),
  ]);

  const carouselProducts = new Map<string, Product[]>(
    await Promise.all(
      sections
        .filter((section) => section.type === "PRODUCT_CAROUSEL")
        .map(async (section) => {
          const config = section.config as unknown as ProductCarouselConfig;
          const result = await resolveProductCarouselProducts(config);
          return [section.id, result.items] as [string, Product[]];
        }),
    ),
  );

  return (
    <>
      {/* The visible hero headline is styled as an h2 (its content is admin-editable banner text
          that may be empty) — this sr-only h1 guarantees the page always has exactly one, real,
          crawlable top-level heading regardless of what the active banner contains. */}
      <h1 className="sr-only">
        {settings.storeName}
        {settings.tagline ? ` — ${settings.tagline}` : ""}
      </h1>
      {sections.map((section) => {
        switch (section.type) {
          case "HERO":
            return banners.length > 0 ? (
              <HeroCarousel key={section.id} banners={banners} />
            ) : (
              <Hero key={section.id} tagline={settings.tagline} />
            );
          case "TRUST_STRIP": {
            const config = section.config as unknown as TrustStripConfig;
            return <TrustStrip key={section.id} items={config.items} />;
          }
          case "PERSONALIZED_LEAD":
            return <PersonalizedLeadSection key={section.id} categoryTree={tree} />;
          case "PRODUCT_CAROUSEL": {
            const config = section.config as unknown as ProductCarouselConfig;
            return (
              <ProductCarouselSection
                key={section.id}
                heading={config.heading}
                subtitle={config.subtitle}
                products={carouselProducts.get(section.id) ?? []}
              />
            );
          }
          case "FLASH_SALE":
            return flashSale ? <FlashSaleSection key={section.id} flashSale={flashSale} /> : null;
          case "CATEGORY_GRID": {
            const config = section.config as unknown as CategoryGridConfig;
            return <CategoryGrid key={section.id} categories={tree} heading={config.heading} />;
          }
          case "BRAND_STORY": {
            const config = section.config as unknown as BrandStoryConfig;
            return (
              <BrandStory
                key={section.id}
                storeName={settings.storeName}
                tagline={settings.tagline}
                heading={config.heading}
                bodyText={config.bodyText}
                ctaLabel={config.ctaLabel}
                ctaHref={config.ctaHref}
              />
            );
          }
          case "VALUES_GRID": {
            const config = section.config as unknown as ValuesGridConfig;
            return <ValuesGrid key={section.id} storeName={settings.storeName} items={config.items} />;
          }
          case "SMART_RECOMMENDATIONS":
            return <SmartRecommendations key={section.id} />;
          case "PROMO_BANNER": {
            const config = section.config as unknown as PromoBannerConfig;
            return (
              <PromoBannerSection
                key={section.id}
                heading={config.heading}
                bodyText={config.bodyText}
                imageUrl={config.imageUrl}
                mobileImageUrl={config.mobileImageUrl}
                linkUrl={config.linkUrl}
                ctaLabel={config.ctaLabel}
              />
            );
          }
          default:
            return null;
        }
      })}
    </>
  );
}
