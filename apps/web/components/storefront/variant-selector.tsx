"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import type { ProductVariant } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { cn, isPaleColor } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { trackFunnelEvent } from "@/lib/analytics";
import { useAddToCart } from "@/hooks/use-add-to-cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
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
  /** Called whenever the fully-selected (size + color) variant changes — this is the "cart-ready"
   * variant, used by the parent for the sticky bar. Left undefined until every choice is made. */
  onVariantChange?: (variant: ProductVariant | undefined) => void;
  /** Called whenever the image to preview should change — fires as soon as a color is picked, even
   * before a size is chosen, so a parent can sync the product gallery to that color's photo. */
  onFocusImageChange?: (imageId: string | null) => void;
  /** True for a brief moment after the shopper tries to Add to Cart/Buy Now without finishing their
   * selection — draws attention to whichever picker (size and/or color) still needs a choice. */
  highlightMissing?: boolean;
  /** Called when Add to Cart/Buy Now is clicked with no variant selected yet, so the parent can
   * scroll this selector into view (used by the mobile sticky bar, which lives lower on the page). */
  onRequireSelection?: () => void;
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
  onVariantChange,
  onFocusImageChange,
  highlightMissing,
  onRequireSelection,
}: VariantSelectorProps) {
  const sizes = useMemo(() => Array.from(new Set(variants.map((v) => v.size))), [variants]);
  const colors = useMemo(() => Array.from(new Set(variants.map((v) => v.color))), [variants]);

  const [selectedSize, setSelectedSize] = useState<string | null>(sizes.length === 1 ? (sizes[0] ?? null) : null);
  const [selectedColor, setSelectedColor] = useState<string | null>(colors.length === 1 ? (colors[0] ?? null) : null);
  const [quantity, setQuantity] = useState(1);

  const selectedVariant = variants.find((v) => v.size === selectedSize && v.color === selectedColor);
  const { addToCart, buyNow, justAdded } = useAddToCart({
    selectedVariant,
    productId,
    productSlug,
    productName,
    imageUrl,
    basePrice,
  });
  const openCartDrawer = useCartDrawerStore((s) => s.open);

  useEffect(() => {
    onVariantChange?.(selectedVariant);
    // Fires once per distinct variant id (not per render) — the effect's own dependency array
    // already provides the dedup a funnel event needs, so a shopper toggling back and forth
    // between two variants just records each distinct pick, not a flood of duplicates.
    if (selectedVariant) trackFunnelEvent("VARIANT_SELECTED", { productId, variantId: selectedVariant.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant?.id]);

  // Previews the picked color's photo as soon as a color is chosen, without waiting for a size too —
  // any variant of that color carries the same photo, so the first one with an assigned image will do.
  const focusImageId = selectedColor
    ? (variants.find((v) => v.color === selectedColor && v.imageId)?.imageId ?? null)
    : null;
  useEffect(() => {
    onFocusImageChange?.(focusImageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusImageId]);

  const sizeHasStock = (size: string) => variants.some((v) => v.size === size && v.stock > 0);
  const comboHasStock = (size: string, color: string) =>
    variants.some((v) => v.size === size && v.color === color && v.stock > 0);

  const sizeMissing = sizes.length > 0 && !selectedSize;
  const colorMissing = colors.length > 0 && !selectedColor;

  function handleAddToCart() {
    if (!selectedVariant) {
      onRequireSelection?.();
      return;
    }
    addToCart(quantity);
  }

  function handleBuyNow() {
    if (!selectedVariant) {
      onRequireSelection?.();
      return;
    }
    buyNow(quantity);
  }

  return (
    <div className="space-y-5">
      {sizes.length > 0 && (
        <div
          className={cn(
            "rounded-xl transition-shadow duration-200",
            highlightMissing && sizeMissing && "animate-shake ring-2 ring-danger-500 ring-offset-2",
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className={cn("text-xs uppercase tracking-wide", highlightMissing && sizeMissing ? "font-medium text-danger-600" : "text-ink-500")}>
              Size
            </p>
            <SizeGuideModal />
          </div>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => {
              const sizeLabel = variants.find((v) => v.size === size)?.sizeLabel;
              const inStock = sizeHasStock(size);
              const isSelected = selectedSize === size;
              return (
                <motion.button
                  key={size}
                  onClick={() => setSelectedSize(size)}
                  disabled={!inStock}
                  aria-label={inStock ? size : `${size} — out of stock`}
                  title={inStock ? undefined : "Out of stock"}
                  whileTap={inStock ? { scale: 0.9 } : undefined}
                  className={cn(
                    "relative isolate flex h-10 min-w-10 items-center justify-center rounded-full border px-3 text-sm transition-colors duration-200 ease-smooth disabled:cursor-not-allowed",
                    isSelected
                      ? "border-transparent text-cream-50"
                      : inStock
                        ? "border-ink-200 text-ink-700 hover:border-ink-900"
                        : "border-danger-100 bg-danger-50 text-ink-400",
                  )}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="size-pill"
                      className="glossy absolute inset-0 -z-10 rounded-full bg-ink-900 shadow-sm"
                      transition={{ type: "spring", stiffness: 500, damping: 32 }}
                    />
                  )}
                  {sizeLabel ? `${size} (${sizeLabel})` : size}
                  {!inStock && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 -rotate-[14deg] rounded-full bg-danger-500/80"
                    />
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {colors.length > 0 && (
        <div
          className={cn(
            "rounded-xl transition-shadow duration-200",
            highlightMissing && colorMissing && "animate-shake ring-2 ring-danger-500 ring-offset-2",
          )}
        >
          <p className={cn("mb-2 text-xs uppercase tracking-wide", highlightMissing && colorMissing ? "font-medium text-danger-600" : "text-ink-500")}>
            Color{selectedColor ? ` — ${selectedColor}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {colors.map((color) => {
              const disabled = selectedSize ? !comboHasStock(selectedSize, color) : false;
              const colorHex = variants.find((v) => v.color === color)?.colorHex;
              const isSelected = selectedColor === color;
              return (
                <motion.button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  disabled={disabled}
                  title={disabled ? `${color} — out of stock in this size` : color}
                  aria-label={disabled ? `${color} — out of stock in this size` : color}
                  aria-pressed={isSelected}
                  whileTap={!disabled ? { scale: 0.85 } : undefined}
                  animate={isSelected ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 shadow-sm transition-all duration-200 ease-smooth disabled:cursor-not-allowed",
                    isSelected
                      ? "border-brass-400 ring-2 ring-brass-200"
                      : disabled
                        ? "border-ink-200"
                        : isPaleColor(colorHex)
                          ? "border-ink-300"
                          : "border-ink-200",
                  )}
                  style={{ backgroundColor: colorHex ?? "#d4d4d4" }}
                >
                  {disabled && (
                    <>
                      {/* Wash the swatch color down instead of dimming the whole button, so the red
                          out-of-stock mark on top stays at full, clearly-legible opacity. */}
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-cream-50/70" />
                      {/* A light halo behind the red line keeps it legible over dark swatch colors too. */}
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 -rotate-45 rounded-full bg-cream-50/95"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 -rotate-45 rounded-full bg-danger-500"
                      />
                    </>
                  )}
                  <AnimatePresence>
                    {isSelected && !disabled && (
                      <motion.span
                        key="check"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 22 }}
                        className="flex h-4 w-4 items-center justify-center rounded-full bg-cream-50 text-ink-900 shadow-sm"
                      >
                        <Check size={11} strokeWidth={3} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <AnimatePresence mode="wait">
          {selectedVariant ? (
            <motion.div
              key={selectedVariant.id}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
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
            </motion.div>
          ) : (
            <motion.p
              key="missing-hint"
              aria-live="polite"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className={cn(
                "text-sm transition-colors duration-200",
                highlightMissing ? "font-medium text-danger-600" : "text-ink-500",
              )}
            >
              {sizeMissing && colorMissing
                ? "Please select a size and color to continue"
                : sizeMissing
                  ? "Please select a size to continue"
                  : colorMissing
                    ? "Please select a color to continue"
                    : "Select a size and color"}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {selectedVariant && selectedVariant.stock > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex items-center gap-3 overflow-hidden"
          >
            <p className="shrink-0 text-xs uppercase tracking-wide text-ink-500">Qty</p>
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
          </motion.div>
        )}
      </AnimatePresence>

      <div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="lg"
            className="flex-1"
            disabled={!!selectedVariant && selectedVariant.stock === 0}
            onClick={handleAddToCart}
          >
            Add to Cart
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={!!selectedVariant && selectedVariant.stock === 0}
            onClick={handleBuyNow}
          >
            Buy Now
          </Button>
          <WishlistButton productId={productId} className="h-12 w-12 shrink-0 border border-ink-200 bg-cream-50" />
        </div>
        {justAdded && (
          <p className="mt-2 text-center text-xs text-ink-600">
            Added to cart —{" "}
            <button type="button" onClick={openCartDrawer} className="underline hover:text-brass-500">
              view cart
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
