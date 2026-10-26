"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ShoppingBag, Eye, Scale } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { Money } from "@/components/ui/money";
import { productDisplayPrice } from "@/lib/pricing-display";
import { availabilityOf } from "@/lib/availability-display";
import { cn, isPaleColor } from "@/lib/utils";
import { useAddToCart } from "@/hooks/use-add-to-cart";
import { useQuickViewStore } from "@/store/quick-view";
import { useCompareStore } from "@/store/compare";
import { WishlistButton } from "./wishlist-button";
import { PromoBadge, getProductBadge } from "./promo-badge";
import { StarRating } from "./star-rating";
import { VariantPickerDialog } from "./variant-picker-dialog";
import { storeLayout } from "@/lib/theme-layout";
import { MihrabProductCard } from "./presets/mihrab/product-card";

interface ProductCardProps {
  product: Product;
  /** Set for the first row of an above-the-fold grid/carousel (e.g. a category page's opening
   * row) so this card's primary image skips lazy-loading — it's frequently the LCP element, and
   * without this it's treated like every other (likely below-the-fold) product image. */
  priority?: boolean;
}

export function ProductCard(props: ProductCardProps) {
  return storeLayout() === "mihrab" ? <MihrabProductCard {...props} /> : <ClassicProductCard {...props} />;
}

function ClassicProductCard({ product, priority }: ProductCardProps) {
  const [primaryImage, secondaryImage] = product.images;
  // Server-derived availability (Storefront Read Model): D5 — an untracked product is never "sold out".
  const availability = availabilityOf(product);
  const sellableVariants = product.variants.filter((v) => availability.variants[v.id]?.sellable);
  const soldOut = !availability.inStock;
  const totalStock = availability.sellableUnits ?? Number.POSITIVE_INFINITY;
  const shown = productDisplayPrice(product);
  // A discount or "low stock" badge on something that can't be bought only teases: sold out hides it.
  const badge = soldOut ? null : getProductBadge(product, totalStock);
  const openQuickView = useQuickViewStore((s) => s.open);
  const toggleCompare = useCompareStore((s) => s.toggle);
  const isComparing = useCompareStore((s) => s.items.some((i) => i.id === product.id));

  // Quick-add always targets the first sellable variant (no size/color picker on a grid card) —
  // routed through the same hook VariantSelector/StickyAddToCart use, rather than a separate
  // hand-built cart item, so a future change to add-to-cart logic can't miss this path. Its price is
  // the server-resolved price, the same one the PDP and checkout use.
  const firstInStockVariant = sellableVariants[0];
  // More than one buyable option is a real choice: quick add asks (the options popup) instead of silently picking one.
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
    if (needsChoice) setPickerOpen(true);
    else addToCart(1);
  }

  return (
    <div data-nav-pending-scope className="ui-press group block transition-transform duration-300 ease-smooth hover:translate-y-[var(--card-lift)]">
      <div className="ui-card-frame relative aspect-[var(--card-media-aspect)] overflow-hidden rounded-xl bg-ink-100">
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
            <div className="flex h-full items-center justify-center text-ink-300">No image</div>
          )}
        </Link>
        {badge && (
          <span className="absolute left-3 top-3">
            <PromoBadge tone={badge.tone}>{badge.label}</PromoBadge>
          </span>
        )}
        {soldOut && (
          // A red label where the discount badge would sit — the same red "Sold out" the size tiles on the product page use.
          <span
            className="pointer-events-none absolute left-3 top-3 rounded-full bg-danger-500 px-2.5 py-1 text-[11px] font-semibold ui-caps text-white shadow-sm"
            data-testid="card-sold-out"
          >
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
        {/* Quick add: a round bag button on touch screens; from 1024px a full-width bar that slides up from the image's
            bottom edge on hover or keyboard focus — the one action a browsing shopper wants, where their pointer already is. */}
        {!soldOut && (
          <button
            onClick={handleQuickAdd}
            aria-label="Quick add to cart"
            data-fab-collision
            className="glass glossy absolute bottom-3 right-3 z-10 flex h-10 w-10 items-center justify-center gap-2 rounded-full text-ink-900 shadow-float transition-[transform,opacity,background-color] duration-300 ease-smooth active:scale-95 lg:left-3 lg:h-11 lg:w-auto lg:translate-y-3 lg:bg-surface/95 lg:text-sm lg:font-medium lg:opacity-0 lg:shadow-floatLg lg:hover:bg-surface lg:group-hover:translate-y-0 lg:group-hover:opacity-100 lg:focus-visible:translate-y-0 lg:focus-visible:opacity-100"
          >
            <ShoppingBag size={16} aria-hidden="true" />
            <span className="hidden lg:inline">{needsChoice ? "Choose options" : "Quick add"}</span>
          </button>
        )}
      </div>
      <Link href={`/product/${product.slug}`} className="mt-3 block space-y-1">
        {/* Price first, right under the photo: it is what a shopper scans a grid for, and it can never drift away from
            the photo when a name is short. Every card starts with it, so prices share one line across a row. */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          {/* Server-resolved "from" price — formatted, never computed here. */}
          <span
            className={cn("text-base tabular-nums", soldOut ? "font-medium text-ink-500" : shown.flash ? "font-bold text-ink-900" : "font-semibold text-ink-900")}
            data-testid="card-price"
          >
            <Money value={shown.price} />
          </span>
          {!soldOut && shown.was !== null && Number(shown.was) > Number(shown.price) && (
            <span className="text-xs tabular-nums text-fg-muted line-through"><Money value={shown.was} /></span>
          )}
        </div>
        <h3 className="line-clamp-2 text-sm leading-5 tracking-[var(--card-title-tracking)] text-ink-700 transition-colors duration-200 group-hover:text-ink-900">{product.name}</h3>
        <p className="text-[11px] ui-caps text-ink-400 [display:var(--card-tier-display)]">{product.brandTier}</p>
        {product.reviewCount > 0 && (
          <div className="flex items-center gap-1.5">
            <StarRating value={product.avgRating} size={11} />
            <span className="text-xs text-ink-400">({product.reviewCount})</span>
          </div>
        )}
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
            {colors.length > 5 && <span className="text-xs text-ink-400">+{colors.length - 5}</span>}
          </div>
        )}
      </Link>
      {/* Rendered outside both Links (and portalled to <body>), so a tap inside it can never navigate the card. Mounted
          only while open — a listing has dozens of cards. */}
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
