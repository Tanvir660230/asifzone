import { cache, Suspense } from "react";
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
  getActiveSocialLinksSafe,
  getBudgetAlternatives,
  getBundleForProduct,
  getPremiumAlternatives,
  getProductRail,
  getSiteSettings,
  getSiteSettingsSafe,
  getUrgencySignals,
} from "@/lib/api/storefront";
import { formatPrice } from "@/lib/format";
import { buildAccordionItems, productPageLayout, sanitizeRichTextSpecs } from "@/lib/product-specs";
import { buildProductJsonLd } from "@/lib/structured-data";
import { getSiteUrl } from "@/lib/seo";
import { jsonLdString, policyHighlights, storePolicy } from "@clothing-brand/shared";
import { productEditHref } from "@/lib/admin-routes";
import { productDisplayPrice } from "@/lib/pricing-display";

// Each list fetches and streams independently via its own Suspense boundary, instead of the whole page waiting on
// every recommendation endpoint before it can paint — the above-the-fold product info is only blocked on what it needs.

async function BundleCarousel({ productId, title, currency }: { productId: string; title: string; currency?: string }) {
  const { result: bundleResult } = await getBundleForProduct(productId);
  // A server component: no <StoreConfig> here, so the amount's currency is passed — the product's own, else the store's.
  const amountCurrency = currency ?? (await getSiteSettingsSafe()).settings.currency;
  if (!bundleResult) return null;

  const discountLabel =
    bundleResult.bundle.discountType === "PERCENTAGE"
      ? `Save ${bundleResult.bundle.discountValue}%`
      : `Save ${formatPrice(bundleResult.bundle.discountValue, amountCurrency)}`;

  return <ProductCarousel title={`${title} — ${discountLabel}`} eyebrow={bundleResult.bundle.name} products={bundleResult.suggestedProducts} />;
}

type RailKey = Parameters<typeof getProductRail>[1];
const RAIL_KEYS = new Set<string>(["related", "frequentlyBought", "crossSell", "upsell", "recommended"]);
/** Every list that is a plain "more products" rail — the ones de-duplicated against each other below. */
const LIST_KEYS = new Set<string>([...RAIL_KEYS, "budget", "premium"]);
/** A rail left with fewer products than this after de-duplication isn't worth a row of its own. */
const MIN_RAIL_PRODUCTS = 2;

async function fetchList(productId: string, key: string): Promise<{ items: Product[]; curated: boolean }> {
  try {
    if (key === "budget") return { items: (await getBudgetAlternatives(productId)).items, curated: false };
    if (key === "premium") return { items: (await getPremiumAlternatives(productId)).items, curated: false };
    const rail = await getProductRail(productId, key as RailKey);
    return { items: rail.items, curated: rail.source === "curated" };
  } catch {
    // One list failing to load takes away that row, not the product page.
    return { items: [], curated: false };
  }
}

/** The page's recommendation lists, fetched together and de-duplicated in page order: a product already shown in an
 * earlier row (or the product being viewed) doesn't repeat further down, so four rows read as four different sets of
 * products instead of the same caps four times, and an automatic row left with almost nothing is dropped. A list the
 * admin hand-picked shows exactly as picked. One resolution per request (React `cache`), shared by every row's Suspense
 * boundary; the rows still stream in after the product itself. `keys` is the comma-joined page order. */
const pageLists = cache(async (productId: string, keys: string): Promise<Record<string, Product[]>> => {
  const order = keys.split(",").filter(Boolean);
  const lists = await Promise.all(order.map((key) => fetchList(productId, key)));
  const seen = new Set<string>([productId]);
  const result: Record<string, Product[]> = {};
  order.forEach((key, i) => {
    const list = lists[i];
    if (!list) return;
    const items = list.curated ? list.items : list.items.filter((p) => !seen.has(p.id));
    if (!list.curated && items.length < MIN_RAIL_PRODUCTS) return;
    for (const p of items) seen.add(p.id);
    result[key] = items;
  });
  return result;
});

/** One of the recommendation lists (hand-picked or automatic), minus what the rows above it already showed. */
async function ListCarousel({ productId, listKey, pageKeys, title }: { productId: string; listKey: string; pageKeys: string; title: string }) {
  const items = (await pageLists(productId, pageKeys))[listKey] ?? [];
  return <ProductCarousel title={title} products={items} />;
}

function Block({ section, product, pageKeys }: { section: PublicSection; product: Product; pageKeys: string }) {
  const wrap = (node: React.ReactNode) => <Suspense fallback={<ProductCarouselSkeleton />}>{node}</Suspense>;

  if (section.key === "reviews") return <ProductReviews productId={product.id} productName={product.name} />;
  if (section.key === "recentlyViewed") return <RecentlyViewedCarousel excludeProductId={product.id} />;
  if (section.key === "bundle") return wrap(<BundleCarousel productId={product.id} title={section.title} currency={product.pricing?.currency} />);
  if (LIST_KEYS.has(section.key)) {
    return wrap(<ListCarousel productId={product.id} listKey={section.key} pageKeys={pageKeys} title={section.title} />);
  }
  return null;
}

const NO_SIGNALS = { isFastSelling: false };

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
  const [urgencySignals, { settings }, { links }] = await Promise.all([
    live ? getUrgencySignals(product.id) : Promise.resolve(NO_SIGNALS),
    getSiteSettings(),
    getActiveSocialLinksSafe(),
  ]);
  const orderHelp = {
    fees: { insideDhaka: settings.shippingFeeDhaka, elsewhere: settings.shippingFeeOutsideDhaka },
    whatsappUrl: links.find((l) => l.platform === "WHATSAPP" && l.isActive)?.url ?? null,
  };

  const policy = storePolicy(settings);
  const accordionItems = buildAccordionItems(product, sanitize, policy);
  const { showSizeGuideLink, blocks, faqEnabled } = productPageLayout(product);
  const listKeys = blocks
    .map((s) => s.key)
    .filter((key) => LIST_KEYS.has(key))
    .join(",");
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
      {live && <TrackProductView productId={product.id} productName={product.name} categoryId={product.categoryId} price={Number(productDisplayPrice(product).price)} />}
      {/* The shared page frame; the recommendation sections below carry their own spacing, so no bottom padding here. */}
      <div className="ui-page pb-0 sm:pb-0 lg:pb-0">
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
        <ProductPageBody
          product={product}
          urgencySignals={urgencySignals}
          accordionItems={accordionItems}
          showSizeGuideLink={showSizeGuideLink}
          policyLines={policyHighlights(policy)}
          orderHelp={orderHelp}
        />
      </div>

      {blocks.map((section) => (
        <Block key={section.key} section={section} product={product} pageKeys={listKeys} />
      ))}
    </>
  );
}
