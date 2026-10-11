"use client";

import { useMemo, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { NO_SIZE_VALUE, isAvailable, variantStockState, type ProductVariant, type VariantDimension } from "@clothing-brand/shared";
import { cn, isPaleColor } from "@/lib/utils";

/** Below this many units a LOW_STOCK variant reads "Only a few left!" instead of "Limited stock" — wording only. */
const CRITICAL_STOCK_THRESHOLD = 3;

/** Which option pickers a product needs and how to resolve a (size, color) choice to a variant — shared by the inline
 * PDP selector and the "choose your options" popup so the two can never disagree. */
export function useVariantOptions(variants: ProductVariant[], variantDimensions: VariantDimension[] = []) {
  return useMemo(() => {
    const sizeDim = variantDimensions.find((d) => d.targetField === "size");
    const colorDim = variantDimensions.find((d) => d.targetField === "color");
    const sizes = Array.from(new Set(variants.map((v) => v.size)));
    const colors = Array.from(new Set(variants.map((v) => v.color))).filter(Boolean);
    // A picker is shown when the type has that dimension or the data really offers a choice. A lone "Standard" size is
    // a placeholder, not a value worth showing.
    const onlyPlaceholderSize = sizes.length === 1 && sizes[0] === NO_SIZE_VALUE;
    const showSizes = sizes.length > 0 && !onlyPlaceholderSize && (Boolean(sizeDim) || sizes.length > 1);
    const showColors = colors.length > 0 && (Boolean(colorDim) || colors.length > 1);
    return {
      sizes,
      colors,
      showSizes,
      showColors,
      sizeLabel: sizeDim?.label ?? "Size",
      colorLabel: colorDim?.label ?? "Color",
      /** A single value needs no choice — it's pre-selected. */
      defaultSize: sizes.length === 1 ? (sizes[0] ?? null) : null,
      defaultColor: colors.length === 1 ? (colors[0] ?? null) : null,
      /** Products without any color have nothing to match on for color. */
      resolve: (size: string | null, color: string | null) => variants.find((v) => v.size === size && (colors.length === 0 || v.color === color)),
    };
  }, [variants, variantDimensions]);
}

export type VariantOptions = ReturnType<typeof useVariantOptions>;

/** The shopper-facing stock line for a chosen variant. Deliberately no quantities: shoppers see whether they can buy it
 * (and a gentle "limited" hint), never how many units the shop holds. States come from the shared stock rule. */
export function stockLine(trackInventory: boolean, stock: number, lowStockThreshold: number): { text: string; tone: "muted" | "warn" | "urgent" } {
  const state = variantStockState(trackInventory, stock, lowStockThreshold);
  if (state === "OUT_OF_STOCK") return { text: "Out of stock", tone: "muted" };
  if (state === "LOW_STOCK") return stock <= CRITICAL_STOCK_THRESHOLD ? { text: "Only a few left!", tone: "urgent" } : { text: "Limited stock", tone: "warn" };
  return { text: "In stock", tone: "muted" }; // IN_STOCK and UNLIMITED (D5)
}

export const STOCK_TONE_CLASS = { muted: "text-ink-500", warn: "font-medium text-brass-600", urgent: "font-medium text-danger-600" } as const;

interface VariantOptionPickersProps {
  variants: ProductVariant[];
  trackInventory: boolean;
  options: VariantOptions;
  selectedSize: string | null;
  selectedColor: string | null;
  onSelectSize: (size: string) => void;
  onSelectColor: (color: string) => void;
  /** Distinguishes the selected-pill animation of two picker instances on one page (inline + popup). */
  instanceId: string;
  /** Rendered next to the size heading (e.g. the size-guide link). */
  sizeHeadingExtra?: ReactNode;
}

/** Size pills and colour swatches. Out-of-stock choices stay visible but are crossed out and disabled. */
export function VariantOptionPickers({ variants, trackInventory, options, selectedSize, selectedColor, onSelectSize, onSelectColor, instanceId, sizeHeadingExtra }: VariantOptionPickersProps) {
  const sellable = (v: ProductVariant) => isAvailable(trackInventory, v.stock);
  const sizeHasStock = (size: string) => variants.some((v) => v.size === size && sellable(v));
  const comboHasStock = (size: string, color: string) => variants.some((v) => v.size === size && v.color === color && sellable(v));

  return (
    <>
      {options.showSizes && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs ui-caps text-ink-500">{options.sizeLabel}</p>
            {sizeHeadingExtra}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={options.sizeLabel}>
            {options.sizes.map((size) => {
              const label = variants.find((v) => v.size === size)?.sizeLabel;
              const inStock = sizeHasStock(size);
              const isSelected = selectedSize === size;
              return (
                <motion.button
                  key={size}
                  type="button"
                  onClick={() => onSelectSize(size)}
                  disabled={!inStock}
                  aria-label={inStock ? size : `${size} — out of stock`}
                  aria-pressed={isSelected}
                  title={inStock ? undefined : "Out of stock"}
                  whileTap={inStock ? { scale: 0.9 } : undefined}
                  className={cn(
                    "relative isolate flex h-10 min-w-10 items-center justify-center rounded-full border px-3 text-sm transition-colors duration-200 ease-smooth disabled:cursor-not-allowed",
                    isSelected ? "border-transparent text-cream-50" : inStock ? "border-ink-200 text-ink-700 hover:border-ink-900" : "border-danger-100 bg-danger-50 text-ink-400",
                  )}
                >
                  {isSelected && (
                    <motion.span
                      layoutId={`size-pill-${instanceId}`}
                      className="glossy absolute inset-0 -z-10 rounded-full bg-ink-900 shadow-sm"
                      transition={{ type: "spring", stiffness: 500, damping: 32 }}
                    />
                  )}
                  {label ? `${size} (${label})` : size}
                  {!inStock && (
                    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 -rotate-[14deg] rounded-full bg-danger-500/80" />
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {options.showColors && (
        <div>
          <p className="mb-2 text-xs ui-caps text-ink-500">
            {options.colorLabel}
            {selectedColor ? ` — ${selectedColor}` : ""}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={options.colorLabel}>
            {options.colors.map((color) => {
              const disabled = selectedSize ? !comboHasStock(selectedSize, color) : false;
              const colorHex = variants.find((v) => v.color === color)?.colorHex;
              const isSelected = selectedColor === color;
              // No colour code on file: a blank grey dot would be indistinguishable from the next one, so show the name.
              if (!colorHex) {
                return (
                  <motion.button
                    key={color}
                    type="button"
                    onClick={() => onSelectColor(color)}
                    disabled={disabled}
                    title={disabled ? `${color} — out of stock in this size` : color}
                    aria-label={disabled ? `${color} — out of stock in this size` : color}
                    aria-pressed={isSelected}
                    whileTap={!disabled ? { scale: 0.9 } : undefined}
                    className={cn(
                      "relative flex h-9 items-center justify-center rounded-full border px-3 text-sm transition-colors duration-200 ease-smooth disabled:cursor-not-allowed",
                      isSelected
                        ? "border-brass-400 bg-brass-50 text-ink-900 ring-2 ring-brass-200"
                        : disabled
                          ? "border-danger-100 bg-danger-50 text-ink-400"
                          : "border-ink-200 text-ink-700 hover:border-ink-900",
                    )}
                  >
                    {color}
                    {disabled && (
                      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 -rotate-[10deg] rounded-full bg-danger-500/80" />
                    )}
                  </motion.button>
                );
              }
              return (
                <motion.button
                  key={color}
                  type="button"
                  onClick={() => onSelectColor(color)}
                  disabled={disabled}
                  title={disabled ? `${color} — out of stock in this size` : color}
                  aria-label={disabled ? `${color} — out of stock in this size` : color}
                  aria-pressed={isSelected}
                  whileTap={!disabled ? { scale: 0.85 } : undefined}
                  animate={isSelected ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 shadow-sm transition-all duration-200 ease-smooth disabled:cursor-not-allowed",
                    isSelected ? "border-brass-400 ring-2 ring-brass-200" : disabled ? "border-ink-200" : isPaleColor(colorHex) ? "border-ink-300" : "border-ink-200",
                  )}
                  style={{ backgroundColor: colorHex ?? "#d4d4d4" }}
                >
                  {disabled && (
                    <>
                      {/* Wash the swatch down (not the whole button) so the red out-of-stock mark stays fully legible. */}
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-cream-50/70" />
                      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 -rotate-45 rounded-full bg-cream-50/95" />
                      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 -rotate-45 rounded-full bg-danger-500" />
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
    </>
  );
}

/** "Please select a size to continue" — what's still missing, in words. */
export function missingSelectionText(options: VariantOptions, selectedSize: string | null, selectedColor: string | null): string {
  const sizeMissing = options.showSizes && !selectedSize;
  const colorMissing = options.showColors && !selectedColor;
  if (sizeMissing && colorMissing) return `Please select a ${options.sizeLabel.toLowerCase()} and ${options.colorLabel.toLowerCase()} to continue`;
  if (sizeMissing) return `Please select a ${options.sizeLabel.toLowerCase()} to continue`;
  if (colorMissing) return `Please select a ${options.colorLabel.toLowerCase()} to continue`;
  return "This combination isn't available — please choose another";
}
