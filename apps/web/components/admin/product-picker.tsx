"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as productsApi from "@/lib/api/products";
import { formatPrice } from "@/lib/format";

interface ProductPickerProps {
  selected: Array<{ id: string; name: string }>;
  onChange: (selected: Array<{ id: string; name: string }>) => void;
}

/** Debounced product search-and-select, copying the pattern already used by the admin "New order"
 * page's item picker (search-as-you-type against GET /api/products) — chosen products render as
 * removable chips. */
export function ProductPicker({ selected, onChange }: ProductPickerProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [results, setResults] = useState<Product[]>([]);
  const selectedIds = new Set(selected.map((p) => p.id));

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }
    let active = true;
    productsApi
      .listProducts({ search: debouncedQuery, pageSize: 8 })
      .then((res) => active && setResults(res.items))
      .catch(() => active && setResults([]));
    return () => {
      active = false;
    };
  }, [debouncedQuery]);

  function add(product: Product) {
    if (selectedIds.has(product.id)) return;
    onChange([...selected, { id: product.id, name: product.name }]);
    setQuery("");
    setResults([]);
  }

  function remove(id: string) {
    onChange(selected.filter((p) => p.id !== id));
  }

  return (
    <div>
      <Input placeholder="Search products by name…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {results.length > 0 && (
        <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-ink-100 bg-cream-50 shadow-float">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => add(p)}
              disabled={selectedIds.has(p.id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors duration-150 ease-smooth hover:bg-ink-50 disabled:cursor-default disabled:opacity-40"
            >
              <span>{p.name}</span>
              <span className="text-xs text-ink-400">{formatPrice(p.basePrice)}</span>
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 py-1 pl-3 pr-2 text-xs text-ink-700">
              {p.name}
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={`Remove ${p.name}`}
                className="text-ink-400 hover:text-danger-600"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-400">No products selected yet — search above to add some.</p>
      )}
    </div>
  );
}
