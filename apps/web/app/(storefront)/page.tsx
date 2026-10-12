import type { Metadata } from "next";
import { Fragment } from "react";
import nextDynamic from "next/dynamic";
import type {
  BrandStoryConfig,
  CategoryGridConfig,
  HeroConfig,
  PersonalizedLeadConfig,
  Product,
  ProductCarouselConfig,
  PromoBannerConfig,
  SmartRecommendationsConfig,
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
import { BuyAgainRail } from "@/components/storefront/buy-again-rail";
import {
  getActiveBanners,
  getActiveFlashSale,
  getActiveHomepageSections,
  getCategoryTree,
  getSiteSettings,
  listStorefrontProducts,
} from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph, storeShareImages } from "@/lib/seo";
import { storeLayout } from "@/lib/theme-layout";
import {
  MihrabBrandStory,
  MihrabCategoryArches,
  MihrabFlashSale,
  MihrabHero,
  MihrabProductRail,
  MihrabPromoBanner,
  MihrabTrustRow,
  MihrabValues,
} from "@/components/storefront/presets/mihrab/sections";

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
  // The store's own search title/description for the homepage (Admin → Settings → Search engines), else name and tagline.
  const title = settings.seoTitle || settings.storeName;
  const description = settings.seoDescription || settings.tagline || undefined;
  return {
    ...(settings.seoTitle ? { title: { absolute: settings.seoTitle } } : {}),
    ...(settings.seoDescription ? { description: settings.seoDescription } : {}),
    alternates: { canonical: url },
    ...buildOpenGraph({
      title,
      description,
      url,
      siteName: settings.storeName,
      images: storeShareImages(settings),
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

/** The full listing a homepage product section previews (its "View all" link). */
function carouselListingHref({ source, category }: ProductCarouselConfig): string {
  if (source === "category" && category) return `/category/${category}`;
  if (source === "new") return "/search?sort=newest";
  return "/search";
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

  // "Buy again" (signed-in customers only) sits in the welcome-back spot: with the personalized lead when the page has
  // one, otherwise straight after the hero.
  const buyAgainAfter = sections.find((s) => s.type === "PERSONALIZED_LEAD")?.id ?? sections.find((s) => s.type === "HERO")?.id;
  // The theme's structural preset composes the sections; their content and data are the same either way.
  const mihrab = storeLayout() === "mihrab";
  const SectionHero = mihrab ? MihrabHero : Hero;
  const SectionTrust = mihrab ? MihrabTrustRow : TrustStrip;
  const SectionCategories = mihrab ? MihrabCategoryArches : CategoryGrid;
  const SectionStory = mihrab ? MihrabBrandStory : BrandStory;
  const SectionValues = mihrab ? MihrabValues : ValuesGrid;
  const SectionPromo = mihrab ? MihrabPromoBanner : PromoBannerSection;
  const SectionFlashSale = mihrab ? MihrabFlashSale : FlashSaleSection;

  return (
    <>
      {/* The visible hero headline is styled as an h2 (its content is admin-editable banner text
          that may be empty) — this sr-only h1 guarantees the page always has exactly one, real,
          crawlable top-level heading regardless of what the active banner contains. */}
      <h1 className="sr-only">
        {settings.storeName}
        {settings.tagline ? ` — ${settings.tagline}` : ""}
      </h1>
      {sections.map((section) => (
        <Fragment key={section.id}>
          {renderSection(section)}
          {section.id === buyAgainAfter && <BuyAgainRail />}
        </Fragment>
      ))}
    </>
  );

  function renderSection(section: (typeof sections)[number]) {
    switch (section.type) {
      case "HERO": {
        if (banners.length > 0) return <HeroCarousel key={section.id} banners={banners} />;
        const config = section.config as unknown as HeroConfig;
        return (
          <SectionHero
            key={section.id}
            storeName={settings.storeName}
            tagline={settings.tagline}
            headline={config.headline}
            subtext={config.subtext}
            bodyText={config.bodyText}
            ctaLabel={config.ctaLabel}
            ctaHref={config.ctaHref}
            secondaryCtaLabel={config.secondaryCtaLabel}
            secondaryCtaHref={config.secondaryCtaHref}
            imageUrl={config.imageUrl}
            imageAltText={config.imageAltText}
          />
        );
      }
      case "TRUST_STRIP": {
        const config = section.config as unknown as TrustStripConfig;
        return <SectionTrust key={section.id} items={config.items} />;
      }
      case "PERSONALIZED_LEAD": {
        const config = section.config as unknown as PersonalizedLeadConfig;
        return (
          <PersonalizedLeadSection
            key={section.id}
            categoryTree={tree}
            eyebrow={config.eyebrow}
            titleTemplate={config.titleTemplate}
          />
        );
      }
      case "PRODUCT_CAROUSEL": {
        const config = section.config as unknown as ProductCarouselConfig;
        if (mihrab) {
          return (
            <MihrabProductRail
              key={section.id}
              heading={config.heading}
              subtitle={config.subtitle}
              products={carouselProducts.get(section.id) ?? []}
              href={carouselListingHref(config)}
            />
          );
        }
        return (
          <ProductCarouselSection
            key={section.id}
            heading={config.heading}
            subtitle={config.subtitle}
            href={carouselListingHref(config)}
            products={carouselProducts.get(section.id) ?? []}
          />
        );
      }
      case "FLASH_SALE":
        return flashSale ? <SectionFlashSale key={section.id} flashSale={flashSale} /> : null;
      case "CATEGORY_GRID": {
        const config = section.config as unknown as CategoryGridConfig;
        return <SectionCategories key={section.id} categories={tree} heading={config.heading} subtitle={config.subtitle} />;
      }
      case "BRAND_STORY": {
        const config = section.config as unknown as BrandStoryConfig;
        return (
          <SectionStory
            key={section.id}
            storeName={settings.storeName}
            tagline={settings.tagline}
            eyebrow={config.eyebrow}
            heading={config.heading}
            bodyText={config.bodyText}
            ctaLabel={config.ctaLabel}
            ctaHref={config.ctaHref}
            imageUrl={config.imageUrl}
          />
        );
      }
      case "VALUES_GRID": {
        const config = section.config as unknown as ValuesGridConfig;
        return <SectionValues key={section.id} storeName={settings.storeName} eyebrow={config.eyebrow} heading={config.heading} items={config.items} />;
      }
      case "SMART_RECOMMENDATIONS": {
        const config = section.config as unknown as SmartRecommendationsConfig;
        return <SmartRecommendations key={section.id} title={config.title} />;
      }
      case "PROMO_BANNER": {
        const config = section.config as unknown as PromoBannerConfig;
        return (
          <SectionPromo
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
  }
}
