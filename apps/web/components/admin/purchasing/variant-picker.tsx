"use client";

import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchInput } from "@/components/ui/search-input";
import * as purchasingApi from "@/lib/api/purchasing";
import type { PurchasableVariant } from "@/lib/api/purchasing";

/** Picks a stock-tracked variant by SKU or product name (purchasing.read lookup). Shows the chosen variant; "Change"
 * reopens the search. Used by purchase orders, receipts and returns (and manufacturing). */
export function VariantPicker({ value, onChange, label = "Variant" }: { value: PurchasableVariant | null; onChange: (v: PurchasableVariant | null) => void; label?: string }) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const listId = useId();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  const results = useQuery({ queryKey: purchasingApi.purchasingDocKeys.variants(debounced), queryFn: () => purchasingApi.searchVariants(debounced), enabled: !value && debounced.length >= 2 });

  if (value) {
    return (
      <div className="flex min-h-10 items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
        <span className="min-w-0">
          <span className="font-mono text-xs text-ink-600">{value.sku}</span>
          <span className="block truncate text-ink-900">{value.name}</span>
        </span>
        <button type="button" className="shrink-0 text-sm font-medium text-fg underline-offset-4 hover:underline" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <SearchInput value={term} onChange={setTerm} placeholder="Search SKU or product" aria-label={label} aria-controls={listId} />
      {debounced.length >= 2 && (
        <ul id={listId} role="listbox" aria-label={`${label} results`} className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-surface py-1 shadow-float">
          {results.isLoading && <li className="px-3 py-2 text-sm text-ink-500">Searching…</li>}
          {results.isError && <li className="px-3 py-2 text-sm text-danger-700">Search failed — try again</li>}
          {results.data?.variants.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">No stock-tracked variant matches</li>}
          {results.data?.variants.map((v) => (
            <li key={v.id} role="option" aria-selected={false}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-ink-900/[0.04] focus-visible:bg-ink-900/[0.06] focus-visible:outline-none" onClick={() => { onChange(v); setTerm(""); }} data-testid="variant-option">
                <span className="font-mono text-xs text-ink-600">{v.sku}</span>
                <span className="block text-ink-900">{v.name}</span>
                <span className="text-xs text-ink-500">{v.stock} in stock</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
