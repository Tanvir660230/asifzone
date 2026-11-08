"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Minus, Plus } from "lucide-react";
import { maxSellableQuantity, NO_SIZE_VALUE, type Product } from "@clothing-brand/shared";
import { resolveImageUrl } from "@/lib/image-url";
import { Money } from "@/components/ui/money";
import { productDisplayPrice } from "@/lib/pricing-display";
import { availabilityOf } from "@/lib/availability-display";
import { cn, isPaleColor } from "@/lib/utils";
import { useAddToCart } from "@/hooks/use-add-to-cart";
import { useCartStore } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { WishlistButton } from "../../wishlist-button";
import { getProductBadge } from "../../promo-badge";
import { StarRating } from "../../star-rating";
import { VariantPickerDialog } from "../../variant-picker-dialog";

/** "New Arrival" → "New arrival": the preset writes labels in sentence case. */
function sentenceCase(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

const FLOATING_CONTROL = "absolute bottom-2 right-2 z-10 h-10 rounded-full bg-accent text-accent-fg shadow-float";

/**
 * Honey product card: a white card with a square photograph, the name, and the price. The round orange + puts the product in
 * the bag without leaving the page, then turns into a − 1 + stepper; a product with options opens the options sheet instead.
 * The bar above the tab bar and the header's bag button show the running total, so the card doesn't announce each add.
 * Availability, price, badge and the add-to-cart hook are the classic card's exactly.
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

  const needsChoice = sellableVariants.length > 1;
  const onlyVariant = needsChoice ? undefined : sellableVariants[0];
  const [pickerOpen, setPickerOpen] = useState(false);
  const { addToCart } = useAddToCart({
    selectedVariant: onlyVariant,
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    imageUrl: primaryImage?.url ?? null,
    product,
  });

  // The bag lives in the browser: `0` until mounted, so server and client markup agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const inBag = useCartStore((s) => (onlyVariant ? (s.items.find((i) => i.variantId === onlyVariant.id)?.quantity ?? 0) : 0));
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const dismissAdded = useCartDrawerStore((s) => s.dismissAdded);
  const quantity = mounted ? inBag : 0;
  const atLimit = onlyVariant ? quantity >= maxSellableQuantity(product.trackInventory, onlyVariant.stock) : false;

  const colors = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const v of product.variants) if (v.color && !seen.has(v.color)) seen.set(v.color, v.colorHex);
    return Array.from(seen.entries());
  }, [product.variants]);

  function addOne(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (needsChoice) return setPickerOpen(true);
    addToCart(1);
    dismissAdded();
  }

  const href = `/product/${product.slug}`;
  // One pack size is worth stating on the card (450 g, 6ml); several are a choice for the options sheet.
  const packSize = product.variants.length === 1 && product.variants[0]!.size !== NO_SIZE_VALUE ? product.variants[0]!.size : null;
  const hasWas = !soldOut && shown.was !== null && Number(shown.was) > Number(shown.price);
  const percentOff = hasWas ? Math.round((1 - Number(shown.price) / Number(shown.was)) * 100) : 0;
  const tag = soldOut ? "Sold out" : percentOff > 0 ? `${percentOff}% off` : badge ? sentenceCase(badge.label) : null;

  return (
    // Pressed on a phone the card sinks (ui-press) and stays dimmed until the product page arrives (navigation-progress).
    <div data-nav-pending-scope className="ui-press group flex h-full min-w-0 flex-col rounded-xl border border-line-subtle bg-surface p-2 pb-3">
      <div className="relative aspect-square overflow-hidden rounded-lg bg-surface">
        <Link href={href} className="absolute inset-0" aria-label={product.name}>
          {primaryImage ? (
            <>
              <Image
                src={resolveImageUrl(primaryImage.url)}
                alt={primaryImage.altText ?? product.name}
                fill
                sizes="(min-width: 1280px) 17vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                priority={priority}
                className={cn(
                  "object-cover transition-[opacity,transform] duration-500 ease-smooth",
                  secondaryImage ? "lg:group-hover:opacity-0" : "lg:group-hover:scale-[1.03]",
                  soldOut && "opacity-70 saturate-50",
                )}
              />
              {secondaryImage && (
                <Image
                  src={resolveImageUrl(secondaryImage.url)}
                  alt={secondaryImage.altText ?? product.name}
                  fill
                  sizes="(min-width: 1280px) 17vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                  className="object-cover opacity-0 transition-opacity duration-500 ease-smooth group-hover:opacity-100"
                />
              )}
            </>
          ) : (
            <span className="flex h-full items-center justify-center text-sm text-fg-muted">No photo yet</span>
          )}
        </Link>

        {tag && (
          <span
            className={cn(
              "pointer-events-none absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-xs font-bold",
              percentOff > 0 && !soldOut ? "bg-sale-50 text-sale-500" : "bg-canvas text-fg",
            )}
            data-testid={soldOut ? "card-sold-out" : undefined}
          >
            {tag}
          </span>
        )}

        {/* The heart is for wide screens, on hover or focus: on a phone the card stays clear for the + (the product page keeps it). */}
        <WishlistButton
          productId={product.id}
          className="absolute right-1.5 top-1.5 z-10 hidden h-9 w-9 rounded-full bg-surface bg-none text-fg opacity-0 shadow-none backdrop-saturate-100 transition-opacity duration-200 hover:scale-100 hover:text-[color:var(--nav-hover)] group-focus-within:opacity-100 group-hover:opacity-100 lg:flex"
        />

        {!soldOut &&
          (quantity > 0 && onlyVariant ? (
            <div className={cn(FLOATING_CONTROL, "flex items-center")}>
              <button type="button" onClick={() => updateQuantity(onlyVariant.id, quantity - 1)} aria-label={`Remove one ${product.name}`} className="flex h-10 w-9 items-center justify-center">
                <Minus size={16} strokeWidth={2.2} aria-hidden="true" />
              </button>
              <span className="min-w-4 text-center text-sm font-bold tabular-nums" aria-live="polite">
                {quantity}
              </span>
              <button type="button" onClick={addOne} disabled={atLimit} aria-label={`Add one more ${product.name}`} className="flex h-10 w-9 items-center justify-center disabled:opacity-40">
                <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={addOne}
              aria-label={needsChoice ? `Choose options for ${product.name}` : `Add ${product.name} to bag`}
              data-fab-collision
              className={cn(FLOATING_CONTROL, "flex w-10 items-center justify-center transition-colors duration-200 hover:bg-accent-hover")}
            >
              <Plus size={20} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ))}
      </div>

      <Link href={href} className="mt-2.5 flex flex-1 flex-col px-1">
        <h3 className="line-clamp-2 text-sm font-semibold leading-[1.25] text-fg sm:text-[0.9375rem]">{product.name}</h3>
        {product.reviewCount > 0 && (
          <span className="mt-1 flex items-center gap-1.5">
            <StarRating value={product.avgRating} size={11} />
            <span className="text-xs text-fg-muted">({product.reviewCount})</span>
          </span>
        )}
        {packSize && <span className="mt-0.5 text-[0.8125rem] text-fg-muted">{packSize}</span>}
        <span className="mt-auto flex flex-wrap items-baseline gap-x-1.5 pt-1.5 tabular-nums">
          <span className={cn("text-[1.0625rem] font-bold", soldOut ? "text-fg-muted" : "text-fg")} data-testid="card-price">
            <Money value={shown.price} />
          </span>
          {hasWas && (
            <span className="text-[0.8125rem] text-fg-subtle line-through">
              <Money value={shown.was!} />
            </span>
          )}
        </span>
        {colors.length > 1 && (
          <span className="mt-2 flex items-center gap-1.5" aria-label={`${colors.length} colours`}>
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
          onConfirm={(variant, chosen) => {
            setPickerOpen(false);
            addToCart(chosen, variant);
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
