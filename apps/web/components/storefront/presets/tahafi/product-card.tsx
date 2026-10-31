"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { Money } from "@/components/ui/money";
import { productDisplayPrice } from "@/lib/pricing-display";
import { availabilityOf } from "@/lib/availability-display";
import { cn } from "@/lib/utils";
import { useAddToCart } from "@/hooks/use-add-to-cart";
import { getProductBadge } from "../../promo-badge";
import { StarRating } from "../../star-rating";
import { VariantPickerDialog } from "../../variant-picker-dialog";

interface ProductCardProps {
  product: Product;
  priority?: boolean;
}

/**
 * The tahafi preset's product card, as in the approved mockup: a white card with soft depth, the photograph square, the name
 * and a firm price under it, a tag only for a live discount, and a round glass "+" to add without leaving the grid — it
 * asks for the size first when there is a choice (the options sheet). Saving to the wishlist is on the product page.
 * Behaviour is the classic card's (product-card.tsx): the same availability, server-resolved prices and add-to-cart hook.
 */
export function TahafiProductCard({ product, priority }: ProductCardProps) {
  const [primaryImage, secondaryImage] = product.images;
  const availability = availabilityOf(product);
  const sellableVariants = product.variants.filter((v) => availability.variants[v.id]?.sellable);
  const soldOut = !availability.inStock;
  const totalStock = availability.sellableUnits ?? Number.POSITIVE_INFINITY;
  const shown = productDisplayPrice(product);
  const badge = soldOut ? null : getProductBadge(product, totalStock);
  const onSale = !soldOut && shown.was !== null && Number(shown.was) > Number(shown.price);

  const firstInStockVariant = sellableVariants[0];
  const needsChoice = sellableVariants.length > 1;
  const [pickerOpen, setPickerOpen] = useState(false);
  const { addToCart } = useAddToCart({
    selectedVariant: firstInStockVariant,
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    imageUrl: primaryImage?.url ?? null,
    product,
  });

  function handleQuickAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (needsChoice) setPickerOpen(true);
    else addToCart(1);
  }

  const tag = soldOut
    ? { label: "Sold out", className: "bg-fg text-canvas" }
    : // Only a live discount: "New Arrival" and "Limited Item" on every card read as clutter (owner, 2026-10-31).
      badge?.tone === "sale" && { label: badge.label, className: "bg-sale-500 text-white" };

  return (
    <div data-nav-pending-scope className="ui-press group block overflow-hidden rounded-[1.375rem] bg-surface shadow-[var(--card-frame-shadow)] transition-shadow duration-300 ease-smooth lg:hover:shadow-[var(--card-frame-shadow-hover)]">
      <div className="relative aspect-[var(--card-media-aspect)] overflow-hidden bg-surface">
        <Link href={`/product/${product.slug}`} className="absolute inset-0" aria-label={product.name}>
          {primaryImage ? (
            <>
              <Image
                src={resolveImageUrl(primaryImage.url)}
                alt={primaryImage.altText ?? product.name}
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                priority={priority}
                className={cn(
                  "object-cover transition-all duration-500 ease-smooth",
                  secondaryImage ? "lg:group-hover:opacity-0" : "lg:group-hover:scale-[var(--card-image-zoom)]",
                  soldOut && "opacity-70 saturate-50",
                )}
              />
              {secondaryImage && (
                <Image
                  src={resolveImageUrl(secondaryImage.url)}
                  alt={secondaryImage.altText ?? product.name}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                  className="object-cover opacity-0 transition-opacity duration-500 ease-smooth group-hover:opacity-100"
                />
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-fg-subtle">No image</div>
          )}
        </Link>
        {tag && (
          <span
            className={cn("pointer-events-none absolute left-2.5 top-2.5 rounded-full px-2.5 py-1.5 text-xs font-semibold leading-none", tag.className)}
            data-testid={soldOut ? "card-sold-out" : undefined}
          >
            {tag.label}
          </span>
        )}
        {!soldOut && (
          <button
            type="button"
            onClick={handleQuickAdd}
            aria-label={needsChoice ? `Choose a size for ${product.name}` : `Add ${product.name} to bag`}
            data-fab-collision
            className="glass-panel absolute bottom-2.5 right-2.5 z-10 flex h-10 w-10 items-center justify-center rounded-full text-fg transition-transform duration-200 ease-smooth active:scale-95"
          >
            <Plus size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
      <Link href={`/product/${product.slug}`} className="block px-3.5 pb-3.5 pt-2.5">
        <div>
          <h3 className="line-clamp-2 text-[0.9375rem] font-semibold leading-snug text-fg">{product.name}</h3>
          <p className="mt-1 flex items-baseline gap-1.5 tabular-nums" data-testid="card-price">
            <span className={cn("text-[0.9375rem] font-bold", soldOut ? "text-fg-muted" : onSale ? "text-sale-600" : "text-fg")}>
              <Money value={shown.price} />
            </span>
            {onSale && (
              <s className="text-xs text-fg-subtle">
                <Money value={shown.was!} />
              </s>
            )}
          </p>
        </div>
        {product.reviewCount > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <StarRating value={product.avgRating} size={11} />
            <span className="text-xs text-fg-subtle">({product.reviewCount})</span>
          </div>
        )}
      </Link>
      {pickerOpen && (
        <VariantPickerDialog
          open
          intent="cart"
          onClose={() => setPickerOpen(false)}
          onConfirm={(variant, quantity) => {
            setPickerOpen(false);
            addToCart(quantity, variant);
          }}
          variants={product.variants}
          product={product}
          lowStockThreshold={product.lowStockThreshold}
          productName={product.name}
          imageUrl={primaryImage?.url ?? null}
          variantDimensions={product.resolved?.variantDimensions}
        />
      )}
    </div>
  );
}
