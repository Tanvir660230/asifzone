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
    // When color is the only choice (no size picker), start on the first color in stock, so Buy Now works in one tap; the
    // shopper can still switch. With a size to pick as well, nothing is chosen for them.
    const firstColorInStock = variants.find((v) => v.color && v.stock > 0)?.color ?? colors[0] ?? null;
    return {
      sizes,
      colors,
      showSizes,
      showColors,
      sizeLabel: sizeDim?.label ?? "Size",
      colorLabel: colorDim?.label ?? "Color",
      /** A single value needs no choice — it's pre-selected. */
      defaultSize: sizes.length === 1 ? (sizes[0] ?? null) : null,
      defaultColor: colors.length === 1 ? (colors[0] ?? null) : !showSizes ? firstColorInStock : null,
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

/** An option that can't be bought right now: a quiet fill, faded text and one fine diagonal across the tile (SoldOutMark),
 * so it reads as "sold out" at a glance while the value stays legible (information, not an error, so no red). */
const UNAVAILABLE_PILL = "border-line bg-surface-muted text-ink-400";

/** The fine corner-to-corner line across a sold-out tile; it stretches with the tile and keeps a hairline weight. */
function SoldOutMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={cn("pointer-events-none absolute inset-0 h-full w-full", className)} preserveAspectRatio="none" viewBox="0 0 100 100">
      <line x1="0" y1="100" x2="100" y2="0" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
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
  /** The size this shopper usually takes (lib/size-memory), marked on its pill. Never selected for them. */
  suggestedSize?: string | null;
  /** Sold-out choices can still be picked (they stay crossed out), so the shopper can ask to be told when one is back.
   * On for the product page; off in the buying popup, where only what can be bought is offered. */
  soldOutSelectable?: boolean;
}

/** Size pills and colour swatches. Out-of-stock choices stay visible but crossed out: disabled, or (soldOutSelectable)
 * pickable for a back-in-stock alert. */
export function VariantOptionPickers({ variants, trackInventory, options, selectedSize, selectedColor, onSelectSize, onSelectColor, instanceId, sizeHeadingExtra, suggestedSize, soldOutSelectable = false }: VariantOptionPickersProps) {
  const sellable = (v: ProductVariant) => isAvailable(trackInventory, v.stock);
  const sizeHasStock = (size: string) => variants.some((v) => v.size === size && sellable(v));
  const comboHasStock = (size: string, color: string) => variants.some((v) => v.size === size && v.color === color && sellable(v));
  const sizeLabelOf = (size: string) => variants.find((v) => v.size === size)?.sizeLabel;
  const hasSizeLabels = options.sizes.some((s) => Boolean(sizeLabelOf(s)));

  return (
    <>
      {options.showSizes && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs ui-caps text-ink-500">{options.sizeLabel}</p>
            {sizeHeadingExtra}
          </div>
          <div
            // Sizes with a measurement ("M · 55cm") sit in an even grid of two-line tiles; bare sizes stay compact pills.
            className={hasSizeLabels ? "grid grid-cols-3 gap-2 sm:grid-cols-4" : "flex flex-wrap gap-2"}
            role="group"
            aria-label={options.sizeLabel}
          >
            {options.sizes.map((size) => {
              const label = sizeLabelOf(size);
              const inStock = sizeHasStock(size);
              const isSelected = selectedSize === size;
              const isSuggested = suggestedSize === size && inStock;
              return (
                <motion.button
                  key={size}
                  type="button"
                  onClick={() => onSelectSize(size)}
                  disabled={!inStock && !soldOutSelectable}
                  aria-label={inStock ? (isSuggested ? `${size}, your usual size` : size) : `${size} — out of stock`}
                  aria-pressed={isSelected}
                  title={inStock ? undefined : "Out of stock"}
                  whileTap={inStock || soldOutSelectable ? { scale: 0.9 } : undefined}
                  className={cn(
                    "relative isolate flex items-center justify-center overflow-hidden border text-sm transition-colors duration-200 ease-smooth disabled:cursor-not-allowed",
                    hasSizeLabels ? "h-14 flex-col gap-0.5 rounded-xl px-2" : "h-10 min-w-12 rounded-[var(--chip-radius)] px-3",
                    isSelected
                      ? cn("border-transparent text-cream-50", !inStock && "text-cream-50/70")
                      : inStock
                        ? "border-ink-200 text-ink-900 hover:border-ink-900"
                        : UNAVAILABLE_PILL,
                  )}
                >
                  {isSelected && (
                    <motion.span
                      layoutId={`size-pill-${instanceId}`}
                      className={cn("glossy absolute inset-0 -z-10 bg-ink-900 shadow-sm", hasSizeLabels ? "rounded-xl" : "rounded-[var(--chip-radius)]")}
                      transition={{ type: "spring", stiffness: 500, damping: 32 }}
                    />
                  )}
                  {!inStock && <SoldOutMark className={isSelected ? "text-cream-50/40" : "text-ink-300"} />}
                  <span className="font-medium leading-tight">{size}</span>
                  {label && <span className={cn("text-[11px] leading-tight tabular-nums", isSelected ? "text-cream-50/70" : inStock ? "text-ink-500" : "text-ink-400")}>{label}</span>}
                  {isSuggested && !isSelected && (
                    // A small accent dot on the pill: "the one you usually take".
                    <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-canvas" />
                  )}
                </motion.button>
              );
            })}
          </div>
          {options.sizes.some((s) => !sizeHasStock(s)) && (
            <p className="mt-2 text-xs text-ink-500" data-testid="sold-out-legend">
              Faded sizes are sold out{soldOutSelectable ? " — tap one to be told when it's back." : "."}
            </p>
          )}
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
              const soldOut = selectedSize ? !comboHasStock(selectedSize, color) : false;
              const disabled = soldOut && !soldOutSelectable;
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
                    title={soldOut ? `${color} — out of stock in this size` : color}
                    aria-label={soldOut ? `${color} — out of stock in this size` : color}
                    aria-pressed={isSelected}
                    whileTap={!disabled ? { scale: 0.9 } : undefined}
                    className={cn(
                      "relative flex h-9 items-center justify-center overflow-hidden rounded-[var(--chip-radius)] border px-3 text-sm transition-colors duration-200 ease-smooth disabled:cursor-not-allowed",
                      isSelected
                        ? "border-brass-400 bg-brass-50 text-ink-900 ring-2 ring-brass-200"
                        : soldOut
                          ? UNAVAILABLE_PILL
                          : "border-ink-200 text-ink-700 hover:border-ink-900",
                    )}
                  >
                    {soldOut && !isSelected && <SoldOutMark className="text-ink-300" />}
                    {color}
                  </motion.button>
                );
              }
              return (
                <motion.button
                  key={color}
                  type="button"
                  onClick={() => onSelectColor(color)}
                  disabled={disabled}
                  title={soldOut ? `${color} — out of stock in this size` : color}
                  aria-label={soldOut ? `${color} — out of stock in this size` : color}
                  aria-pressed={isSelected}
                  whileTap={!disabled ? { scale: 0.85 } : undefined}
                  animate={isSelected ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-[var(--swatch-radius)] border-2 shadow-sm transition-all duration-200 ease-smooth disabled:cursor-not-allowed",
                    isSelected ? "border-brass-400 ring-2 ring-brass-200" : soldOut ? "border-ink-200" : isPaleColor(colorHex) ? "border-ink-300" : "border-ink-200",
                  )}
                  style={{ backgroundColor: colorHex ?? "#d4d4d4" }}
                >
                  {soldOut && (
                    <>
                      {/* Wash the swatch down (not the whole button) so the red out-of-stock mark stays fully legible. */}
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-cream-50/70" />
                      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 -rotate-45 rounded-full bg-cream-50/95" />
                      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 -rotate-45 rounded-full bg-danger-500" />
                    </>
                  )}
                  <AnimatePresence>
                    {isSelected && !soldOut && (
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
