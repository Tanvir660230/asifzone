"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProductVariant } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { useCartStore } from "@/store/cart";
import { useExpressCheckoutStore } from "@/store/express-checkout";
import { WishlistButton } from "./wishlist-button";
import { StockAlertButton } from "./stock-alert-button";
import { SizeGuideModal } from "./size-guide-modal";

const CRITICAL_STOCK_THRESHOLD = 3;

interface VariantSelectorProps {
  variants: ProductVariant[];
  productId: string;
  productSlug: string;
  productName: string;
  imageUrl: string | null;
  basePrice: string;
  lowStockThreshold: number;
  restockDate: string | null;
}

export function VariantSelector({
  variants,
  productId,
  productSlug,
  productName,
  imageUrl,
  basePrice,
  lowStockThreshold,
  restockDate,
}: VariantSelectorProps) {
  const router = useRouter();
  const sizes = useMemo(() => Array.from(new Set(variants.map((v) => v.size))), [variants]);
  const colors = useMemo(() => Array.from(new Set(variants.map((v) => v.color))), [variants]);
  const addItem = useCartStore((s) => s.addItem);
  const setExpressItem = useExpressCheckoutStore((s) => s.setItem);

  const [selectedSize, setSelectedSize] = useState<string | null>(sizes[0] ?? null);
  const [selectedColor, setSelectedColor] = useState<string | null>(colors[0] ?? null);
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  const selectedVariant = variants.find((v) => v.size === selectedSize && v.color === selectedColor);
  const sizeHasStock = (size: string) => variants.some((v) => v.size === size && v.stock > 0);
  const comboHasStock = (size: string, color: string) =>
    variants.some((v) => v.size === size && v.color === color && v.stock > 0);

  function buildCartItem() {
    if (!selectedVariant) return null;
    return {
      variantId: selectedVariant.id,
      productId,
      productSlug,
      productName,
      sku: selectedVariant.sku,
      size: selectedVariant.size,
      color: selectedVariant.color,
      price: Number(selectedVariant.price ?? basePrice),
      imageUrl,
      maxStock: selectedVariant.stock,
    };
  }

  function handleAddToCart() {
    const item = buildCartItem();
    if (!item) return;
    addItem(item, quantity);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2500);
  }

  function handleBuyNow() {
    const item = buildCartItem();
    if (!item) return;
    setExpressItem({ ...item, quantity });
    router.push("/checkout");
  }

  return (
    <div className="space-y-5">
      {sizes.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-ink-500">Size</p>
            <SizeGuideModal />
          </div>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => (
              <button
                key={size}
                onClick={() => setSelectedSize(size)}
                disabled={!sizeHasStock(size)}
                className={cn(
                  "h-10 min-w-10 rounded-full border px-3 text-sm transition-all duration-200 ease-smooth active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
                  selectedSize === size
                    ? "glossy border-ink-900 bg-ink-900 text-cream-50 shadow-sm"
                    : "border-ink-200 hover:border-ink-900",
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
                    "glossy h-9 w-9 rounded-full border-2 shadow-sm transition-all duration-200 ease-smooth active:scale-90 disabled:cursor-not-allowed disabled:opacity-30",
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
          <>
            <p
              className={cn(
                "text-sm",
                selectedVariant.stock === 0
                  ? "text-ink-500"
                  : selectedVariant.stock <= CRITICAL_STOCK_THRESHOLD
                    ? "font-medium text-danger-600"
                    : selectedVariant.stock <= lowStockThreshold
                      ? "font-medium text-brass-600"
                      : "text-ink-500",
              )}
            >
              {selectedVariant.stock === 0
                ? "Out of stock"
                : selectedVariant.stock <= CRITICAL_STOCK_THRESHOLD
                  ? `Only ${selectedVariant.stock} left!`
                  : selectedVariant.stock <= lowStockThreshold
                    ? `Limited Stock — ${selectedVariant.stock} left`
                    : `${selectedVariant.stock} in stock`}{" "}
              · SKU {selectedVariant.sku}
            </p>
            {selectedVariant.stock === 0 && restockDate && (
              <p className="mt-1 text-sm text-ink-500">Expected back in stock: {formatDate(restockDate)}</p>
            )}
            {selectedVariant.stock === 0 && <StockAlertButton variantId={selectedVariant.id} />}
          </>
        ) : (
          <p className="text-sm text-ink-500">Select a size and color</p>
        )}
      </div>

      {selectedVariant && selectedVariant.stock > 0 && (
        <div className="flex items-center gap-3">
          <p className="text-xs uppercase tracking-wide text-ink-500">Qty</p>
          <div className="flex items-center rounded-full border border-ink-200 shadow-sm">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink-700 transition-all duration-150 ease-smooth hover:bg-ink-50 active:scale-90"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="w-10 text-center text-sm">{quantity}</span>
            <button
              onClick={() => setQuantity((q) => Math.min(selectedVariant.stock, q + 1))}
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink-700 transition-all duration-150 ease-smooth hover:bg-ink-50 active:scale-90"
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
            variant="outline"
            size="lg"
            className="flex-1"
            disabled={!selectedVariant || selectedVariant.stock === 0}
            onClick={handleAddToCart}
          >
            Add to Cart
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={!selectedVariant || selectedVariant.stock === 0}
            onClick={handleBuyNow}
          >
            Buy Now
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
