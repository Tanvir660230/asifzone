import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import DOMPurify from "isomorphic-dompurify";
import { Breadcrumb } from "@/components/storefront/breadcrumb";
import { ProductShowcase } from "@/components/storefront/product-showcase";
import { ProductCarousel } from "@/components/storefront/product-carousel";
import { ProductCarouselSkeleton } from "@/components/storefront/skeletons/product-carousel-skeleton";
import { RecentlyViewedCarousel } from "@/components/storefront/recently-viewed-carousel";
import { TrackProductView } from "@/components/storefront/track-product-view";
import { ProductReviews } from "@/components/storefront/product-reviews";
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
import { formatPrice, stripHtml } from "@/lib/format";
import { buildProductJsonLd } from "@/lib/structured-data";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { resolveImageUrl } from "@/lib/image-url";

interface Props {
  // Next.js 15: params is a Promise on server components (was a plain object pre-15) — must be
  // awaited before use.
  params: Promise<{ slug: string }>;
}

async function loadProduct(slug: string) {
  try {
    return await getProductBySlug(slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadProduct(slug);
  if (!data) return { title: "Product" };

  const { product } = data;
  const title = product.seoTitle || product.name;
  const description = product.seoDescription || product.shortDescription || stripHtml(product.description) || undefined;
  const url = `${getSiteUrl()}/product/${product.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    ...buildOpenGraph({
      title,
      description,
      url,
      images: product.images.map((img) => resolveImageUrl(img.url)),
    }),
  };
}

// Each rail fetches and streams independently via its own Suspense boundary, instead of the whole
// page waiting on every recommendation endpoint (9 concurrent origin calls) before it can paint —
// the above-the-fold product info is only blocked on the 3 fetches it actually needs.

async function BundleCarousel({ productId }: { productId: string }) {
  const { result: bundleResult } = await getBundleForProduct(productId);
  if (!bundleResult) return null;

  const discountLabel =
    bundleResult.bundle.discountType === "PERCENTAGE"
      ? `Save ${bundleResult.bundle.discountValue}%`
      : `Save ${formatPrice(bundleResult.bundle.discountValue)}`;

  return (
    <ProductCarousel
      title={`Complete the Bundle — ${discountLabel}`}
      eyebrow={bundleResult.bundle.name}
      products={bundleResult.suggestedProducts}
    />
  );
}

async function SimilarCarousel({ productId }: { productId: string }) {
  const { items } = await getSimilarProducts(productId);
  return <ProductCarousel title="Best Match" products={items} />;
}

async function FrequentlyBoughtCarousel({ productId }: { productId: string }) {
  const { items } = await getFrequentlyBoughtTogether(productId);
  return <ProductCarousel title="Customers Also Bought" products={items} />;
}

async function CompleteYourLookCarousel({ productId }: { productId: string }) {
  const { items } = await getCompleteYourLook(productId);
  return <ProductCarousel title="Complete The Look" products={items} />;
}

async function UpgradeCarousel({ productId }: { productId: string }) {
  const { items } = await getUpgradeOptions(productId);
  return <ProductCarousel title="Upgrade Option" products={items} />;
}

async function BudgetAlternativeCarousel({ productId }: { productId: string }) {
  const { items } = await getBudgetAlternatives(productId);
  return <ProductCarousel title="Budget Alternative" products={items} />;
}

async function PremiumCarousel({ productId }: { productId: string }) {
  const { items } = await getPremiumAlternatives(productId);
  return <ProductCarousel title="More Premium Options" products={items} />;
}

async function TrendingCarousel() {
  const { items } = await getTrendingProducts();
  return <ProductCarousel title="Trending Now" products={items} />;
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const data = await loadProduct(slug);
  if (!data) notFound();

  const { product } = data;
  const [urgencySignals, { settings }] = await Promise.all([
    getUrgencySignals(product.id),
    getSiteSettings(),
  ]);

  const siteUrl = getSiteUrl();

  return (
    <>
      <TrackProductView
        productId={product.id}
        productName={product.name}
        categoryId={product.categoryId}
        price={Number(product.basePrice)}
      />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildProductJsonLd(product, siteUrl, settings)) }}
        />
        <Breadcrumb
          trail={[
            { name: product.category.name, href: `/category/${product.category.slug}` },
            { name: product.name },
          ]}
        />

        <ProductShowcase
          product={product}
          urgencySignals={urgencySignals}
          descriptionHtml={DOMPurify.sanitize(product.description)}
        />
      </div>

      <ProductReviews productId={product.id} productName={product.name} />

      <Suspense fallback={<ProductCarouselSkeleton />}>
        <BundleCarousel productId={product.id} />
      </Suspense>
      <Suspense fallback={<ProductCarouselSkeleton />}>
        <SimilarCarousel productId={product.id} />
      </Suspense>
      <Suspense fallback={<ProductCarouselSkeleton />}>
        <FrequentlyBoughtCarousel productId={product.id} />
      </Suspense>
      <Suspense fallback={<ProductCarouselSkeleton />}>
        <CompleteYourLookCarousel productId={product.id} />
      </Suspense>
      <Suspense fallback={<ProductCarouselSkeleton />}>
        <UpgradeCarousel productId={product.id} />
      </Suspense>
      <Suspense fallback={<ProductCarouselSkeleton />}>
        <BudgetAlternativeCarousel productId={product.id} />
      </Suspense>
      <Suspense fallback={<ProductCarouselSkeleton />}>
        <PremiumCarousel productId={product.id} />
      </Suspense>
      <Suspense fallback={<ProductCarouselSkeleton />}>
        <TrendingCarousel />
      </Suspense>
      <RecentlyViewedCarousel excludeProductId={product.id} />
    </>
  );
}
