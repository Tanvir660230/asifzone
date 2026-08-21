"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { ShoppingBag, Eye, Scale } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { formatPrice } from "@/lib/format";
import { cn, isPaleColor } from "@/lib/utils";
import { useAddToCart } from "@/hooks/use-add-to-cart";
import { useQuickViewStore } from "@/store/quick-view";
import { useCompareStore } from "@/store/compare";
import { WishlistButton } from "./wishlist-button";
import { PromoBadge, getProductBadge } from "./promo-badge";
import { StarRating } from "./star-rating";

interface ProductCardProps {
  product: Product;
  /** Set for the first row of an above-the-fold grid/carousel (e.g. a category page's opening
   * row) so this card's primary image skips lazy-loading — it's frequently the LCP element, and
   * without this it's treated like every other (likely below-the-fold) product image. */
  priority?: boolean;
}

export function ProductCard({ product, priority }: ProductCardProps) {
  const [primaryImage, secondaryImage] = product.images;
  const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);
  const flash = product.activeFlashSale;
  const badge = getProductBadge(product, totalStock);
  const openQuickView = useQuickViewStore((s) => s.open);
  const toggleCompare = useCompareStore((s) => s.toggle);
  const isComparing = useCompareStore((s) => s.items.some((i) => i.id === product.id));

  // Quick-add always targets the first in-stock variant (no size/color picker on a grid card) —
  // routed through the same hook VariantSelector/StickyAddToCart use, rather than a separate
  // hand-built cart item, so a future change to add-to-cart logic can't miss this path. basePrice
  // mirrors ProductShowcase's own flash-sale fallback so a card's quick-add honors the same price
  // the PDP would.
  const firstInStockVariant = product.variants.find((v) => v.stock > 0);
  const { addToCart, justAdded } = useAddToCart({
    selectedVariant: firstInStockVariant,
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    imageUrl: primaryImage?.url ?? null,
    basePrice: flash?.flashPrice ?? product.basePrice,
  });

  const colors = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const v of product.variants) if (!seen.has(v.color)) seen.set(v.color, v.colorHex);
    return Array.from(seen.entries());
  }, [product.variants]);

  function handleQuickView(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    openQuickView(product);
  }

  function handleToggleCompare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    toggleCompare(product);
  }

  function handleQuickAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    addToCart(1);
  }

  return (
    <div className="group block transition-transform duration-300 ease-smooth hover:-translate-y-1">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-ink-100 bg-ink-100 shadow-sm transition-shadow duration-300 ease-smooth group-hover:shadow-float">
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
                  secondaryImage ? "lg:group-hover:opacity-0" : "lg:group-hover:scale-105",
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
            <div className="flex h-full items-center justify-center text-ink-300">No image</div>
          )}
        </Link>
        {badge && (
          <span className="absolute left-3 top-3">
            <PromoBadge>{badge}</PromoBadge>
          </span>
        )}
        {totalStock === 0 && (
          <span className="absolute bottom-3 left-3 rounded-full bg-ink-900 px-2 py-1 text-xs uppercase tracking-wide text-cream-50">
            Sold out
          </span>
        )}
        {/* Desktop-only: quick view + compare need hover to gate them, and on a small mobile
            card they just add clutter on top of an already-busy image (badge, wishlist heart,
            quick-add). Mobile keeps the two actions that matter — wishlist and quick-add — and
            reaches product/compare details via the product page instead. */}
        <div className="absolute left-3 top-14 z-10 hidden flex-col gap-1.5 transition-opacity duration-200 ease-smooth lg:flex lg:opacity-0 lg:group-hover:opacity-100">
          <button
            onClick={handleQuickView}
            aria-label="Quick view"
            title="Quick view"
            className="glass flex h-8 w-8 items-center justify-center rounded-full text-ink-700 shadow-sm transition-all duration-200 ease-smooth hover:scale-110 hover:text-brass-600"
          >
            <Eye size={14} />
          </button>
          <button
            onClick={handleToggleCompare}
            aria-label={isComparing ? "Remove from compare" : "Add to compare"}
            aria-pressed={isComparing}
            title="Compare"
            className={cn(
              "glass flex h-8 w-8 items-center justify-center rounded-full shadow-sm transition-all duration-200 ease-smooth hover:scale-110",
              isComparing ? "text-brass-600" : "text-ink-700 hover:text-brass-600",
            )}
          >
            <Scale size={14} />
          </button>
        </div>
        <WishlistButton productId={product.id} className="absolute right-3 top-3 z-10 h-8 w-8" />
        {totalStock > 0 && (
          <button
            onClick={handleQuickAdd}
            aria-label="Quick add to cart"
            data-fab-collision
            className="glass glossy absolute bottom-3 right-3 z-10 flex h-10 w-10 items-center justify-center rounded-full text-ink-900 shadow-float transition-all duration-300 ease-smooth hover:scale-110 hover:bg-brass-400 active:scale-95 lg:translate-y-2 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100"
          >
            <ShoppingBag size={16} />
          </button>
        )}
        {justAdded && (
          <span className="absolute bottom-3 right-3 z-10 rounded-full bg-ink-900 px-3 py-2 text-xs text-cream-50">Added ✓</span>
        )}
      </div>
      <Link href={`/product/${product.slug}`} className="mt-3 block space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-ink-400">{product.brandTier}</p>
        <h3 className="text-sm font-medium tracking-wide text-ink-900">{product.name}</h3>
        {product.reviewCount > 0 && (
          <div className="flex items-center gap-1.5">
            <StarRating value={product.avgRating} size={11} />
            <span className="text-xs text-ink-400">({product.reviewCount})</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          {flash ? (
            <>
              <span className="text-sm font-bold text-ink-900">{formatPrice(flash.flashPrice)}</span>
              <span className="text-xs text-ink-400 line-through">{formatPrice(product.basePrice)}</span>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold text-ink-900">{formatPrice(product.basePrice)}</span>
              {product.compareAtPrice && (
                <span className="text-xs text-ink-400 line-through">{formatPrice(product.compareAtPrice)}</span>
              )}
            </>
          )}
        </div>
        {colors.length > 1 && (
          <div className="flex items-center gap-1.5 pt-0.5">
            {colors.slice(0, 5).map(([color, hex]) => (
              <span
                key={color}
                title={color}
                className={cn(
                  "h-3.5 w-3.5 rounded-full border transition-transform duration-150 ease-smooth hover:scale-125",
                  isPaleColor(hex) ? "border-ink-300" : "border-ink-200",
                )}
                style={{ backgroundColor: hex ?? "#d4d4d4" }}
              />
            ))}
            {colors.length > 5 && <span className="text-[11px] text-ink-400">+{colors.length - 5}</span>}
          </div>
        )}
      </Link>
    </div>
  );
}
