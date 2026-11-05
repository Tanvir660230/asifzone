"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Eye, Plus, Scale } from "lucide-react";
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
 * Honey product card: a charcoal panel holding a 5:6 photograph, the name and the price. A round orange button adds to the
 * bag on every screen; on wide screens quick view and compare appear on hover. Behaviour is the classic card's exactly — the
 * same availability, price, badge, add-to-cart hook, options dialog, quick view and compare.
 */
export function HoneyProductCard({ product, priority }: { product: Product; priority?: boolean }) {
  const [primaryImage, secondaryImage] = product.images;
  const availability = availabilityOf(product);
  const sellableVariants = product.variants.filter((v) => availability.variants[v.id]?.sellable);
  const soldOut = !availability.inStock;
  const totalStock = availability.sellableUnits ?? Number.POSITIVE_INFINITY;
  const shown = productDisplayPrice(product);
  // As on the classic card, a discount or "low stock" tag on something that can't be bought only teases.
  const badge = soldOut ? null : getProductBadge(product, totalStock);
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
  const hasWas = !soldOut && shown.was !== null && Number(shown.was) > Number(shown.price);
  const quickAddLabel = needsChoice ? "Choose options" : "Add to bag";

  return (
    // Pressed on a phone the card sinks (ui-press) and stays dimmed until the product page arrives (navigation-progress).
    <div data-nav-pending-scope className="ui-press group min-w-0 rounded-2xl bg-surface p-2 pb-4">
      <div className="relative aspect-[5/6] overflow-hidden rounded-xl bg-cream-200">
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
                  soldOut && "opacity-70 saturate-50",
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
              "pointer-events-none absolute left-2 top-2 rounded-full px-2.5 py-1 text-xs font-medium",
              soldOut ? "bg-canvas text-fg" : badge!.tone === "sale" ? "bg-sale-500 text-white" : "bg-canvas text-fg",
            )}
            data-testid={soldOut ? "card-sold-out" : undefined}
          >
            {soldOut ? "Sold out" : sentenceCase(badge!.label)}
          </span>
        )}

        <WishlistButton
          productId={product.id}
          className="absolute right-1.5 top-1.5 z-10 h-10 w-10 rounded-full bg-canvas/70 bg-none text-fg shadow-none backdrop-saturate-100 hover:scale-100 hover:text-[color:var(--nav-hover)]"
        />

        {!soldOut && (
          <>
            <button
              type="button"
              onClick={handleQuickAdd}
              aria-label={quickAddLabel}
              data-fab-collision
              className="absolute bottom-2.5 right-2.5 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-fg transition-colors duration-200 hover:bg-accent-hover"
            >
              <Plus size={20} strokeWidth={2.2} />
            </button>
            {/* Wide screens: quick view and compare on hover or keyboard focus. They keep the classic card's names. */}
            <div className="absolute bottom-2.5 left-2.5 z-10 hidden gap-1.5 opacity-0 transition-opacity duration-200 ease-smooth group-focus-within:opacity-100 group-hover:opacity-100 lg:flex">
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  openQuickView(product);
                }}
                aria-label="Quick view"
                title="Quick view"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas text-fg transition-colors duration-200 hover:bg-surface"
              >
                <Eye size={17} />
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
                className={cn("flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-200", isComparing ? "bg-accent text-accent-fg" : "bg-canvas text-fg hover:bg-surface")}
              >
                <Scale size={17} />
              </button>
            </div>
          </>
        )}
      </div>

      <Link href={href} className="mt-3 block px-2">
        <h3 className="line-clamp-2 text-[0.9375rem] font-medium leading-snug text-fg sm:text-base">
          {product.name}
        </h3>
        {product.reviewCount > 0 && (
          <span className="mt-1 flex items-center gap-1.5">
            <StarRating value={product.avgRating} size={11} />
            <span className="text-xs text-fg-muted">({product.reviewCount})</span>
          </span>
        )}
        <span className="mt-1.5 flex items-baseline gap-2 tabular-nums">
          <span className={cn("font-display text-[1.1875rem] font-semibold tracking-normal sm:text-[1.3125rem]", soldOut ? "text-fg-muted" : hasWas ? "text-sale-600" : "text-fg")} data-testid="card-price">
            <Money value={shown.price} />
          </span>
          {hasWas && <span className="text-sm text-fg-muted line-through"><Money value={shown.was!} /></span>}
        </span>
        {colors.length > 1 && (
          <span className="mt-2.5 flex items-center gap-1.5" aria-label={`${colors.length} colours`}>
            {colors.slice(0, 6).map(([color, hex]) => (
              <span
                key={color}
                title={color}
                className={cn("h-3 w-3 rounded-full border", isPaleColor(hex) ? "border-line-strong" : "border-transparent")}
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
