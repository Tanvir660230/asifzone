import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Banknote, RotateCcw, Truck } from "lucide-react";
import { Breadcrumb } from "@/components/storefront/breadcrumb";
import { ProductGallery } from "@/components/storefront/product-gallery";
import { VariantSelector } from "@/components/storefront/variant-selector";
import { ProductCarousel } from "@/components/storefront/product-carousel";
import { RecentlyViewedCarousel } from "@/components/storefront/recently-viewed-carousel";
import { TrackProductView } from "@/components/storefront/track-product-view";
import { UrgencySignals } from "@/components/storefront/urgency-signals";
import { CountdownTimer } from "@/components/storefront/countdown-timer";
import { ProductAccordion } from "@/components/storefront/product-accordion";
import {
  getBudgetAlternatives,
  getBundleForProduct,
  getCompleteYourLook,
  getFrequentlyBoughtTogether,
  getPremiumAlternatives,
  getProductBySlug,
  getSimilarProducts,
  getSiteSettings,
  getTrendingProducts,
  getUpgradeOptions,
  getUrgencySignals,
} from "@/lib/api/storefront";
import { formatPrice } from "@/lib/format";
import { buildProductJsonLd } from "@/lib/structured-data";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { env } from "@/lib/env";

const TRUST_ITEMS = [
  { icon: Truck, label: "Nationwide delivery, 1–5 business days" },
  { icon: RotateCcw, label: "7-day easy returns" },
  { icon: Banknote, label: "Cash on Delivery available" },
];

interface Props {
  params: { slug: string };
}

async function loadProduct(slug: string) {
  try {
    return await getProductBySlug(slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await loadProduct(params.slug);
  if (!data) return { title: "Product" };

  const { product } = data;
  const title = product.seoTitle || product.name;
  const description = product.seoDescription || product.description || undefined;
  const url = `${getSiteUrl()}/product/${product.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    ...buildOpenGraph({
      title,
      description,
      url,
      images: product.images.map((img) => `${env.apiUrl}${img.url}`),
    }),
  };
}

export default async function ProductPage({ params }: Props) {
  const data = await loadProduct(params.slug);
  if (!data) notFound();

  const { product } = data;
  const [
    similar,
    frequentlyBoughtTogether,
    completeYourLook,
    upgradeOptions,
    budgetAlternatives,
    premiumAlternatives,
    trending,
    urgencySignals,
    { settings },
    { result: bundleResult },
  ] = await Promise.all([
    getSimilarProducts(product.id),
    getFrequentlyBoughtTogether(product.id),
    getCompleteYourLook(product.id),
    getUpgradeOptions(product.id),
    getBudgetAlternatives(product.id),
    getPremiumAlternatives(product.id),
    getTrendingProducts(),
    getUrgencySignals(product.id),
    getSiteSettings(),
    getBundleForProduct(product.id),
  ]);

  const bundleDiscountLabel = bundleResult
    ? bundleResult.bundle.discountType === "PERCENTAGE"
      ? `Save ${bundleResult.bundle.discountValue}%`
      : `Save ${formatPrice(bundleResult.bundle.discountValue)}`
    : null;

  const siteUrl = getSiteUrl();

  return (
    <>
      <TrackProductView productId={product.id} categoryId={product.categoryId} price={Number(product.basePrice)} />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildProductJsonLd(product, siteUrl, settings.storeName)) }}
        />
        <Breadcrumb
          trail={[
            { name: product.category.name, href: `/category/${product.category.slug}` },
            { name: product.name },
          ]}
        />

        <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2">
          <ProductGallery images={product.images} productName={product.name} />

          <div>
            <p className="text-xs uppercase tracking-wide text-ink-400">{product.brandTier}</p>
            <h1 className="mt-1 font-display text-3xl text-ink-900">{product.name}</h1>
            <div className="mt-3 flex items-center gap-3">
              {product.activeFlashSale ? (
                <>
                  <span className="text-lg text-danger-600">{formatPrice(product.activeFlashSale.flashPrice)}</span>
                  <span className="text-sm text-ink-400 line-through">{formatPrice(product.basePrice)}</span>
                </>
              ) : (
                <>
                  <span className="text-lg text-ink-900">{formatPrice(product.basePrice)}</span>
                  {product.compareAtPrice && (
                    <span className="text-sm text-ink-400 line-through">{formatPrice(product.compareAtPrice)}</span>
                  )}
                </>
              )}
            </div>
            {product.activeFlashSale && (
              <p className="mt-1 text-xs uppercase tracking-wide text-danger-600">
                Flash sale ends in <CountdownTimer endsAt={product.activeFlashSale.endsAt} className="font-medium" />
              </p>
            )}

            <UrgencySignals signals={urgencySignals} />

            <div className="mt-8">
              <VariantSelector
                variants={product.variants}
                productId={product.id}
                productSlug={product.slug}
                productName={product.name}
                imageUrl={product.images[0]?.url ?? null}
                basePrice={product.activeFlashSale?.flashPrice ?? product.basePrice}
                lowStockThreshold={product.lowStockThreshold}
                restockDate={product.restockDate}
              />
            </div>

            <div className="mt-8 space-y-3 border-t border-ink-100 pt-6">
              {TRUST_ITEMS.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-3 text-sm text-ink-600">
                  <Icon size={18} className="shrink-0 text-brass-500" />
                  {label}
                </div>
              ))}
            </div>

            <ProductAccordion
              items={[
                { title: "Description", content: product.description || "No description provided yet." },
                {
                  title: "Care",
                  content: "Machine wash cold with like colors. Do not bleach. Tumble dry low. Iron on low heat if needed.",
                },
                {
                  title: "Shipping & Returns",
                  content:
                    "Dispatched within 1–2 business days. Inside Dhaka: 1–2 days, outside Dhaka: 3–5 days. Unworn items with tags can be returned or exchanged within 7 days of delivery.",
                },
              ]}
            />
          </div>
        </div>
      </div>

      {bundleResult && (
        <ProductCarousel
          title={`Complete the Bundle${bundleDiscountLabel ? ` — ${bundleDiscountLabel}` : ""}`}
          eyebrow={bundleResult.bundle.name}
          products={bundleResult.suggestedProducts}
        />
      )}
      <ProductCarousel title="Best Match" products={similar.items} />
      <ProductCarousel title="Customers Also Bought" products={frequentlyBoughtTogether.items} />
      <ProductCarousel title="Complete The Look" products={completeYourLook.items} />
      <ProductCarousel title="Upgrade Option" products={upgradeOptions.items} />
      <ProductCarousel title="Budget Alternative" products={budgetAlternatives.items} />
      <ProductCarousel title="More Premium Options" products={premiumAlternatives.items} />
      <ProductCarousel title="Trending Now" products={trending.items} />
      <RecentlyViewedCarousel excludeProductId={product.id} />
    </>
  );
}
