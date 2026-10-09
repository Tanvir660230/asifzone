"use client";

import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchInput } from "@/components/ui/search-input";
import * as mfg from "@/lib/api/manufacturing";
import type { ProducibleProduct } from "@/lib/api/manufacturing";

/** Picks a finished, stock-tracked product (with its variants) to produce or to give a bill of materials. */
export function ProductPicker({ value, onChange }: { value: ProducibleProduct | null; onChange: (p: ProducibleProduct | null) => void }) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const listId = useId();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  const results = useQuery({ queryKey: mfg.manufacturingKeys.products(debounced), queryFn: () => mfg.searchProducts(debounced), enabled: !value && debounced.length >= 2 });

  if (value) {
    return (
      <div className="flex min-h-10 items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink-900">{value.name}</span>
          <span className="text-xs text-ink-500">{value.variants.length} variant(s)</span>
        </span>
        <button type="button" className="shrink-0 text-sm font-medium text-fg underline-offset-4 hover:underline" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <SearchInput value={term} onChange={setTerm} placeholder="Search finished product or SKU" aria-label="Product" aria-controls={listId} />
      {debounced.length >= 2 && (
        <ul id={listId} role="listbox" aria-label="Product results" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-surface py-1 shadow-float">
          {results.isLoading && <li className="px-3 py-2 text-sm text-ink-500">Searching…</li>}
          {results.isError && <li className="px-3 py-2 text-sm text-danger-700">Search failed — try again</li>}
          {results.data?.products.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">No stock-tracked product matches</li>}
          {results.data?.products.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-ink-900/[0.04] focus-visible:bg-ink-900/[0.06] focus-visible:outline-none" onClick={() => { onChange(p); setTerm(""); }} data-testid="product-option">
                <span className="block text-ink-900">{p.name}</span>
                <span className="text-xs text-ink-500">{p.variants.map((v) => v.size).filter((s, i, a) => a.indexOf(s) === i).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
