"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, RotateCcw, Truck } from "lucide-react";
import { NO_SIZE_VALUE, pickGalleryImages, type PolicyHighlightKind, type Product, type ProductVariant } from "@clothing-brand/shared";
import { ProductGallery } from "@/components/storefront/product-gallery";
import { StarRating } from "@/components/storefront/star-rating";
import { VariantSelector } from "@/components/storefront/variant-selector";
import type { PickerIntent } from "@/components/storefront/variant-picker-dialog";
import { UrgencySignals } from "@/components/storefront/urgency-signals";
import { AdminSalesBadge } from "@/components/storefront/admin-sales-badge";
import { CountdownTimer } from "@/components/storefront/countdown-timer";
import { ProductAccordion } from "@/components/storefront/product-accordion";
import { StickyAddToCart } from "@/components/storefront/sticky-add-to-cart";
import { DeliveryEstimate } from "@/components/storefront/delivery-estimate";
import { ShareButton } from "@/components/storefront/share-button";
import { WhatsAppOrderButton } from "@/components/storefront/whatsapp-order-button";
import { Money } from "@/components/ui/money";
import { percentOffLabel, variantDisplayPrice } from "@/lib/pricing-display";
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
  /** How to get it: the store's delivery fees and its WhatsApp link (null = no active WhatsApp link). Absent in the admin
   * wizard's preview, which then shows the dates alone. */
  orderHelp?: { fees: { insideDhaka: string; elsewhere: string }; whatsappUrl: string | null };
  /** The store's name: a product whose brand is the store itself doesn't repeat it above its title. */
  storeName?: string;
}

/** Owns the one piece of state that needs to be shared between the gallery and the variant
 * selector — which image is currently "in focus" — since they live in separate, non-adjacent
 * parts of the two-column layout and neither can see the other's props directly. */
export function ProductShowcase({ product, urgencySignals, accordionItems, showSizeGuideLink, policyLines = [], orderHelp, storeName }: ProductShowcaseProps) {
  // The store's own name above every one of its products says nothing the header logo doesn't; another brand's name does.
  const brand = product.brand && product.brand.trim().toLowerCase() !== storeName?.trim().toLowerCase() ? product.brand : null;
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

  // The mobile sticky bar shows whenever the inline Add to Cart/Buy Now row is off screen — still below the fold on
  // first load, or scrolled past — so the way to buy is always one tap away, and never twice on screen at once. The
  // name and price sit above the photo's fold line on a phone, so the bar no longer covers what the shopper is reading.
  useEffect(() => {
    const target = buttonsRef.current?.querySelector("[data-inline-actions]") ?? buttonsRef.current;
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

  // The options named in a WhatsApp order: whatever the shopper has chosen so far, labelled as the pickers label them.
  const dimensionLabel = (field: "size" | "color", fallback: string) => resolved?.variantDimensions.find((d) => d.targetField === field)?.label ?? fallback;
  const whatsappOptions = [
    ...(selection.size && selection.size !== NO_SIZE_VALUE ? [{ label: dimensionLabel("size", "Size"), value: selection.size }] : []),
    ...(selection.color ? [{ label: dimensionLabel("color", "Color"), value: selection.color }] : []),
  ];

  return (
    <div className="grid grid-cols-1 gap-5 sm:gap-8 lg:mt-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
      {/* From 1024px the gallery stays in view while the details beside it scroll past. */}
      <div className="lg:sticky lg:top-[calc(var(--sticky-top)+1.5rem)] lg:self-start lg:transition-[top] lg:duration-slow lg:ease-smooth">
        <ProductGallery images={galleryImages} productName={product.name} />
      </div>

      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs ui-caps text-ink-400">
              {/* The price tier is presentation a theme may hide (--product-tier-display); the brand always shows. */}
              <span className="[display:var(--product-tier-display)]">
                {product.brandTier}
                {brand ? " · " : ""}
              </span>
              {brand ?? ""}
            </p>
            <h1 className="ui-product-title mt-1 text-ink-900">{product.name}</h1>
          </div>
          <ShareButton title={product.name} />
        </div>
        {product.reviewCount > 0 && (
          <a href="#reviews" className="mt-2 flex items-center gap-2 text-sm text-ink-500 hover:text-brass-600">
            <StarRating value={product.avgRating} />
            <span>
              {product.avgRating.toFixed(1)} ({product.reviewCount} review{product.reviewCount === 1 ? "" : "s"})
            </span>
          </a>
        )}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:mt-4">
          <span className={shown.flash ? "text-2xl font-bold tabular-nums text-ink-900" : "text-2xl font-semibold tabular-nums text-ink-900"} data-testid="product-price">
            <Money value={shown.price} />
          </span>
          {shown.was !== null && Number(shown.was) > Number(shown.price) && (
            <>
              <span className="text-base text-fg-muted line-through" data-testid="product-compare-price"><Money value={shown.was} /></span>
              {/* The same server-resolved comparison the card badge shows; no price is computed here. */}
              <span className="rounded-full bg-sale-50 px-2.5 py-0.5 text-xs font-semibold text-sale-600">{percentOffLabel(shown.price, shown.was)}% off</span>
            </>
          )}
        </div>
        {shown.flash && (
          <p className="mt-1 text-xs ui-caps text-sale-600">
            Flash sale ends in <CountdownTimer endsAt={shown.flash.endsAt} className="font-medium" />
          </p>
        )}

        {product.freeDelivery && (
          // Informational only: the product ships free; the checkout's server quote decides the fee for the whole bag (one
          // normal-delivery item means the usual fee applies — docs/ORDER_ADJUSTMENTS.md §2).
          // One line of text beside the icon: on a phone it wraps as a sentence inside a soft box, not as two broken
          // columns inside a pill.
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-success-200 bg-success-50 px-3 py-2 text-sm text-success-700 sm:inline-flex sm:items-center sm:rounded-full sm:py-1" data-testid="product-free-delivery">
            <Truck size={15} aria-hidden="true" className="mt-0.5 shrink-0 sm:mt-0" />
            <span>
              <span className="font-medium">Free delivery</span>{" "}
              <span className="text-success-700/80">· when everything in your bag ships free</span>
            </span>
          </p>
        )}

        <UrgencySignals signals={urgencySignals} />
        <AdminSalesBadge productId={product.id} />

        <div className="mt-6 sm:mt-8" ref={buttonsRef}>
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

        {orderHelp?.whatsappUrl && (
          <div className="mt-3">
            <WhatsAppOrderButton whatsappUrl={orderHelp.whatsappUrl} productName={product.name} options={whatsappOptions} />
          </div>
        )}

        <div className="mt-8">
          <DeliveryEstimate fees={orderHelp?.fees} freeDelivery={product.freeDelivery} />
        </div>

        {/* The delivery box above already gives the delivery time and fee, so the delivery policy line would say it again. */}
        {policyLines.some((l) => l.kind !== "delivery") && (
          <ul className="mt-6 space-y-3">
            {policyLines.filter((l) => l.kind !== "delivery").map(({ kind, label }) => {
              const Icon = POLICY_ICON[kind];
              return (
                <li key={kind} className="flex items-center gap-3 text-sm text-ink-600">
                  <Icon size={18} className="shrink-0 text-ink-900" aria-hidden="true" />
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
