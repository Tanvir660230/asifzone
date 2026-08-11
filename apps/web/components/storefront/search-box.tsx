"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export function SearchBox({ initialValue = "" }: { initialValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(value.trim() ? `/search?q=${encodeURIComponent(value.trim())}` : "/search");
  }

  return (
    <form onSubmit={handleSubmit} className="relative mx-auto flex max-w-xl items-center">
      <Search size={18} className="pointer-events-none absolute left-5 shrink-0 text-ink-400" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search for products, categories, styles…"
        className="h-14 w-full rounded-full border border-ink-200 bg-cream-50 pl-12 pr-[6.5rem] text-sm text-ink-900 shadow-sm outline-none transition-all duration-200 ease-smooth placeholder:text-ink-400 focus:border-brass-400 focus:shadow-glow sm:pr-28 sm:text-base"
      />
      <button
        type="submit"
        className="glossy absolute right-1.5 flex h-11 shrink-0 items-center rounded-full bg-brass-400 px-5 text-xs font-medium uppercase tracking-wide text-ink-900 shadow-sm transition-all duration-200 ease-smooth hover:bg-brass-500 active:scale-95"
      >
        Search
      </button>
    </form>
  );
}
