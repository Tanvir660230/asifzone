"use client";

import { useEffect, useRef, useState } from "react";
import { Banknote, RotateCcw, Truck } from "lucide-react";
import type { Product, ProductVariant } from "@clothing-brand/shared";
import { ProductGallery } from "@/components/storefront/product-gallery";
import { StarRating } from "@/components/storefront/star-rating";
import { VariantSelector } from "@/components/storefront/variant-selector";
import { UrgencySignals } from "@/components/storefront/urgency-signals";
import { CountdownTimer } from "@/components/storefront/countdown-timer";
import { ProductAccordion } from "@/components/storefront/product-accordion";
import { StickyAddToCart } from "@/components/storefront/sticky-add-to-cart";
import { formatPrice } from "@/lib/format";

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
  const [focusImageId, setFocusImageId] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | undefined>(undefined);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const [highlightMissing, setHighlightMissing] = useState(false);
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

  const activePrice = product.activeFlashSale?.flashPrice ?? product.basePrice;

  return (
    <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2">
      <ProductGallery images={product.images} productName={product.name} focusImageId={focusImageId} />

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
              <span className="text-lg font-semibold text-ink-900">{formatPrice(product.basePrice)}</span>
              {product.compareAtPrice && (
                <span className="text-sm text-ink-400 line-through">{formatPrice(product.compareAtPrice)}</span>
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
            onVariantChange={setSelectedVariant}
            onFocusImageChange={setFocusImageId}
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
