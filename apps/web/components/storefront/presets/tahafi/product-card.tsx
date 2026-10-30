"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { Money } from "@/components/ui/money";
import { productDisplayPrice } from "@/lib/pricing-display";
import { availabilityOf } from "@/lib/availability-display";
import { cn, isPaleColor } from "@/lib/utils";
import { useAddToCart } from "@/hooks/use-add-to-cart";
import { WishlistButton } from "../../wishlist-button";
import { getProductBadge } from "../../promo-badge";
import { StarRating } from "../../star-rating";
import { VariantPickerDialog } from "../../variant-picker-dialog";

interface ProductCardProps {
  product: Product;
  priority?: boolean;
}

/**
 * The tahafi preset's product card: the photograph unframed on the sage-washed well (4:5), a square tag flush with its
 * left edge (a live discount in olive, a note on cream), the name in the serif with the price beside it, colours as small
 * diamonds, and a round "+" to add without leaving the grid — it asks for the size first when there is a choice (the
 * options sheet). Behaviour is the classic card's (product-card.tsx): the same availability, server-resolved prices and
 * add-to-cart hook.
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

  const colors = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const v of product.variants) if (v.color && !seen.has(v.color)) seen.set(v.color, v.colorHex);
    return Array.from(seen.entries());
  }, [product.variants]);

  function handleQuickAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (needsChoice) setPickerOpen(true);
    else addToCart(1);
  }

  const tag = soldOut
    ? { label: "Sold out", className: "bg-ink-950 text-cream-50" }
    : badge && { label: badge.label, className: badge.tone === "sale" ? "bg-sale-500 text-cream-50" : "bg-[color:var(--badge-note-bg)] text-[color:var(--badge-note-fg)]" };

  return (
    <div data-nav-pending-scope className="ui-press group block">
      <div className="relative aspect-[var(--card-media-aspect)] overflow-hidden bg-cream-200">
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
            className={cn("pointer-events-none absolute left-0 top-3 px-2.5 py-1.5 text-xs font-medium leading-none", tag.className)}
            data-testid={soldOut ? "card-sold-out" : undefined}
          >
            {tag.label}
          </span>
        )}
        <WishlistButton productId={product.id} className="absolute right-2.5 top-2.5 z-10 h-8 w-8" />
        {!soldOut && (
          <button
            type="button"
            onClick={handleQuickAdd}
            aria-label={needsChoice ? `Choose a size for ${product.name}` : `Add ${product.name} to bag`}
            data-fab-collision
            className="absolute bottom-2.5 right-2.5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-ink-950 text-cream-50 shadow-float transition-transform duration-200 ease-smooth active:scale-95 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
          >
            <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
      <Link href={`/product/${product.slug}`} className="mt-3 block">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <h3 className="line-clamp-2 font-display text-[1.3125rem] leading-[1.1] text-fg sm:text-[1.4375rem]">{product.name}</h3>
          <p className="flex shrink-0 items-baseline gap-1.5 tabular-nums" data-testid="card-price">
            <span className={cn("text-[0.9375rem] font-medium", soldOut ? "text-fg-muted" : onSale ? "text-sale-500" : "text-fg")}>
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
        {colors.length > 1 && (
          <div className="mt-2.5 flex items-center gap-2" aria-label={`Colours: ${colors.map(([c]) => c).join(", ")}`}>
            {colors.slice(0, 5).map(([color, hex]) => (
              <span
                key={color}
                title={color}
                className={cn("h-2.5 w-2.5 rotate-45 border", isPaleColor(hex) ? "border-ink-300" : "border-transparent")}
                style={{ backgroundColor: hex ?? "#d4d4d4" }}
              />
            ))}
            {colors.length > 5 && <span className="text-xs text-fg-subtle">+{colors.length - 5}</span>}
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
