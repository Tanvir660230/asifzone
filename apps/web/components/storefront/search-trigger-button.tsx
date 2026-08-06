"use client";

import { Search } from "lucide-react";
import { useSearchOverlayStore } from "@/store/search-overlay";

export function SearchTriggerButton() {
  const open = useSearchOverlayStore((s) => s.open);
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Search"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-700 transition-all duration-200 ease-smooth hover:bg-ink-100 hover:text-brass-500"
    >
      <Search size={19} />
    </button>
  );
}
