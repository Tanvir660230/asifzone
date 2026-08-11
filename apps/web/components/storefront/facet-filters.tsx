"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import type { StorefrontFacets } from "@/lib/api/storefront";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn, isPaleColor } from "@/lib/utils";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function FacetFilters({ facets }: { facets: StorefrontFacets }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mobileOpen) return;

    triggerRef.current = document.activeElement as HTMLElement | null;
    const panel = drawerRef.current;
    const focusable = panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
    (focusable[0] ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
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

  const panel = (
    <div className="space-y-8">
      {facets.sizes.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs uppercase tracking-wide text-ink-500">Size</h3>
          <div className="flex flex-wrap gap-2">
            {facets.sizes.map((size) => (
              <button
                key={size}
                onClick={() => toggleListParam("sizes", size)}
                className={cn(
                  "h-9 min-w-9 rounded-full border px-2.5 text-sm transition-all duration-200 ease-smooth active:scale-95",
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
          <h3 className="mb-3 text-xs uppercase tracking-wide text-ink-500">Color</h3>
          <div className="flex flex-wrap gap-3">
            {facets.colors.map(({ color, colorHex }) => (
              <button
                key={color}
                onClick={() => toggleListParam("colors", color)}
                title={color}
                aria-label={color}
                aria-pressed={activeColors.includes(color)}
                className={cn(
                  "glossy h-8 w-8 rounded-full border-2 shadow-sm transition-all duration-200 ease-smooth active:scale-90",
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
          <h3 className="mb-3 text-xs uppercase tracking-wide text-ink-500">
            Price ({facets.minPrice}–{facets.maxPrice})
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              placeholder={String(facets.minPrice)}
              value={minPriceInput}
              onChange={(e) => setMinPriceInput(e.target.value)}
              className="h-9 w-full rounded border border-ink-200 px-2 text-sm focus:border-brass-400"
            />
            <span className="text-ink-400">–</span>
            <input
              type="number"
              min={0}
              placeholder={String(facets.maxPrice)}
              value={maxPriceInput}
              onChange={(e) => setMaxPriceInput(e.target.value)}
              className="h-9 w-full rounded border border-ink-200 px-2 text-sm focus:border-brass-400"
            />
          </div>
        </div>
      )}

      {activeCount > 0 && (
        <button onClick={clearAll} className="text-xs uppercase tracking-wide text-ink-500 underline hover:text-brass-500">
          Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="mb-4 lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center gap-2 rounded border border-ink-200 px-4 py-2 text-sm text-ink-700"
        >
          <SlidersHorizontal size={16} />
          Filters{activeCount > 0 && ` (${activeCount})`}
        </button>
      </div>

      <aside className="hidden w-56 shrink-0 lg:block">{panel}</aside>

      {mobileOpen && (
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-filters-title"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col bg-cream-50 lg:hidden"
        >
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-4">
            <h2 id="mobile-filters-title" className="font-display text-lg text-ink-900">
              Filters
            </h2>
            <button onClick={() => setMobileOpen(false)} aria-label="Close filters">
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-6">{panel}</div>
        </div>
      )}
    </>
  );
}
