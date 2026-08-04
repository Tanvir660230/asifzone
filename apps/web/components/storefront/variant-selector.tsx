"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ProductVariant } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/store/cart";
import { WishlistButton } from "./wishlist-button";

interface VariantSelectorProps {
  variants: ProductVariant[];
  productId: string;
  productSlug: string;
  productName: string;
  imageUrl: string | null;
  basePrice: string;
}

export function VariantSelector({ variants, productId, productSlug, productName, imageUrl, basePrice }: VariantSelectorProps) {
  const sizes = useMemo(() => Array.from(new Set(variants.map((v) => v.size))), [variants]);
  const colors = useMemo(() => Array.from(new Set(variants.map((v) => v.color))), [variants]);
  const addItem = useCartStore((s) => s.addItem);

  const [selectedSize, setSelectedSize] = useState<string | null>(sizes[0] ?? null);
  const [selectedColor, setSelectedColor] = useState<string | null>(colors[0] ?? null);
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  const selectedVariant = variants.find((v) => v.size === selectedSize && v.color === selectedColor);
  const sizeHasStock = (size: string) => variants.some((v) => v.size === size && v.stock > 0);
  const comboHasStock = (size: string, color: string) =>
    variants.some((v) => v.size === size && v.color === color && v.stock > 0);

  function handleAddToCart() {
    if (!selectedVariant) return;
    addItem(
      {
        variantId: selectedVariant.id,
        productSlug,
        productName,
        sku: selectedVariant.sku,
        size: selectedVariant.size,
        color: selectedVariant.color,
        price: Number(selectedVariant.price ?? basePrice),
        imageUrl,
        maxStock: selectedVariant.stock,
      },
      quantity,
    );
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2500);
  }

  return (
    <div className="space-y-5">
      {sizes.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-ink-500">Size</p>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => (
              <button
                key={size}
                onClick={() => setSelectedSize(size)}
                disabled={!sizeHasStock(size)}
                className={cn(
                  "h-10 min-w-10 border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  selectedSize === size ? "border-ink-900 bg-ink-900 text-cream-50" : "border-ink-200 hover:border-ink-900",
                )}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      )}

      {colors.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-ink-500">
            Color{selectedColor ? ` — ${selectedColor}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {colors.map((color) => {
              const disabled = selectedSize ? !comboHasStock(selectedSize, color) : false;
              const colorHex = variants.find((v) => v.color === color)?.colorHex;
              return (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  disabled={disabled}
                  title={color}
                  aria-label={color}
                  aria-pressed={selectedColor === color}
                  className={cn(
                    "h-9 w-9 rounded-full border-2 transition-all disabled:cursor-not-allowed disabled:opacity-30",
                    selectedColor === color ? "border-brass-400 ring-2 ring-brass-200" : "border-ink-200",
                  )}
                  style={{ backgroundColor: colorHex ?? "#d4d4d4" }}
                />
              );
            })}
          </div>
        </div>
      )}

      <div>
        {selectedVariant ? (
          <p className="text-sm text-ink-500">
            {selectedVariant.stock > 0 ? `${selectedVariant.stock} in stock` : "Out of stock"} · SKU {selectedVariant.sku}
          </p>
        ) : (
          <p className="text-sm text-ink-500">Select a size and color</p>
        )}
      </div>

      {selectedVariant && selectedVariant.stock > 0 && (
        <div className="flex items-center gap-3">
          <p className="text-xs uppercase tracking-wide text-ink-500">Qty</p>
          <div className="flex items-center border border-ink-200">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="h-10 w-10 text-ink-700 hover:bg-ink-50"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="w-10 text-center text-sm">{quantity}</span>
            <button
              onClick={() => setQuantity((q) => Math.min(selectedVariant.stock, q + 1))}
              className="h-10 w-10 text-ink-700 hover:bg-ink-50"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={!selectedVariant || selectedVariant.stock === 0}
            onClick={handleAddToCart}
          >
            Add to Cart
          </Button>
          <WishlistButton productId={productId} className="h-12 w-12 shrink-0 border border-ink-200 bg-cream-50" />
        </div>
        {justAdded && (
          <p className="mt-2 text-center text-xs text-ink-600">
            Added to cart —{" "}
            <Link href="/cart" className="underline hover:text-brass-500">
              view cart
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
