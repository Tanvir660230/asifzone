"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Eye, Scale, ShoppingBag } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { Money } from "@/components/ui/money";
import { productDisplayPrice } from "@/lib/pricing-display";
import { availabilityOf } from "@/lib/availability-display";
import { cn, isPaleColor } from "@/lib/utils";
import { useAddToCart } from "@/hooks/use-add-to-cart";
import { useQuickViewStore } from "@/store/quick-view";
import { useCompareStore } from "@/store/compare";
import { WishlistButton } from "../../wishlist-button";
import { getProductBadge } from "../../promo-badge";
import { StarRating } from "../../star-rating";
import { VariantPickerDialog } from "../../variant-picker-dialog";

/** "New Arrival" → "New arrival": the preset writes labels in sentence case. */
function sentenceCase(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

/**
 * Mihrab product card: a 4:5 photograph on sand, a small text tag, a bare heart; on desktop an "Add to bag" bar with quick
 * view and compare rises from the bottom of the photograph on hover, on touch a small square bag button. Behaviour is the
 * classic card's exactly — the same availability, price, badge, add-to-cart hook, options dialog, quick view and compare.
 */
export function MihrabProductCard({ product, priority }: { product: Product; priority?: boolean }) {
  const [primaryImage, secondaryImage] = product.images;
  const availability = availabilityOf(product);
  const sellableVariants = product.variants.filter((v) => availability.variants[v.id]?.sellable);
  const soldOut = !availability.inStock;
  const totalStock = availability.sellableUnits ?? Number.POSITIVE_INFINITY;
  const shown = productDisplayPrice(product);
  const badge = getProductBadge(product, totalStock);
  const openQuickView = useQuickViewStore((s) => s.open);
  const toggleCompare = useCompareStore((s) => s.toggle);
  const isComparing = useCompareStore((s) => s.items.some((i) => i.id === product.id));

  const needsChoice = sellableVariants.length > 1;
  const [pickerOpen, setPickerOpen] = useState(false);
  const { addToCart } = useAddToCart({
    selectedVariant: sellableVariants[0],
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

  function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }
  function handleQuickAdd(e: React.MouseEvent) {
    stop(e);
    if (needsChoice) setPickerOpen(true);
    else addToCart(1);
  }

  const href = `/product/${product.slug}`;
  const hasWas = shown.was !== null && Number(shown.was) > Number(shown.price);

  return (
    <div className="group">
      <div className="relative aspect-[4/5] overflow-hidden rounded-md bg-cream-200">
        <Link href={href} className="absolute inset-0" aria-label={product.name}>
          {primaryImage ? (
            <>
              <Image
                src={resolveImageUrl(primaryImage.url)}
                alt={primaryImage.altText ?? product.name}
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                priority={priority}
                className={cn(
                  "object-cover transition-[opacity,transform] duration-700 ease-smooth",
                  secondaryImage ? "lg:group-hover:opacity-0" : "lg:group-hover:scale-[1.03]",
                )}
              />
              {secondaryImage && (
                <Image
                  src={resolveImageUrl(secondaryImage.url)}
                  alt={secondaryImage.altText ?? product.name}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                  className="object-cover opacity-0 transition-opacity duration-700 ease-smooth group-hover:opacity-100"
                />
              )}
            </>
          ) : (
            <span className="flex h-full items-center justify-center text-sm text-fg-muted">No photo yet</span>
          )}
        </Link>

        {(badge || soldOut) && (
          <span
            className={cn(
              "absolute left-0 top-3 rounded-r-sm px-2 py-1 text-xs font-medium",
              soldOut ? "bg-ink-900 text-cream-50" : badge!.tone === "sale" ? "bg-sale-500 text-white" : "bg-canvas text-fg",
            )}
          >
            {soldOut ? "Sold out" : sentenceCase(badge!.label)}
          </span>
        )}

        <WishlistButton
          productId={product.id}
          className="absolute right-1 top-1 z-10 h-10 w-10 rounded-sm bg-transparent bg-none text-fg shadow-none backdrop-blur-none hover:scale-100 hover:text-sale-500"
        />

        {!soldOut && (
          <>
            {/* Touch: a small square button that never needs hover. */}
            <button
              type="button"
              onClick={handleQuickAdd}
              aria-label="Add to bag"
              data-fab-collision
              className="absolute bottom-2 right-2 z-10 flex h-9 w-9 items-center justify-center rounded-sm bg-canvas text-fg lg:hidden"
            >
              <ShoppingBag size={16} />
            </button>
            {/* Desktop: the bar rises on hover or keyboard focus. Quick view and compare keep the classic card's names. */}
            <div className="absolute inset-x-2 bottom-2 z-10 hidden translate-y-[calc(100%+0.5rem)] gap-1 transition-transform duration-300 ease-smooth group-focus-within:translate-y-0 group-hover:translate-y-0 lg:flex">
              <button
                type="button"
                onClick={handleQuickAdd}
                className="h-10 min-w-0 flex-1 whitespace-nowrap rounded-sm bg-accent text-sm font-medium text-accent-fg transition-colors duration-200 hover:bg-accent-hover"
              >
                Add to bag
              </button>
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  openQuickView(product);
                }}
                aria-label="Quick view"
                title="Quick view"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-canvas text-fg transition-colors duration-200 hover:bg-surface"
              >
                <Eye size={16} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  toggleCompare(product);
                }}
                aria-label={isComparing ? "Remove from compare" : "Add to compare"}
                aria-pressed={isComparing}
                title="Compare"
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-sm transition-colors duration-200",
                  isComparing ? "bg-ink-900 text-cream-50" : "bg-canvas text-fg hover:bg-surface",
                )}
              >
                <Scale size={16} />
              </button>
            </div>
          </>
        )}
      </div>

      <Link href={href} className="mt-3 block">
        <h3 className="line-clamp-2 text-[0.9375rem] leading-snug text-fg group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
          {product.name}
        </h3>
        {product.reviewCount > 0 && (
          <span className="mt-1 flex items-center gap-1.5">
            <StarRating value={product.avgRating} size={11} />
            <span className="text-xs text-fg-muted">({product.reviewCount})</span>
          </span>
        )}
        <span className="mt-1.5 flex items-baseline gap-2 tabular-nums">
          <span className={cn("text-[0.9375rem] font-medium", hasWas ? "text-sale-500" : "text-fg")}><Money value={shown.price} /></span>
          {hasWas && <span className="text-sm text-fg-muted line-through"><Money value={shown.was!} /></span>}
        </span>
        {colors.length > 1 && (
          <span className="mt-2.5 flex items-center gap-1.5" aria-label={`${colors.length} colours`}>
            {colors.slice(0, 6).map(([color, hex]) => (
              <span
                key={color}
                title={color}
                className={cn("h-3 w-3 rounded-[2px] border", isPaleColor(hex) ? "border-line-strong" : "border-transparent")}
                style={{ backgroundColor: hex ?? "#d4d4d4" }}
              />
            ))}
            {colors.length > 6 && <span className="text-xs text-fg-muted">+{colors.length - 6}</span>}
          </span>
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
