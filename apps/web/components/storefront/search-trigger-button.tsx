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
      className="text-ink-700 transition-all duration-200 ease-smooth hover:scale-110 hover:text-brass-500"
    >
      <Search size={20} />
    </button>
  );
}
