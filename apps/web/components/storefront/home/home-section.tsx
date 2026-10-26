import type {
  Banner,
  BrandStoryConfig,
  CategoryGridConfig,
  FeaturedReview,
  FlashSale,
  HeroConfig,
  ImageGalleryConfig,
  NewsletterConfig,
  PersonalizedLeadConfig,
  Product,
  ProductCarouselConfig,
  PromoBannerConfig,
  RichTextConfig,
  SectionAppearance,
  SmartRecommendationsConfig,
  TestimonialsConfig,
  TrustStripConfig,
  ValuesGridConfig,
} from "@clothing-brand/shared";
// Static imports only: this renderer also runs inside the Studio preview (a client tree), where a `next/dynamic` chunk
// is fetched by the browser and blocked by the nonce CSP ('strict-dynamic') — docs/DESIGN_SYSTEM.md §2.
import { BrandStory } from "@/components/storefront/brand-story";
import { Hero } from "@/components/storefront/hero";
import { TahafiHero } from "../presets/tahafi/hero";
import { SmartRecommendations } from "@/components/storefront/smart-recommendations";
import { ValuesGrid } from "@/components/storefront/values-grid";
import { HeroCarousel } from "@/components/storefront/hero-carousel";
import { TrustStrip } from "@/components/storefront/trust-strip";
import { CategoryGrid } from "@/components/storefront/category-grid";
import { ProductCarouselSection } from "@/components/storefront/product-carousel-section";
import { PromoBannerSection } from "@/components/storefront/promo-banner-section";
import { FlashSaleSection } from "@/components/storefront/flash-sale-section";
import { PersonalizedLeadSection } from "@/components/storefront/personalized-lead-section";
import { RichTextSection } from "@/components/storefront/rich-text-section";
import { TestimonialsSection } from "@/components/storefront/testimonials-section";
import { NewsletterSection } from "@/components/storefront/newsletter-section";
import { ImageGallerySection } from "@/components/storefront/image-gallery-section";
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
import type { CategoryTreeNode } from "@/lib/api/storefront";
import type { StoreLayout } from "@/lib/theme-layout";
import { carouselListingHref, reviewsFor, type RenderableSection } from "@/lib/homepage-data";
import { SectionFrame } from "./section-frame";


/** Everything the homepage's sections draw on besides their own config, fetched once per page. */
export interface HomeSectionData {
  storeName: string;
  tagline: string | null;
  tree: CategoryTreeNode[];
  banners: Banner[];
  flashSale: FlashSale | null;
  /** Products per PRODUCT_CAROUSEL section id. */
  carouselProducts: Map<string, Product[]>;
  /** Enough reviews for every TESTIMONIALS section (lib/homepage-data.ts `loadFeaturedReviews`). */
  reviews: FeaturedReview[];
}

/**
 * One homepage section, rendered the same way on the live homepage (server) and in the Storefront Studio preview
 * (client, from the unsaved draft). The theme's structural preset composes the sections; their content and data are the
 * same either way. The frame around it applies the section's own appearance (spacing, background, device).
 */
export function HomeSection({ section, data, layout }: { section: RenderableSection; data: HomeSectionData; layout: StoreLayout }) {
  const appearance = (section.config.appearance ?? undefined) as SectionAppearance | undefined;
  const body = renderSection(section, data, layout, appearance);
  if (!body) return null;
  return (
    <SectionFrame id={section.id} appearance={appearance}>
      {body}
    </SectionFrame>
  );
}

function renderSection(section: RenderableSection, data: HomeSectionData, layout: StoreLayout, appearance: SectionAppearance | undefined) {
  const { storeName, tagline } = data;
  const mihrab = layout === "mihrab";
  switch (section.type) {
    case "HERO": {
      if (data.banners.length > 0) return <HeroCarousel banners={data.banners} />;
      const config = section.config as HeroConfig;
      const props = {
        storeName,
        tagline,
        headline: config.headline,
        subtext: config.subtext,
        bodyText: config.bodyText,
        ctaLabel: config.ctaLabel,
        ctaHref: config.ctaHref,
        secondaryCtaLabel: config.secondaryCtaLabel,
        secondaryCtaHref: config.secondaryCtaHref,
        imageUrl: config.imageUrl,
        mobileImageUrl: config.mobileImageUrl,
        imageAltText: config.imageAltText,
      };
      if (mihrab) return <MihrabHero {...props} />;
      if (layout === "tahafi") return <TahafiHero {...props} tone={appearance?.tone} layout={appearance?.layout} />;
      return <Hero {...props} tone={appearance?.tone} layout={appearance?.layout} />;
    }
    case "TRUST_STRIP": {
      const config = section.config as TrustStripConfig;
      return mihrab ? <MihrabTrustRow items={config.items} /> : <TrustStrip items={config.items} />;
    }
    case "PERSONALIZED_LEAD": {
      const config = section.config as PersonalizedLeadConfig;
      return <PersonalizedLeadSection categoryTree={data.tree} eyebrow={config.eyebrow} titleTemplate={config.titleTemplate} />;
    }
    case "PRODUCT_CAROUSEL": {
      const config = section.config as ProductCarouselConfig;
      const products = data.carouselProducts.get(section.id) ?? [];
      const href = carouselListingHref(config);
      if (mihrab) return <MihrabProductRail heading={config.heading} subtitle={config.subtitle} products={products} href={href} />;
      return <ProductCarouselSection heading={config.heading} subtitle={config.subtitle} href={href} products={products} rows={appearance?.rows} />;
    }
    case "FLASH_SALE":
      if (!data.flashSale) return null;
      return mihrab ? <MihrabFlashSale flashSale={data.flashSale} /> : <FlashSaleSection flashSale={data.flashSale} />;
    case "CATEGORY_GRID": {
      const config = section.config as CategoryGridConfig;
      return mihrab ? (
        <MihrabCategoryArches categories={data.tree} heading={config.heading} subtitle={config.subtitle} />
      ) : (
        <CategoryGrid categories={data.tree} heading={config.heading} subtitle={config.subtitle} />
      );
    }
    case "BRAND_STORY": {
      const config = section.config as BrandStoryConfig;
      const props = {
        storeName,
        tagline,
        eyebrow: config.eyebrow,
        heading: config.heading,
        bodyText: config.bodyText,
        ctaLabel: config.ctaLabel,
        ctaHref: config.ctaHref,
        imageUrl: config.imageUrl,
        imageAltText: config.imageAltText,
      };
      if (mihrab) return <MihrabBrandStory {...props} imageSide={appearance?.layout === "image-right" ? "right" : "left"} />;
      return <BrandStory {...props} tone={appearance?.tone} layout={appearance?.layout} />;
    }
    case "VALUES_GRID": {
      const config = section.config as ValuesGridConfig;
      const props = { storeName, eyebrow: config.eyebrow, heading: config.heading, items: config.items };
      return mihrab ? <MihrabValues {...props} /> : <ValuesGrid {...props} />;
    }
    case "SMART_RECOMMENDATIONS": {
      const config = section.config as SmartRecommendationsConfig;
      return <SmartRecommendations title={config.title} />;
    }
    case "PROMO_BANNER": {
      const config = section.config as PromoBannerConfig;
      const props = {
        heading: config.heading,
        bodyText: config.bodyText,
        imageUrl: config.imageUrl,
        mobileImageUrl: config.mobileImageUrl,
        linkUrl: config.linkUrl,
        ctaLabel: config.ctaLabel,
      };
      if (mihrab) return <MihrabPromoBanner {...props} />;
      return <PromoBannerSection {...props} imageAltText={config.imageAltText} tone={appearance?.tone} width={appearance?.width} align={appearance?.align} />;
    }
    case "RICH_TEXT": {
      const config = section.config as RichTextConfig;
      if (!config.heading) return null;
      return <RichTextSection eyebrow={config.eyebrow} heading={config.heading} bodyText={config.bodyText} ctaLabel={config.ctaLabel} ctaHref={config.ctaHref} align={config.align} />;
    }
    case "TESTIMONIALS": {
      const config = section.config as TestimonialsConfig;
      return <TestimonialsSection eyebrow={config.eyebrow} heading={config.heading} reviews={reviewsFor(config, data.reviews)} />;
    }
    case "NEWSLETTER": {
      const config = section.config as NewsletterConfig;
      return <NewsletterSection heading={config.heading} bodyText={config.bodyText} />;
    }
    case "IMAGE_GALLERY": {
      const config = section.config as ImageGalleryConfig;
      return <ImageGallerySection eyebrow={config.eyebrow} heading={config.heading} items={(config.items ?? []).filter((i) => i?.imageUrl)} layout={config.layout} />;
    }
    default:
      return null;
  }
}
