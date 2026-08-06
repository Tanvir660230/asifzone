"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ShoppingBag, Eye, Scale } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { env } from "@/lib/env";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/store/cart";
import { useQuickViewStore } from "@/store/quick-view";
import { useCompareStore } from "@/store/compare";
import { WishlistButton } from "./wishlist-button";

export function ProductCard({ product }: { product: Product }) {
  const [primaryImage, secondaryImage] = product.images;
  const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);
  const flash = product.activeFlashSale;
  const addItem = useCartStore((s) => s.addItem);
  const [justAdded, setJustAdded] = useState(false);
  const openQuickView = useQuickViewStore((s) => s.open);
  const toggleCompare = useCompareStore((s) => s.toggle);
  const isComparing = useCompareStore((s) => s.items.some((i) => i.id === product.id));

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
    const variant = product.variants.find((v) => v.stock > 0);
    if (!variant) return;
    addItem({
      variantId: variant.id,
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      price: Number(flash?.flashPrice ?? variant.price ?? product.basePrice),
      imageUrl: primaryImage?.url ?? null,
      maxStock: variant.stock,
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2000);
  }

  return (
    <Link href={`/product/${product.slug}`} className="group block">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-ink-100 shadow-sm transition-shadow duration-300 ease-smooth group-hover:shadow-float">
        {primaryImage ? (
          <>
            <Image
              src={`${env.apiUrl}${primaryImage.url}`}
              alt={primaryImage.altText ?? product.name}
              fill
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              className={cn(
                "object-cover transition-all duration-500 ease-smooth",
                secondaryImage ? "lg:group-hover:opacity-0" : "lg:group-hover:scale-105",
              )}
            />
            {secondaryImage && (
              <Image
                src={`${env.apiUrl}${secondaryImage.url}`}
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
        {flash && (
          <span className="absolute left-3 top-3 rounded-full bg-brass-400 px-2 py-1 text-xs uppercase tracking-wide text-ink-900">
            Flash Sale
          </span>
        )}
        {totalStock === 0 && (
          <span className="absolute bottom-3 left-3 rounded-full bg-ink-900 px-2 py-1 text-xs uppercase tracking-wide text-cream-50">
            Sold out
          </span>
        )}
        <div className="absolute left-3 top-3 flex flex-col gap-1.5 transition-opacity duration-200 ease-smooth lg:opacity-0 lg:group-hover:opacity-100">
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
        <WishlistButton productId={product.id} className="absolute right-3 top-3 h-8 w-8" />
        {totalStock > 0 && (
          <button
            onClick={handleQuickAdd}
            aria-label="Quick add to cart"
            className="glass glossy absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full text-ink-900 shadow-float transition-all duration-300 ease-smooth hover:scale-110 hover:bg-brass-400 active:scale-95 lg:translate-y-2 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100"
          >
            <ShoppingBag size={16} />
          </button>
        )}
        {justAdded && (
          <span className="absolute bottom-3 right-3 rounded-full bg-ink-900 px-3 py-2 text-xs text-cream-50">Added ✓</span>
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-ink-400">{product.brandTier}</p>
        <h3 className="text-sm text-ink-900">{product.name}</h3>
        <div className="flex items-center gap-2">
          {flash ? (
            <>
              <span className="text-sm text-danger-600">{formatPrice(flash.flashPrice)}</span>
              <span className="text-xs text-ink-400 line-through">{formatPrice(product.basePrice)}</span>
            </>
          ) : (
            <>
              <span className="text-sm text-ink-900">{formatPrice(product.basePrice)}</span>
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
                className="h-3.5 w-3.5 rounded-full border border-ink-200 transition-transform duration-150 ease-smooth hover:scale-125"
                style={{ backgroundColor: hex ?? "#d4d4d4" }}
              />
            ))}
            {colors.length > 5 && <span className="text-[11px] text-ink-400">+{colors.length - 5}</span>}
          </div>
        )}
      </div>
    </Link>
  );
}
