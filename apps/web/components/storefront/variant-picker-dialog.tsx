"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X } from "lucide-react";
import { maxSellableQuantity, type Product, type ProductVariant, type VariantDimension } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { variantDisplayPrice } from "@/lib/pricing-display";
import { cn } from "@/lib/utils";
import { STOCK_TONE_CLASS, VariantOptionPickers, missingSelectionText, stockLine, useVariantOptions } from "./variant-option-pickers";

export type PickerIntent = "cart" | "buy";

interface VariantPickerDialogProps {
  open: boolean;
  /** What the shopper pressed — the confirm button does the same thing. */
  intent: PickerIntent;
  onClose: () => void;
  /** Called with the chosen, buyable variant and quantity; the caller performs the action. */
  onConfirm: (variant: ProductVariant, quantity: number) => void;
  variants: ProductVariant[];
  product: Pick<Product, "pricing" | "basePrice" | "compareAtPrice" | "trackInventory">;
  lowStockThreshold: number;
  productName: string;
  imageUrl: string | null;
  variantDimensions?: VariantDimension[];
  /** Whatever the shopper already picked on the page — the popup starts from it. */
  initialSize?: string | null;
  initialColor?: string | null;
  initialQuantity?: number;
}

/**
 * "Choose your options" — opened when Add to Cart / Buy Now is pressed before a size/colour is chosen (PDP buttons,
 * mobile sticky bar, quick view, and a product card's quick add). A bottom sheet on phones, a centred card on larger
 * screens. Uses the same pickers and stock rule as the page, shows no stock quantities, and runs the original action
 * once a buyable variant is chosen.
 */
export function VariantPickerDialog({
  open,
  intent,
  onClose,
  onConfirm,
  variants,
  product,
  lowStockThreshold,
  productName,
  imageUrl,
  variantDimensions,
  initialSize = null,
  initialColor = null,
  initialQuantity = 1,
}: VariantPickerDialogProps) {
  const titleId = useId();
  const options = useVariantOptions(variants, variantDimensions);
  const [size, setSize] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Start from what's already chosen each time it opens.
  useEffect(() => {
    if (!open) return;
    setSize(initialSize ?? options.defaultSize);
    setColor(initialColor ?? options.defaultColor);
    setQuantity(Math.max(1, initialQuantity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Scroll lock that respects an overlay already open underneath (quick view): restore exactly what was there.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // A stable close for the focus trap: callers pass inline arrows, and a new function identity would re-run the trap's
  // effect on every parent render — which re-focuses the first control and yanks keyboard focus away.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => onCloseRef.current(), []);
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: close, lockScroll: false });

  if (!open || !mounted) return null;

  const variant = options.resolve(size, color);
  const maxQty = variant ? maxSellableQuantity(product.trackInventory, variant.stock) : 0;
  const canConfirm = Boolean(variant) && maxQty > 0;
  const price = variantDisplayPrice(product, variant?.id);
  const stock = variant ? stockLine(product.trackInventory, variant.stock, lowStockThreshold) : null;
  const actionLabel = intent === "buy" ? "Buy Now" : "Add to Cart";

  function selectSize(next: string) {
    setSize(next);
    // A colour that doesn't exist (or isn't sellable) in the new size is cleared rather than left pointing nowhere.
    if (color && !variants.some((v) => v.size === next && v.color === color)) setColor(options.defaultColor);
  }

  function confirm() {
    if (!variant || maxQty === 0) return;
    onConfirm(variant, Math.min(quantity, maxQty));
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-950/40 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="variant-picker"
        // Escape here must close only this popup, not an overlay underneath it (quick view listens on the document too).
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-cream-50 shadow-floatLg animate-modal-in sm:max-w-md sm:rounded-2xl"
      >
        <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
          {imageUrl && (
            <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-100">
              <Image src={resolveImageUrl(imageUrl)} alt="" fill sizes="56px" className="object-cover" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-base text-ink-900">
              Choose your options
            </h2>
            <p className="truncate text-sm text-ink-600">{productName}</p>
            <p className="mt-0.5 text-sm font-semibold text-ink-900" data-testid="variant-picker-price">
              {formatPrice(price.price)}
              {price.was !== null && <span className="ml-2 text-xs font-normal text-ink-400 line-through">{formatPrice(price.was)}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-ink-400 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-900"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <VariantOptionPickers
            variants={variants}
            trackInventory={product.trackInventory}
            options={options}
            selectedSize={size}
            selectedColor={color}
            onSelectSize={selectSize}
            onSelectColor={setColor}
            instanceId="picker"
          />

          <p aria-live="polite" className={cn("text-sm", stock ? STOCK_TONE_CLASS[stock.tone] : "text-ink-500")} data-testid="variant-picker-status">
            {stock ? stock.text : missingSelectionText(options, size, color)}
          </p>

          {canConfirm && (
            <div className="flex items-center gap-3">
              <p className="shrink-0 text-xs uppercase tracking-wide text-ink-500">Qty</p>
              <div className="flex items-center rounded-full border border-ink-200 shadow-sm">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-ink-700 hover:bg-ink-50 active:scale-90"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="w-10 text-center text-sm">{Math.min(quantity, maxQty)}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-ink-700 hover:bg-ink-50 active:scale-90"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-ink-100 px-5 py-4">
          <Button type="button" variant={intent === "buy" ? "primary" : "outline"} size="lg" className="w-full" disabled={!canConfirm} onClick={confirm}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
