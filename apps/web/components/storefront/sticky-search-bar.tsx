"use client";

import { Search } from "lucide-react";
import { useSearchOverlayStore } from "@/store/search-overlay";

/** Always-visible search entry point on desktop (the header itself is already `sticky`, so this
 * stays reachable while scrolling) — clicking it opens the same SearchOverlay the mobile icon
 * trigger does, rather than duplicating the suggestion/results logic in a second component. */
export function StickySearchBar() {
  const open = useSearchOverlayStore((s) => s.open);

  return (
    <button
      type="button"
      onClick={open}
      className="hidden w-48 items-center gap-2 rounded-full border border-ink-200 bg-cream-50/70 px-4 py-2 text-sm text-ink-500 transition-all duration-200 ease-smooth hover:border-ink-400 hover:text-ink-600 lg:flex xl:w-64"
    >
      <Search size={15} className="shrink-0" />
      <span className="truncate">Search products…</span>
    </button>
  );
}
