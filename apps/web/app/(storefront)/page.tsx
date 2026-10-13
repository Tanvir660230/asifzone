import type { Metadata } from "next";
import { Fragment } from "react";
import type { Product, ProductCarouselConfig } from "@clothing-brand/shared";
import { BuyAgainRail } from "@/components/storefront/buy-again-rail";
import { HomeSection } from "@/components/storefront/home/home-section";
import {
  getActiveBanners,
  getActiveFlashSale,
  getActiveHomepageSections,
  getCategoryTree,
  getSiteSettings,
} from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph, storeShareImages } from "@/lib/seo";
import { storeLayout } from "@/lib/theme-layout";
import { loadFeaturedReviews, resolveProductCarouselProducts, type RenderableSection } from "@/lib/homepage-data";

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

export default async function HomePage() {
  const [{ sections: liveSections }, { tree }, { banners }, { flashSale }, { settings }] = await Promise.all([
    getActiveHomepageSections(),
    getCategoryTree(),
    getActiveBanners("HERO_CAROUSEL"),
    getActiveFlashSale(),
    getSiteSettings(),
  ]);
  const sections = liveSections as RenderableSection[];

  const [carouselEntries, reviews] = await Promise.all([
    Promise.all(
      sections
        .filter((section) => section.type === "PRODUCT_CAROUSEL")
        .map(async (section) => {
          const result = await resolveProductCarouselProducts(section.config as unknown as ProductCarouselConfig);
          return [section.id, result.items] as [string, Product[]];
        }),
    ),
    loadFeaturedReviews(sections),
  ]);
  const data = {
    storeName: settings.storeName,
    tagline: settings.tagline,
    tree,
    banners,
    flashSale,
    carouselProducts: new Map(carouselEntries),
    reviews,
  };

  // "Buy again" (signed-in customers only) sits in the welcome-back spot: with the personalized lead when the page has
  // one, otherwise straight after the hero.
  const buyAgainAfter = sections.find((s) => s.type === "PERSONALIZED_LEAD")?.id ?? sections.find((s) => s.type === "HERO")?.id;
  const layout = storeLayout();

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
          <HomeSection section={section} data={data} layout={layout} />
          {section.id === buyAgainAfter && <BuyAgainRail />}
        </Fragment>
      ))}
    </>
  );
}
