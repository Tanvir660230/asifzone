"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  BrandStoryConfig,
  CategoryGridConfig,
  HeroConfig,
  HomepageSectionType,
  PersonalizedLeadConfig,
  ProductCarouselConfig,
  PromoBannerConfig,
  SmartRecommendationsConfig,
  TrustStripConfig,
  ValuesGridConfig,
} from "@clothing-brand/shared";
import { Hero } from "@/components/storefront/hero";
import { TrustStrip } from "@/components/storefront/trust-strip";
import { ValuesGrid } from "@/components/storefront/values-grid";
import { BrandStory } from "@/components/storefront/brand-story";
import { CategoryGrid } from "@/components/storefront/category-grid";
import { ProductCarouselSection } from "@/components/storefront/product-carousel-section";
import { PromoBannerSection } from "@/components/storefront/promo-banner-section";
import { getCategoryTree, listStorefrontProducts } from "@/lib/api/storefront";
import { getSettings } from "@/lib/api/settings";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

interface SectionPreviewProps {
  type: HomepageSectionType;
  values: Record<string, unknown>;
}

const PREVIEW_NOTE = "text-center text-xs text-ink-400 py-10 px-4";

/** Same-app-shares-storefront-components live preview — renders the real storefront component
 * fed by the form's current (unsaved) values, so an admin sees the effect of an edit instantly
 * instead of having to save and go check the live site. */
export function SectionPreview({ type, values }: SectionPreviewProps) {
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 5 * 60 * 1000 });
  const settings = settingsData?.settings;
  const storeName = settings?.storeName ?? "Your Store";
  const tagline = settings?.tagline ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-ink-100 bg-cream-100">
      <p className="border-b border-ink-100 bg-cream-50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-400">
        Live preview
      </p>
      <div className="max-h-[65vh] overflow-y-auto">
        <SectionPreviewBody type={type} values={values} storeName={storeName} tagline={tagline} />
      </div>
    </div>
  );
}

function SectionPreviewBody({
  type,
  values,
  storeName,
  tagline,
}: {
  type: HomepageSectionType;
  values: Record<string, unknown>;
  storeName: string;
  tagline: string | null;
}) {
  switch (type) {
    case "HERO": {
      const config = values as HeroConfig;
      return (
        <div className="scale-[0.6] origin-top">
          <Hero tagline={tagline} headline={config.headline} subtext={config.subtext} ctaLabel={config.ctaLabel} ctaHref={config.ctaHref} />
          <p className={PREVIEW_NOTE}>Only rendered when no hero banners are active.</p>
        </div>
      );
    }
    case "TRUST_STRIP": {
      const config = values as TrustStripConfig;
      return config.items?.length ? <TrustStrip items={config.items} /> : <p className={PREVIEW_NOTE}>Add at least one item.</p>;
    }
    case "PERSONALIZED_LEAD": {
      const config = values as PersonalizedLeadConfig;
      const title = (config.titleTemplate || "More {category}, picked for you").replace("{category}", "Shirts");
      return (
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <p className="mb-1 text-xs uppercase tracking-[0.3em] text-brass-500">{config.eyebrow || "Welcome back"}</p>
          <h2 className="font-display text-2xl text-ink-900">{title}</h2>
          <p className={PREVIEW_NOTE}>Only shown to returning visitors — sample category shown here.</p>
        </div>
      );
    }
    case "PRODUCT_CAROUSEL":
      return <ProductCarouselPreview config={values as ProductCarouselConfig} />;
    case "CATEGORY_GRID":
      return <CategoryGridPreview heading={(values as CategoryGridConfig).heading} />;
    case "BRAND_STORY": {
      const config = values as BrandStoryConfig;
      return (
        <BrandStory
          storeName={storeName}
          tagline={tagline}
          heading={config.heading}
          bodyText={config.bodyText}
          ctaLabel={config.ctaLabel}
          ctaHref={config.ctaHref}
          imageUrl={config.imageUrl}
        />
      );
    }
    case "VALUES_GRID": {
      const config = values as ValuesGridConfig;
      return config.items?.length ? (
        <ValuesGrid storeName={storeName} items={config.items} />
      ) : (
        <p className={PREVIEW_NOTE}>Add at least one item.</p>
      );
    }
    case "SMART_RECOMMENDATIONS": {
      const config = values as SmartRecommendationsConfig;
      return (
        <div className="mx-auto max-w-7xl px-4 py-10 text-center sm:px-6 lg:px-8">
          <h2 className="font-display text-2xl text-ink-900">{config.title || "Trending In Your Budget"}</h2>
          <p className={PREVIEW_NOTE}>Products are picked automatically per visitor.</p>
        </div>
      );
    }
    case "PROMO_BANNER": {
      const config = values as PromoBannerConfig;
      if (!config.imageUrl) return <p className={PREVIEW_NOTE}>Upload an image to see the preview.</p>;
      return (
        <PromoBannerSection
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

async function resolveProductCarouselProducts(config: ProductCarouselConfig) {
  const { source, category, itemCount } = config;
  if (source === "category" && category) return listStorefrontProducts({ category, pageSize: itemCount });
  if (source === "new") return listStorefrontProducts({ pageSize: itemCount });
  const featured = await listStorefrontProducts({ featured: true, pageSize: itemCount });
  return featured.items.length > 0 ? featured : listStorefrontProducts({ pageSize: itemCount });
}

function ProductCarouselPreview({ config }: { config: ProductCarouselConfig }) {
  const debounced = useDebouncedValue(config, 400);
  const { data, isLoading } = useQuery({
    queryKey: ["homepage-preview-carousel", debounced.source, debounced.category, debounced.itemCount],
    queryFn: () => resolveProductCarouselProducts(debounced),
    enabled: Boolean(debounced.itemCount),
  });
  const products = data?.items ?? [];

  if (isLoading) return <p className={PREVIEW_NOTE}>Loading preview…</p>;
  if (products.length === 0) return <p className={PREVIEW_NOTE}>No products match this selection.</p>;
  return <ProductCarouselSection heading={debounced.heading || "Featured"} subtitle={debounced.subtitle} products={products} />;
}

function CategoryGridPreview({ heading }: { heading?: string | null }) {
  const { data } = useQuery({ queryKey: ["homepage-preview-category-tree"], queryFn: getCategoryTree, staleTime: 5 * 60 * 1000 });
  const tree = data?.tree ?? [];
  if (tree.length === 0) return <p className={PREVIEW_NOTE}>No categories yet.</p>;
  return <CategoryGrid categories={tree} heading={heading} />;
}
