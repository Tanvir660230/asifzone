"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import type { StorefrontFacets } from "@/lib/api/storefront";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { CLOSE_PANELS_EVENT } from "@/store/panels";
import { cn, isPaleColor } from "@/lib/utils";

/** `toolbarExtra` sits beside the Filters button in the phone toolbar (the sort control), so both stay pinned under the
 * header while the shopper scrolls the grid. */
export function FacetFilters({ facets, toolbarExtra }: { facets: StorefrontFacets; toolbarExtra?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useFocusTrap<HTMLDivElement>({ active: mobileOpen, onEscape: () => setMobileOpen(false) });
  useSheetDrag(drawerRef, () => setMobileOpen(false), mobileOpen);
  // The phone tab bar stays in view under this sheet; a tap on any of its tabs closes it (store/panels.ts).
  useEffect(() => {
    if (!mobileOpen) return;
    const close = () => setMobileOpen(false);
    window.addEventListener(CLOSE_PANELS_EVENT, close);
    return () => window.removeEventListener(CLOSE_PANELS_EVENT, close);
  }, [mobileOpen]);

  const activeSizes = searchParams.get("sizes")?.split(",").filter(Boolean) ?? [];
  const activeColors = searchParams.get("colors")?.split(",").filter(Boolean) ?? [];
  const minPrice = searchParams.get("minPrice") ?? "";
  const maxPrice = searchParams.get("maxPrice") ?? "";
  const activeCount = activeSizes.length + activeColors.length + (minPrice ? 1 : 0) + (maxPrice ? 1 : 0);

  // Local + debounced so typing a price doesn't fire a router.push (full RSC refetch) on
  // every keystroke — that was janky and hurt INP.
  const [minPriceInput, setMinPriceInput] = useState(minPrice);
  const [maxPriceInput, setMaxPriceInput] = useState(maxPrice);
  const debouncedMinPrice = useDebouncedValue(minPriceInput, 500);
  const debouncedMaxPrice = useDebouncedValue(maxPriceInput, 500);

  useEffect(() => {
    if (debouncedMinPrice !== minPrice) setPriceParam("minPrice", debouncedMinPrice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedMinPrice]);

  useEffect(() => {
    if (debouncedMaxPrice !== maxPrice) setPriceParam("maxPrice", debouncedMaxPrice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedMaxPrice]);

  function updateParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggleListParam(key: "sizes" | "colors", value: string) {
    updateParams((params) => {
      const current = params.get(key)?.split(",").filter(Boolean) ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      if (next.length > 0) params.set(key, next.join(","));
      else params.delete(key);
    });
  }

  function setPriceParam(key: "minPrice" | "maxPrice", value: string) {
    updateParams((params) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
  }

  function clearAll() {
    setMinPriceInput("");
    setMaxPriceInput("");
    updateParams((params) => {
      params.delete("sizes");
      params.delete("colors");
      params.delete("minPrice");
      params.delete("maxPrice");
    });
  }

  if (facets.sizes.length === 0 && facets.colors.length === 0) return null;

  const evenSizeRows = facets.sizes.length > 4 && facets.sizes.some((s) => s.length > 3);

  const panel = (
    <div className="space-y-8">
      {facets.sizes.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs ui-caps text-ink-500">Size</h3>
          {/* Many wide sizes ("XL 23", "2XL 23.5") wrapped five-and-one, the last alone on its row: an even three-column grid
              instead, in the phone sheet and the narrow desktop sidebar alike. Short sizes stay a row of chips. */}
          <div className={evenSizeRows ? "grid grid-cols-3 gap-2" : "flex flex-wrap gap-2"}>
            {facets.sizes.map((size) => (
              <button
                key={size}
                onClick={() => toggleListParam("sizes", size)}
                className={cn(
                  "h-9 min-w-9 rounded-[var(--chip-radius)] border text-sm transition-all duration-200 ease-smooth active:scale-95",
                  evenSizeRows ? "whitespace-nowrap px-1" : "px-2.5",
                  activeSizes.includes(size)
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

      {facets.colors.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs ui-caps text-ink-500">Color</h3>
          <div className="flex flex-wrap gap-3">
            {facets.colors.map(({ color, colorHex }) => (
              <button
                key={color}
                onClick={() => toggleListParam("colors", color)}
                title={color}
                aria-label={color}
                aria-pressed={activeColors.includes(color)}
                className={cn(
                  "glossy h-8 w-8 rounded-[var(--swatch-radius)] border-2 shadow-sm transition-all duration-200 ease-smooth active:scale-90",
                  activeColors.includes(color)
                    ? "border-brass-400 ring-2 ring-brass-200"
                    : isPaleColor(colorHex)
                      ? "border-ink-300"
                      : "border-ink-200",
                )}
                style={{ backgroundColor: colorHex ?? "#d4d4d4" }}
              />
            ))}
          </div>
        </div>
      )}

      {facets.maxPrice > 0 && facets.minPrice !== facets.maxPrice && (
        <div>
          <h3 className="mb-3 text-xs ui-caps text-ink-500">
            Price ({facets.minPrice}–{facets.maxPrice})
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              placeholder={String(facets.minPrice)}
              aria-label="Minimum price"
              value={minPriceInput}
              onChange={(e) => setMinPriceInput(e.target.value)}
              className="h-9 w-full rounded border border-ink-200 px-2 text-sm focus:border-brass-400"
            />
            <span className="text-ink-400">–</span>
            <input
              type="number"
              min={0}
              placeholder={String(facets.maxPrice)}
              aria-label="Maximum price"
              value={maxPriceInput}
              onChange={(e) => setMaxPriceInput(e.target.value)}
              className="h-9 w-full rounded border border-ink-200 px-2 text-sm focus:border-brass-400"
            />
          </div>
        </div>
      )}

      {activeCount > 0 && (
        <button onClick={clearAll} className="text-xs ui-caps text-ink-500 underline hover:text-brass-500">
          Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="sticky top-[var(--sticky-top)] z-raised -mx-4 flex items-center gap-2 border-b border-line-subtle bg-canvas px-4 py-2.5 transition-[top] duration-slow ease-smooth sm:-mx-6 sm:px-6 lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex h-10 items-center gap-2 rounded-[var(--chip-radius)] border border-line bg-surface px-4 text-sm font-medium text-ink-900 transition-colors hover:border-ink-900 active:scale-[0.98]"
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          Filters
          {activeCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">{activeCount}</span>
          )}
        </button>
        {toolbarExtra && <div className="ml-auto min-w-0">{toolbarExtra}</div>}
      </div>

      <aside className="hidden w-56 shrink-0 lg:block">{panel}</aside>

      {/* Phones: a sheet over the dimmed grid, above the tab bar — results update behind it as filters change; Done or a
          drag down puts it away. */}
      {mobileOpen && (
        <div className="ui-overlay ui-sheet-overlay fixed inset-x-0 bottom-[var(--dock-offset)] top-0 z-50 animate-fade-in lg:hidden" onClick={() => setMobileOpen(false)}>
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-filters-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="ui-sheet ui-sheet-large flex w-full flex-col overflow-hidden bg-cream-50 md:h-full"
          >
            <span className="ui-sheet-grabber" aria-hidden />
            <div data-sheet-handle className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <h2 id="mobile-filters-title" className="font-display text-lg text-ink-900">
                Filters
              </h2>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="-mr-2 flex h-11 items-center gap-1 rounded-full px-3 text-[0.9375rem] font-semibold text-ink-900"
              >
                Done
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6">{panel}</div>
          </div>
        </div>
      )}
    </>
  );
}
