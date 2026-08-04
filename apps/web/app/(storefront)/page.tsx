import { Hero } from "@/components/storefront/hero";
import { HeroCarousel } from "@/components/storefront/hero-carousel";
import { TrustStrip } from "@/components/storefront/trust-strip";
import { CategoryGrid } from "@/components/storefront/category-grid";
import { BrandStory } from "@/components/storefront/brand-story";
import { ProductGrid } from "@/components/storefront/product-grid";
import { FlashSaleSection } from "@/components/storefront/flash-sale-section";
import { NewsletterSection } from "@/components/storefront/newsletter-section";
import { getActiveBanners, getActiveFlashSale, getCategoryTree, listStorefrontProducts } from "@/lib/api/storefront";

export default async function HomePage() {
  const [{ tree }, featured, { banners }, { flashSale }] = await Promise.all([
    getCategoryTree(),
    listStorefrontProducts({ featured: true, pageSize: 8 }),
    getActiveBanners("HERO_CAROUSEL"),
    getActiveFlashSale(),
  ]);

  const products = featured.items.length > 0 ? featured : await listStorefrontProducts({ pageSize: 8 });

  return (
    <>
      {banners.length > 0 ? <HeroCarousel banners={banners} /> : <Hero />}
      <TrustStrip />
      {flashSale && <FlashSaleSection flashSale={flashSale} />}
      <CategoryGrid categories={tree} />
      <BrandStory />
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="mb-8 text-center font-display text-2xl text-ink-900">
          {featured.items.length > 0 ? "Featured" : "New Arrivals"}
        </h2>
        <ProductGrid products={products.items} />
      </section>
      <NewsletterSection />
    </>
  );
}
