"use client";

import { Search } from "lucide-react";
import { useSearchOverlayStore } from "@/store/search-overlay";

/** Always-visible search entry point on desktop (the header itself is already `sticky`, so this
 * stays reachable while scrolling) — clicking it opens the same SearchOverlay the mobile icon
 * trigger does, rather than duplicating the suggestion/results logic in a second component.
 * Drawn as the same filled field the overlay opens with, so the click feels like focusing it. */
export function StickySearchBar() {
  const open = useSearchOverlayStore((s) => s.open);

  return (
    <button
      type="button"
      onClick={open}
      aria-keyshortcuts="/ Control+K Meta+K"
      className="hidden h-10 w-52 items-center gap-2 rounded-lg bg-ink-100/70 pl-3 pr-2 text-sm text-fg-muted transition-colors duration-fast ease-smooth hover:bg-ink-100 hover:text-fg lg:flex xl:w-64"
    >
      <Search size={16} className="shrink-0" aria-hidden />
      <span className="flex-1 truncate text-left">Search products</span>
      <kbd className="hidden h-5 min-w-5 items-center justify-center rounded border border-line bg-surface px-1 font-sans text-xs text-fg-subtle xl:inline-flex">
        /
      </kbd>
    </button>
  );
}
