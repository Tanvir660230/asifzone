"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { maxSellableQuantity, type Product, type ProductVariant, type SizeGuideData, type VariantDimension } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { trackFunnelEvent } from "@/lib/analytics";
import { useAddToCart } from "@/hooks/use-add-to-cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { WishlistButton } from "./wishlist-button";
import { StockAlertButton } from "./stock-alert-button";
import { SizeGuideModal } from "./size-guide-modal";
import { STOCK_TONE_CLASS, VariantOptionPickers, missingSelectionText, stockLine, useVariantOptions } from "./variant-option-pickers";
import { VariantPickerDialog, type PickerIntent } from "./variant-picker-dialog";

interface VariantSelectorProps {
  variants: ProductVariant[];
  productId: string;
  productSlug: string;
  productName: string;
  imageUrl: string | null;
  /** Server-resolved prices + whether stock is tracked (D5: untracked = always available). */
  product: Pick<Product, "pricing" | "basePrice" | "compareAtPrice" | "trackInventory">;
  lowStockThreshold: number;
  restockDate: string | null;
  /** The type's variant dimensions (labels and which of size/colour it uses), from the product's
   * resolved view. Empty = no opinion: pickers show only when the data really offers a choice. */
  variantDimensions?: VariantDimension[];
  /** The product's saved size guide, if any. Undefined means "use the default chart". */
  sizeGuide?: SizeGuideData;
  /** Whether to offer the size guide at all — decided by the parent from the type config and the
   * product's own `enabled` flag. */
  showSizeGuide?: boolean;
  /** Called whenever the fully-selected (size + color) variant changes — this is the "cart-ready"
   * variant, used by the parent for the sticky bar. Left undefined until every choice is made. */
  onVariantChange?: (variant: ProductVariant | undefined) => void;
  /** Called whenever the image to preview should change — fires as soon as a color is picked, even
   * before a size is chosen, so a parent can sync the product gallery to that color's photo. */
  onFocusImageChange?: (imageId: string | null) => void;
  /** Called whenever the chosen size and/or colour changes (null = not chosen yet) — the parent uses it to pick the gallery. */
  onSelectionChange?: (selection: { size: string | null; color: string | null }) => void;
  /** Opens the "choose your options" popup from outside (the mobile sticky bar's Add to Cart / Buy Now). A new `nonce`
   * opens it again. */
  pickerRequest?: { intent: PickerIntent; nonce: number } | null;
}

export function VariantSelector({
  variants,
  productId,
  productSlug,
  productName,
  imageUrl,
  product,
  lowStockThreshold,
  restockDate,
  variantDimensions = [],
  sizeGuide,
  showSizeGuide = false,
  onVariantChange,
  onFocusImageChange,
  onSelectionChange,
  pickerRequest,
}: VariantSelectorProps) {
  const options = useVariantOptions(variants, variantDimensions);
  const [selectedSize, setSelectedSize] = useState<string | null>(options.defaultSize);
  const [selectedColor, setSelectedColor] = useState<string | null>(options.defaultColor);
  const [quantity, setQuantity] = useState(1);
  // Add to Cart / Buy Now pressed before the choice is complete → the options popup, for that action.
  const [pickerIntent, setPickerIntent] = useState<PickerIntent | null>(null);

  const selectedVariant = options.resolve(selectedSize, selectedColor);
  const { addToCart, buyNow, justAdded } = useAddToCart({
    selectedVariant,
    productId,
    productSlug,
    productName,
    imageUrl,
    product,
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
  const focusImageId = selectedColor ? (variants.find((v) => v.color === selectedColor && v.imageId)?.imageId ?? null) : null;
  useEffect(() => {
    onSelectionChange?.({ size: selectedSize, color: selectedColor });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSize, selectedColor]);

  useEffect(() => {
    onFocusImageChange?.(focusImageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusImageId]);

  useEffect(() => {
    if (pickerRequest) setPickerIntent(pickerRequest.intent);
  }, [pickerRequest]);

  const maxQty = selectedVariant ? maxSellableQuantity(product.trackInventory, selectedVariant.stock) : 0;
  const stock = selectedVariant ? stockLine(product.trackInventory, selectedVariant.stock, lowStockThreshold) : null;

  // The quantity shown is capped to what this variant can sell; the action uses exactly that number (a larger quantity
  // picked on another variant must not carry over — express checkout doesn't cap it later).
  const effectiveQty = Math.max(1, Math.min(quantity, maxQty));

  function handleAddToCart() {
    if (!selectedVariant) return setPickerIntent("cart");
    addToCart(effectiveQty);
  }

  function handleBuyNow() {
    if (!selectedVariant) return setPickerIntent("buy");
    buyNow(effectiveQty);
  }

  // The popup's choice becomes the page's choice too (gallery, price, sticky bar follow it), then the action runs.
  function handlePickerConfirm(variant: ProductVariant, qty: number) {
    const intent = pickerIntent;
    setSelectedSize(variant.size);
    if (options.colors.length > 0) setSelectedColor(variant.color);
    setQuantity(qty);
    setPickerIntent(null);
    if (intent === "buy") buyNow(qty, variant);
    else addToCart(qty, variant);
  }

  return (
    <div className="space-y-5">
      <VariantOptionPickers
        variants={variants}
        trackInventory={product.trackInventory}
        options={options}
        selectedSize={selectedSize}
        selectedColor={selectedColor}
        onSelectSize={setSelectedSize}
        onSelectColor={setSelectedColor}
        instanceId="inline"
        sizeHeadingExtra={showSizeGuide ? <SizeGuideModal sizeGuide={sizeGuide} /> : undefined}
      />

      <div>
        <AnimatePresence mode="wait">
          {selectedVariant && stock ? (
            <motion.div
              key={selectedVariant.id}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {/* Stock is shown as a state, never a quantity. */}
              <p className={cn("text-sm", STOCK_TONE_CLASS[stock.tone])} data-testid="variant-stock-status">
                {stock.text} · SKU {selectedVariant.sku}
              </p>
              {maxQty === 0 && restockDate && <p className="mt-1 text-sm text-ink-500">Expected back in stock: {formatDate(restockDate)}</p>}
              {maxQty === 0 && <StockAlertButton variantId={selectedVariant.id} />}
            </motion.div>
          ) : (
            <motion.p
              key="missing-hint"
              aria-live="polite"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="text-sm text-ink-500"
            >
              {missingSelectionText(options, selectedSize, selectedColor)}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {selectedVariant && maxQty > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex items-center gap-3 overflow-hidden"
          >
            <p className="shrink-0 text-xs ui-caps text-ink-500">Qty</p>
            <div className="flex items-center rounded-full border border-ink-200 shadow-sm">
              <button
                onClick={() => setQuantity(Math.max(1, effectiveQty - 1))}
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink-700 transition-all duration-150 ease-smooth hover:bg-ink-50 active:scale-90"
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="w-10 text-center text-sm">{effectiveQty}</span>
              <button
                onClick={() => setQuantity(Math.min(maxQty, effectiveQty + 1))}
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
          <Button variant="outline" size="lg" className="flex-1" disabled={!!selectedVariant && maxQty === 0} onClick={handleAddToCart}>
            Add to Cart
          </Button>
          <Button variant="primary" size="lg" className="flex-1" disabled={!!selectedVariant && maxQty === 0} onClick={handleBuyNow}>
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

      <VariantPickerDialog
        open={pickerIntent !== null}
        intent={pickerIntent ?? "cart"}
        onClose={() => setPickerIntent(null)}
        onConfirm={handlePickerConfirm}
        variants={variants}
        product={product}
        lowStockThreshold={lowStockThreshold}
        productName={productName}
        imageUrl={imageUrl}
        variantDimensions={variantDimensions}
        initialSize={selectedSize}
        initialColor={selectedColor}
        initialQuantity={quantity}
      />
    </div>
  );
}
