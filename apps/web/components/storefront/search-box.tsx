"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, XCircle } from "lucide-react";
import { addRecentSearch } from "@/lib/recent-searches";

/** The results page's own field, for refining the search where the results start. Filled like the overlay's field;
 * Enter (or the keyboard's Search key) submits, so there is no separate button to aim for. */
export function SearchBox({ initialValue = "" }: { initialValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);

  // A new search from elsewhere (the overlay, a suggestion) lands on this same page: follow it.
  useEffect(() => setValue(initialValue), [initialValue]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) addRecentSearch(trimmed);
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
  }

  return (
    <form role="search" onSubmit={handleSubmit} className="max-w-xl">
      <div className="flex h-12 items-center gap-2.5 rounded-lg bg-ink-100/70 pl-4 pr-1.5 transition-shadow duration-fast ease-smooth focus-within:ring-2 focus-within:ring-accent/15">
        <Search size={18} className="shrink-0 text-fg-subtle" aria-hidden />
        <input
          type="search"
          name="q"
          enterKeyHint="search"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search products"
          aria-label="Search products"
          className="h-full min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            onClick={() => setValue("")}
            aria-label="Clear search"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-subtle transition-colors duration-fast ease-smooth hover:text-fg"
          >
            <XCircle size={17} />
          </button>
        )}
      </div>
    </form>
  );
}
