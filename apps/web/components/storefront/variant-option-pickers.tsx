"use client";

import { useMemo, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CircleSlash, Flame } from "lucide-react";
import { NO_SIZE_VALUE, isAvailable, variantStockState, type ProductVariant, type VariantDimension } from "@clothing-brand/shared";
import { cn, isPaleColor } from "@/lib/utils";
import { storeLayout } from "@/lib/theme-layout";

/** Below this many units a LOW_STOCK variant reads "Only a few left" instead of "Limited stock" — wording only. */
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
export type StockTone = "ok" | "warn" | "urgent" | "out";

export function stockLine(trackInventory: boolean, stock: number, lowStockThreshold: number): { text: string; tone: StockTone } {
  const state = variantStockState(trackInventory, stock, lowStockThreshold);
  if (state === "OUT_OF_STOCK") return { text: "Sold out", tone: "out" };
  if (state === "LOW_STOCK") return stock <= CRITICAL_STOCK_THRESHOLD ? { text: "Only a few left — order soon", tone: "urgent" } : { text: "Limited stock — order soon", tone: "warn" };
  return { text: "In stock — ready to ship", tone: "ok" }; // IN_STOCK and UNLIMITED (D5)
}

/** A size's state across its variants (any colour): in stock if any variant is, "few left" if only low ones are. */
type SizeState = "in" | "low" | "out";

/** How full the little stock meter is (of 5) — a feeling of scarcity without ever showing a number. */
const METER_FILL: Record<StockTone, number> = { ok: 5, warn: 2, urgent: 1, out: 0 };

/** The chosen option's stock, as a badge: a live green dot when it's in stock; a flame and a nearly empty meter when
 * it's running low; red when it's sold out. Wording and meter only — never a quantity. */
export function StockBadge({ stock, testId }: { stock: { text: string; tone: StockTone }; testId: string }) {
  const { tone, text } = stock;
  return (
    <p
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium",
        tone === "ok" && "bg-success-50 text-success-700",
        tone === "warn" && "bg-warning-50 text-warning-700",
        tone === "urgent" && "bg-sale-50 text-sale-600",
        tone === "out" && "bg-danger-50 text-danger-700",
      )}
      data-testid={testId}
      data-tone={tone}
    >
      {tone === "ok" && (
        <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-500 opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success-500" />
        </span>
      )}
      {(tone === "warn" || tone === "urgent") && <Flame size={14} aria-hidden="true" className="shrink-0" />}
      {tone === "out" && <CircleSlash size={14} aria-hidden="true" className="shrink-0" />}
      <span className="min-w-0">{text}</span>
      {(tone === "warn" || tone === "urgent") && (
        <span aria-hidden="true" className="flex shrink-0 gap-0.5">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={cn("h-2.5 w-1 rounded-full", i < METER_FILL[tone] ? "bg-current" : "bg-current opacity-20")} />
          ))}
        </span>
      )}
    </p>
  );
}

/** An option that can't be bought right now: a red-tinted tile crossed by one red diagonal (SoldOutMark) — the cross says
 * "sold out" by itself, so no label repeats it; choosing the tile shows the "Sold out" badge and the back-in-stock alert. */
const UNAVAILABLE_PILL = "border-danger-200 bg-danger-50/60 text-ink-500";

/** The small "Few left" tag on a size tile's top edge while only a little of that size remains — the one state a tile
 * can't show by itself. (Sold out is the red cross.) */
function SizeTag({ state }: { state: SizeState }) {
  if (state !== "low") return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-px text-[9px] font-semibold uppercase leading-tight tracking-wide text-white shadow-sm",
        "bg-sale-500",
      )}
    >
      Few left
    </span>
  );
}

/** The fine corner-to-corner line across a sold-out tile; it stretches with the tile and keeps a hairline weight. */
function SoldOutMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={cn("pointer-events-none absolute inset-0 h-full w-full", className)} preserveAspectRatio="none" viewBox="0 0 100 100">
      <line x1="0" y1="100" x2="100" y2="0" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export const STOCK_TONE_CLASS: Record<StockTone, string> = { ok: "text-success-700", warn: "font-medium text-warning-700", urgent: "font-medium text-sale-600", out: "font-medium text-danger-700" };

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
  /** The product's low-stock line: sizes with only low-stock variants get a "Few left" tag. */
  lowStockThreshold?: number;
}

/** Size pills and colour swatches. Out-of-stock choices stay visible but crossed out: disabled, or (soldOutSelectable)
 * pickable for a back-in-stock alert. */
export function VariantOptionPickers({ variants, trackInventory, options, selectedSize, selectedColor, onSelectSize, onSelectColor, instanceId, sizeHeadingExtra, suggestedSize, soldOutSelectable = false, lowStockThreshold }: VariantOptionPickersProps) {
  const sellable = (v: ProductVariant) => isAvailable(trackInventory, v.stock);
  const sizeHasStock = (size: string) => variants.some((v) => v.size === size && sellable(v));
  const sizeState = (size: string): SizeState => {
    const states = variants.filter((v) => v.size === size).map((v) => variantStockState(trackInventory, v.stock, lowStockThreshold ?? 0));
    if (states.some((st) => st === "IN_STOCK" || st === "UNLIMITED")) return "in";
    if (lowStockThreshold !== undefined && states.some((st) => st === "LOW_STOCK")) return "low";
    return states.some((st) => st !== "OUT_OF_STOCK") ? "in" : "out";
  };
  const comboHasStock = (size: string, color: string) => variants.some((v) => v.size === size && v.color === color && sellable(v));
  const sizeLabelOf = (size: string) => variants.find((v) => v.size === size)?.sizeLabel;
  const hasSizeLabels = options.sizes.some((s) => Boolean(sizeLabelOf(s)));
  // Many wide pills ("XS/21" … "2XL/23.5") wrapped five-and-one on a phone, the last size alone on its own row: there they
  // share an even grid of rows instead. Short sizes (S, M, L …) still fit on one line as pills.
  const sizeCount = options.sizes.length;
  const evenPhoneRows = !hasSizeLabels && sizeCount > 4 && options.sizes.some((s) => s.length > 3);
  // Tahafi: bare sizes as one iOS-style segmented control (a soft track, the chosen size a glossy ink pill sliding along
  // it) while they fit on one row; sizes with measurements, or too many to fit, keep the tiles.
  const segmented = storeLayout() === "tahafi" && !hasSizeLabels && sizeCount >= 2 && sizeCount <= 6 && options.sizes.every((s) => s.length <= 4);
  const phoneColumns = sizeCount % 3 === 0 || sizeCount === 5 ? "grid-cols-3" : "grid-cols-4";

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
            // pt-2 / gap-y-3: room for the tags that sit on a tile's top edge.
            className={
              segmented
                ? "mt-2 flex w-full gap-0.5 rounded-full bg-ink-900/[0.06] p-1 sm:max-w-md"
                : hasSizeLabels
                  ? "grid grid-cols-3 gap-x-2 gap-y-3 pt-2 sm:grid-cols-4"
                  : evenPhoneRows
                    ? cn("grid gap-x-2 gap-y-3 pt-2 sm:flex sm:flex-wrap", phoneColumns)
                    : "flex flex-wrap gap-x-2 gap-y-3 pt-2"
            }
            role="group"
            aria-label={options.sizeLabel}
          >
            {options.sizes.map((size) => {
              const label = sizeLabelOf(size);
              const inStock = sizeHasStock(size);
              const isSelected = selectedSize === size;
              const isSuggested = suggestedSize === size && inStock;
              const state = inStock ? sizeState(size) : "out";
              return (
                // The wrapper carries the edge tag, which the tile's own overflow clipping would cut off.
                <div key={size} className={cn("relative", segmented && "min-w-0 flex-1")}>
                {/* Chosen, the stock badge below says it — the tag would only repeat it. */}
                {!isSelected && <SizeTag state={state} />}
                <motion.button
                  type="button"
                  onClick={() => onSelectSize(size)}
                  disabled={!inStock && !soldOutSelectable}
                  aria-label={inStock ? (isSuggested ? `${size}, your usual size` : size) : `${size} — out of stock`}
                  // "Few left" is a description, not part of the name: the size is still called by its own name.
                  aria-description={state === "low" && !isSelected ? "Few left" : undefined}
                  aria-pressed={isSelected}
                  title={inStock ? undefined : "Out of stock"}
                  whileTap={inStock || soldOutSelectable ? { scale: 0.9 } : undefined}
                  className={cn(
                    "relative isolate flex w-full items-center justify-center overflow-hidden border text-sm transition-colors duration-200 ease-smooth disabled:cursor-not-allowed",
                    segmented
                      ? "h-10 rounded-full px-1"
                      : hasSizeLabels
                        ? "h-14 flex-col gap-0.5 rounded-xl px-2"
                        : "h-10 min-w-12 rounded-[var(--chip-radius)] px-3",
                    isSelected
                      ? cn("border-transparent text-cream-50", !inStock && "text-cream-50/70")
                      : segmented
                        ? cn("border-transparent", inStock ? "text-ink-900 hover:bg-surface/60" : "text-ink-400")
                        : inStock
                          ? "border-ink-200 text-ink-900 hover:border-ink-900"
                          : UNAVAILABLE_PILL,
                  )}
                >
                  {isSelected && (
                    <motion.span
                      layoutId={`size-pill-${instanceId}`}
                      className={cn(
                        "glossy absolute inset-0 -z-10 bg-ink-900 shadow-sm",
                        segmented ? "rounded-full" : hasSizeLabels ? "rounded-xl" : "rounded-[var(--chip-radius)]",
                      )}
                      transition={{ type: "spring", stiffness: 500, damping: 32 }}
                    />
                  )}
                  {!inStock && <SoldOutMark className="text-danger-400" />}
                  <span className="font-medium leading-tight">{size}</span>
                  {label && <span className={cn("text-[11px] leading-tight tabular-nums", isSelected ? "text-cream-50/70" : inStock ? "text-ink-500" : "text-ink-400")}>{label}</span>}
                  {isSuggested && !isSelected && (
                    // A small accent dot on the pill: "the one you usually take".
                    <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-canvas" />
                  )}
                </motion.button>
                </div>
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
              // With one colour only, a crossed swatch would just repeat the crossed size above it.
              const soldOut = selectedSize && options.colors.length > 1 ? !comboHasStock(selectedSize, color) : false;
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
                    {soldOut && !isSelected && <SoldOutMark className="text-danger-400" />}
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
