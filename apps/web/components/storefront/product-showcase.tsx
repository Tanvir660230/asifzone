"use client";

import { useState } from "react";
import { Banknote, RotateCcw, Truck } from "lucide-react";
import type { Product, ProductVariant } from "@clothing-brand/shared";
import { ProductGallery } from "@/components/storefront/product-gallery";
import { VariantSelector } from "@/components/storefront/variant-selector";
import { UrgencySignals } from "@/components/storefront/urgency-signals";
import { CountdownTimer } from "@/components/storefront/countdown-timer";
import { ProductAccordion } from "@/components/storefront/product-accordion";
import { formatPrice } from "@/lib/format";

const TRUST_ITEMS = [
  { icon: Truck, label: "Nationwide delivery, 1–5 business days" },
  { icon: RotateCcw, label: "7-day easy returns" },
  { icon: Banknote, label: "Cash on Delivery available" },
];

interface ProductShowcaseProps {
  product: Product;
  urgencySignals: React.ComponentProps<typeof UrgencySignals>["signals"];
}

/** Owns the one piece of state that needs to be shared between the gallery and the variant
 * selector — which image is currently "in focus" — since they live in separate, non-adjacent
 * parts of the two-column layout and neither can see the other's props directly. */
export function ProductShowcase({ product, urgencySignals }: ProductShowcaseProps) {
  const [focusImageId, setFocusImageId] = useState<string | null>(null);

  function handleVariantChange(variant: ProductVariant | undefined) {
    setFocusImageId(variant?.imageId ?? null);
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2">
      <ProductGallery images={product.images} productName={product.name} focusImageId={focusImageId} />

      <div>
        <p className="text-xs uppercase tracking-wide text-ink-400">
          {product.brandTier}
          {product.brand ? ` · ${product.brand}` : ""}
        </p>
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
            onVariantChange={handleVariantChange}
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
  );
}
