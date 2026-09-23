import { Suspense } from "react";
import Link from "next/link";
import DOMPurify from "isomorphic-dompurify";
import type { Product, PublicSection } from "@clothing-brand/shared";
import { ProductPageBody } from "@/components/storefront/product-page-body";
import { ProductCarousel } from "@/components/storefront/product-carousel";
import { ProductCarouselSkeleton } from "@/components/storefront/skeletons/product-carousel-skeleton";
import { RecentlyViewedCarousel } from "@/components/storefront/recently-viewed-carousel";
import { TrackProductView } from "@/components/storefront/track-product-view";
import { ProductReviews } from "@/components/storefront/product-reviews";
import {
  getBudgetAlternatives,
  getBundleForProduct,
  getPremiumAlternatives,
  getProductRail,
  getSiteSettings,
  getUrgencySignals,
} from "@/lib/api/storefront";
import { formatPrice } from "@/lib/format";
import { buildAccordionItems, productPageLayout, sanitizeRichTextSpecs } from "@/lib/product-specs";
import { buildProductJsonLd } from "@/lib/structured-data";
import { getSiteUrl } from "@/lib/seo";
import { jsonLdString } from "@clothing-brand/shared";
import { productEditHref } from "@/lib/admin-routes";

// Each list fetches and streams independently via its own Suspense boundary, instead of the whole page waiting on
// every recommendation endpoint before it can paint — the above-the-fold product info is only blocked on what it needs.

async function BundleCarousel({ productId, title }: { productId: string; title: string }) {
  const { result: bundleResult } = await getBundleForProduct(productId);
  if (!bundleResult) return null;

  const discountLabel =
    bundleResult.bundle.discountType === "PERCENTAGE"
      ? `Save ${bundleResult.bundle.discountValue}%`
      : `Save ${formatPrice(bundleResult.bundle.discountValue)}`;

  return <ProductCarousel title={`${title} — ${discountLabel}`} eyebrow={bundleResult.bundle.name} products={bundleResult.suggestedProducts} />;
}

/** One of the hand-pickable lists: the admin's picks, or the automatic list that always fed it. */
async function RailCarousel({ productId, railKey, title }: { productId: string; railKey: Parameters<typeof getProductRail>[1]; title: string }) {
  const { items } = await getProductRail(productId, railKey);
  return <ProductCarousel title={title} products={items} />;
}

async function BudgetCarousel({ productId, title }: { productId: string; title: string }) {
  const { items } = await getBudgetAlternatives(productId);
  return <ProductCarousel title={title} products={items} />;
}

async function PremiumCarousel({ productId, title }: { productId: string; title: string }) {
  const { items } = await getPremiumAlternatives(productId);
  return <ProductCarousel title={title} products={items} />;
}

const RAIL_KEYS = new Set(["related", "frequentlyBought", "crossSell", "upsell", "recommended"]);

function Block({ section, product }: { section: PublicSection; product: Product }) {
  const wrap = (node: React.ReactNode) => <Suspense fallback={<ProductCarouselSkeleton />}>{node}</Suspense>;

  if (section.key === "reviews") return <ProductReviews productId={product.id} productName={product.name} />;
  if (section.key === "recentlyViewed") return <RecentlyViewedCarousel excludeProductId={product.id} />;
  if (section.key === "bundle") return wrap(<BundleCarousel productId={product.id} title={section.title} />);
  if (section.key === "budget") return wrap(<BudgetCarousel productId={product.id} title={section.title} />);
  if (section.key === "premium") return wrap(<PremiumCarousel productId={product.id} title={section.title} />);
  if (RAIL_KEYS.has(section.key)) {
    return wrap(<RailCarousel productId={product.id} railKey={section.key as Parameters<typeof getProductRail>[1]} title={section.title} />);
  }
  return null;
}

const NO_SIGNALS = { totalViews: 0, recentPurchaseCount: 0, unitsSoldLast7Days: 0, isFastSelling: false };

interface ProductPageViewProps {
  product: Product;
  /** "preview" is the admin's view of a draft: same components and same data shape as the live page, but no view
   * tracking, no structured data for search engines, and a banner saying it isn't live. */
  mode: "live" | "preview";
  previewStatus?: string;
}

/** The whole product page. The live route and the admin preview both render this, so the preview can't drift. */
export async function ProductPageView({ product: rawProduct, mode, previewStatus }: ProductPageViewProps) {
  // RICH_TEXT values are admin-authored HTML, sanitized here on the server before the client showcase renders them.
  const sanitize = (html: string) => DOMPurify.sanitize(html);
  const product = sanitizeRichTextSpecs(rawProduct, sanitize);
  const live = mode === "live";
  const [urgencySignals, { settings }] = await Promise.all([live ? getUrgencySignals(product.id) : Promise.resolve(NO_SIGNALS), getSiteSettings()]);

  const accordionItems = buildAccordionItems(product, sanitize);
  const { showSizeGuideLink, blocks, faqEnabled } = productPageLayout(product);
  const faqs = product.resolved?.faqs ?? [];
  const siteUrl = getSiteUrl();

  return (
    <>
      {!live && (
        <div className="sticky top-0 z-40 border-b border-brass-300 bg-brass-100 px-4 py-2 text-center text-sm text-brass-900" role="status" data-testid="preview-banner">
          <strong>Preview</strong> — this is how customers will see it{previewStatus && previewStatus !== "PUBLISHED" ? `. It is a ${previewStatus.toLowerCase()} and not visible on the store yet` : ""}. It shows the saved product.{" "}
          <Link href={productEditHref(product.id)} className="underline">
            Back to editor
          </Link>
        </div>
      )}
      {live && <TrackProductView productId={product.id} productName={product.name} categoryId={product.categoryId} price={Number(product.basePrice)} />}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {live && (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(buildProductJsonLd(product, siteUrl, settings)) }} />
        )}
        {live && faqEnabled && faqs.length > 0 && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: jsonLdString({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
              }),
            }}
          />
        )}
        <ProductPageBody product={product} urgencySignals={urgencySignals} accordionItems={accordionItems} showSizeGuideLink={showSizeGuideLink} />
      </div>

      {blocks.map((section) => (
        <Block key={section.key} section={section} product={product} />
      ))}
    </>
  );
}
