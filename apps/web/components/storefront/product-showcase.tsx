"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, RotateCcw, Truck } from "lucide-react";
import { pickGalleryImages, type PolicyHighlightKind, type Product, type ProductVariant } from "@clothing-brand/shared";
import { ProductGallery } from "@/components/storefront/product-gallery";
import { StarRating } from "@/components/storefront/star-rating";
import { VariantSelector } from "@/components/storefront/variant-selector";
import type { PickerIntent } from "@/components/storefront/variant-picker-dialog";
import { UrgencySignals } from "@/components/storefront/urgency-signals";
import { AdminSalesBadge } from "@/components/storefront/admin-sales-badge";
import { CountdownTimer } from "@/components/storefront/countdown-timer";
import { ProductAccordion } from "@/components/storefront/product-accordion";
import { StickyAddToCart } from "@/components/storefront/sticky-add-to-cart";
import { formatPrice } from "@/lib/format";
import { variantDisplayPrice } from "@/lib/pricing-display";
import type { SpecAccordionItem } from "@/lib/product-specs";

const POLICY_ICON: Record<PolicyHighlightKind, typeof Truck> = { delivery: Truck, returns: RotateCcw, cashOnDelivery: Banknote };

interface ProductShowcaseProps {
  product: Product;
  urgencySignals: React.ComponentProps<typeof UrgencySignals>["signals"];
  /** The accordion rows, already sanitized by the caller: on the server for the live page (ProductPageView), in the
   * browser for the admin wizard's live preview (isomorphic-dompurify's browser build) — see buildAccordionItems. */
  accordionItems: SpecAccordionItem[];
  /** Whether the size-guide link is switched on for this product's page sections. */
  showSizeGuideLink: boolean;
  /** The store's own policy lines (@clothing-brand/shared policyHighlights) — none when it states none. */
  policyLines?: { kind: PolicyHighlightKind; label: string }[];
}

/** Owns the one piece of state that needs to be shared between the gallery and the variant
 * selector — which image is currently "in focus" — since they live in separate, non-adjacent
 * parts of the two-column layout and neither can see the other's props directly. */
export function ProductShowcase({ product, urgencySignals, accordionItems, showSizeGuideLink, policyLines = [] }: ProductShowcaseProps) {
  const [selection, setSelection] = useState<{ size: string | null; color: string | null }>({ size: null, color: null });
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | undefined>(undefined);
  const [showStickyBar, setShowStickyBar] = useState(false);
  // The sticky bar's Add to Cart / Buy Now with no choice yet opens the same options popup as the inline buttons.
  const [pickerRequest, setPickerRequest] = useState<{ intent: PickerIntent; nonce: number } | null>(null);
  // Spec groups, size guide and variant dimensions arrive resolved from the product's type template.
  const resolved = product.resolved;
  const buttonsRef = useRef<HTMLDivElement>(null);

  function handleRequireSelection(intent: PickerIntent) {
    setPickerRequest({ intent, nonce: Date.now() });
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

  // What the shopper is looking at follows their choice: the selected colour's own images (then the shared ones),
  // or the whole gallery until they pick / when no variant of that colour has images of its own.
  const galleryImages = useMemo(() => pickGalleryImages(product.images, product.variants, selection), [product.images, product.variants, selection]);

  // The price shown is the SERVER-resolved price of the chosen variant (or the product's "from" price before a choice):
  // the canonical pricing engine already applied the variant's own price and any live flash sale — exactly what the
  // cart and checkout will charge. Formatting only here.
  const shown = variantDisplayPrice(product, selectedVariant?.id);

  return (
    <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2">
      <ProductGallery images={galleryImages} productName={product.name} />

      <div>
        <p className="text-xs ui-caps text-ink-400">
          {/* The price tier is presentation a theme may hide (--product-tier-display); the brand always shows. */}
          <span className="[display:var(--product-tier-display)]">
            {product.brandTier}
            {product.brand ? " · " : ""}
          </span>
          {product.brand ?? ""}
        </p>
        <h1 className="ui-product-title mt-1 text-ink-900">{product.name}</h1>
        {product.reviewCount > 0 && (
          <a href="#reviews" className="mt-2 flex items-center gap-2 text-sm text-ink-500 hover:text-brass-600">
            <StarRating value={product.avgRating} />
            <span>
              {product.avgRating.toFixed(1)} ({product.reviewCount} review{product.reviewCount === 1 ? "" : "s"})
            </span>
          </a>
        )}
        <div className="mt-3 flex items-center gap-3">
          <span className={shown.flash ? "text-lg font-bold text-ink-900" : "text-lg font-semibold text-ink-900"} data-testid="product-price">
            {formatPrice(shown.price)}
          </span>
          {shown.was !== null && Number(shown.was) > Number(shown.price) && (
            <span className="text-sm text-fg-muted line-through" data-testid="product-compare-price">{formatPrice(shown.was)}</span>
          )}
        </div>
        {shown.flash && (
          <p className="mt-1 text-xs ui-caps text-sale-500">
            Flash sale ends in <CountdownTimer endsAt={shown.flash.endsAt} className="font-medium" />
          </p>
        )}

        <UrgencySignals signals={urgencySignals} />
        <AdminSalesBadge productId={product.id} />

        <div className="mt-8" ref={buttonsRef}>
          <VariantSelector
            variants={product.variants}
            productId={product.id}
            productSlug={product.slug}
            productName={product.name}
            imageUrl={product.images[0]?.url ?? null}
            product={product}
            lowStockThreshold={product.lowStockThreshold}
            restockDate={product.restockDate}
            variantDimensions={resolved?.variantDimensions}
            sizeGuide={resolved?.sizeGuide.chart ?? undefined}
            showSizeGuide={showSizeGuideLink && (resolved?.sizeGuide.show ?? false)}
            onVariantChange={setSelectedVariant}
            onSelectionChange={setSelection}
            pickerRequest={pickerRequest}
          />
        </div>

        {policyLines.length > 0 && (
          <ul className="mt-8 space-y-3 border-t border-ink-100 pt-6">
            {policyLines.map(({ kind, label }) => {
              const Icon = POLICY_ICON[kind];
              return (
                <li key={kind} className="flex items-center gap-3 text-sm text-ink-600">
                  <Icon size={18} className="shrink-0 text-brass-500" aria-hidden="true" />
                  {label}
                </li>
              );
            })}
          </ul>
        )}

        <ProductAccordion items={accordionItems} />
      </div>

      <StickyAddToCart
        visible={showStickyBar}
        selectedVariant={selectedVariant}
        productId={product.id}
        productSlug={product.slug}
        productName={product.name}
        imageUrl={product.images[0]?.url ?? null}
        product={product}
        onRequireSelection={handleRequireSelection}
      />
    </div>
  );
}
