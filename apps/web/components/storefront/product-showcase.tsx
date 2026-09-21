"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, RotateCcw, Truck } from "lucide-react";
import { pickGalleryImages, type Product, type ProductVariant } from "@clothing-brand/shared";
import { ProductGallery } from "@/components/storefront/product-gallery";
import { StarRating } from "@/components/storefront/star-rating";
import { VariantSelector } from "@/components/storefront/variant-selector";
import { UrgencySignals } from "@/components/storefront/urgency-signals";
import { CountdownTimer } from "@/components/storefront/countdown-timer";
import { ProductAccordion } from "@/components/storefront/product-accordion";
import { StickyAddToCart } from "@/components/storefront/sticky-add-to-cart";
import { formatPrice } from "@/lib/format";
import { buildSpecAccordionItems } from "@/lib/product-specs";

const TRUST_ITEMS = [
  { icon: Truck, label: "Nationwide delivery, 1–5 business days" },
  { icon: RotateCcw, label: "7-day easy returns" },
  { icon: Banknote, label: "Cash on Delivery available" },
];

interface ProductShowcaseProps {
  product: Product;
  urgencySignals: React.ComponentProps<typeof UrgencySignals>["signals"];
  /** Pre-sanitized (DOMPurify, server-side) HTML for the description — sanitizing here in a client
   * component would bundle isomorphic-dompurify's jsdom fallback into the browser, where it has no
   * real filesystem and throws trying to read its default stylesheet. */
  descriptionHtml: string;
}

/** Owns the one piece of state that needs to be shared between the gallery and the variant
 * selector — which image is currently "in focus" — since they live in separate, non-adjacent
 * parts of the two-column layout and neither can see the other's props directly. */
export function ProductShowcase({ product, urgencySignals, descriptionHtml }: ProductShowcaseProps) {
  const [selection, setSelection] = useState<{ size: string | null; color: string | null }>({ size: null, color: null });
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | undefined>(undefined);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const [highlightMissing, setHighlightMissing] = useState(false);
  // Spec groups, size guide and variant dimensions arrive resolved from the product's type template.
  const resolved = product.resolved;
  const buttonsRef = useRef<HTMLDivElement>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Triggered when Add to Cart/Buy Now is clicked before a size/color is chosen — scrolls the
  // selector into view and briefly highlights whichever picker still needs a choice, so the
  // shopper isn't left staring at a button that just silently refuses to do anything.
  function handleRequireSelection() {
    buttonsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightMissing(true);
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => setHighlightMissing(false), 1600);
  }

  // Shows the mobile sticky bar only once the inline Add to Cart/Buy Now buttons have scrolled out
  // of view, so there's never two of the same action visible on screen at once.
  useEffect(() => {
    const target = buttonsRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setShowStickyBar(!entry.isIntersecting);
      },
      { rootMargin: "0px 0px -1px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  // What the shopper is looking at follows their choice: the selected colour's own images (then the shared ones),
  // or the whole gallery until they pick / when no variant of that colour has images of its own.
  const galleryImages = useMemo(() => pickGalleryImages(product.images, product.variants, selection), [product.images, product.variants, selection]);

  // A flash sale is "the price right now"; otherwise a chosen variant may sell for its own price (which is also what
  // the cart charges), with its own compare-at price.
  const variantPrice = selectedVariant?.price ?? null;
  const activePrice = product.activeFlashSale?.flashPrice ?? variantPrice ?? product.basePrice;
  const compareAt = product.activeFlashSale
    ? null
    : (selectedVariant?.compareAtPrice ?? (variantPrice ? null : product.compareAtPrice));

  return (
    <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2">
      <ProductGallery images={galleryImages} productName={product.name} />

      <div>
        <p className="text-xs uppercase tracking-wide text-ink-400">
          {product.brandTier}
          {product.brand ? ` · ${product.brand}` : ""}
        </p>
        <h1 className="mt-1 font-display text-3xl font-medium tracking-wide text-ink-900">{product.name}</h1>
        {product.reviewCount > 0 && (
          <a href="#reviews" className="mt-2 flex items-center gap-2 text-sm text-ink-500 hover:text-brass-600">
            <StarRating value={product.avgRating} />
            <span>
              {product.avgRating.toFixed(1)} ({product.reviewCount} review{product.reviewCount === 1 ? "" : "s"})
            </span>
          </a>
        )}
        <div className="mt-3 flex items-center gap-3">
          {product.activeFlashSale ? (
            <>
              <span className="text-lg font-bold text-ink-900">{formatPrice(product.activeFlashSale.flashPrice)}</span>
              <span className="text-sm text-ink-400 line-through">{formatPrice(product.basePrice)}</span>
            </>
          ) : (
            <>
              <span className="text-lg font-semibold text-ink-900" data-testid="product-price">{formatPrice(activePrice)}</span>
              {compareAt && Number(compareAt) > Number(activePrice) && (
                <span className="text-sm text-ink-400 line-through" data-testid="product-compare-price">{formatPrice(compareAt)}</span>
              )}
            </>
          )}
        </div>
        {product.activeFlashSale && (
          <p className="mt-1 text-xs uppercase tracking-wide text-sale-500">
            Flash sale ends in <CountdownTimer endsAt={product.activeFlashSale.endsAt} className="font-medium" />
          </p>
        )}

        <UrgencySignals signals={urgencySignals} />

        <div className="mt-8" ref={buttonsRef}>
          <VariantSelector
            variants={product.variants}
            productId={product.id}
            productSlug={product.slug}
            productName={product.name}
            imageUrl={product.images[0]?.url ?? null}
            basePrice={product.activeFlashSale?.flashPrice ?? product.basePrice}
            lowStockThreshold={product.lowStockThreshold}
            restockDate={product.restockDate}
            variantDimensions={resolved?.variantDimensions}
            sizeGuide={resolved?.sizeGuide.chart ?? undefined}
            showSizeGuide={resolved?.sizeGuide.show ?? false}
            onVariantChange={setSelectedVariant}
            onSelectionChange={setSelection}
            highlightMissing={highlightMissing}
            onRequireSelection={handleRequireSelection}
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
            {
              title: "Description",
              content: descriptionHtml.trim() ? descriptionHtml : "<p>No description provided yet.</p>",
              html: true,
            },
            ...buildSpecAccordionItems(resolved, product.attributes),
            {
              title: "Shipping & Returns",
              content:
                "Dispatched within 1–2 business days. Inside Dhaka: 1–2 days, outside Dhaka: 3–5 days. Unworn items with tags can be returned or exchanged within 7 days of delivery.",
            },
          ]}
        />
      </div>

      <StickyAddToCart
        visible={showStickyBar}
        selectedVariant={selectedVariant}
        productId={product.id}
        productSlug={product.slug}
        productName={product.name}
        imageUrl={product.images[0]?.url ?? null}
        basePrice={activePrice}
        price={selectedVariant ? String(selectedVariant.price ?? activePrice) : activePrice}
        onRequireSelection={handleRequireSelection}
      />
    </div>
  );
}
