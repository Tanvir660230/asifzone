"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package, Plus, Search } from "lucide-react";
import type { Product } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getProductBySlug, listStorefrontProducts } from "@/lib/api/storefront";
import { variantAvailabilityOf } from "@/lib/availability-display";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { variantDisplayPrice } from "@/lib/pricing-display";
import { cn } from "@/lib/utils";
import type { DraftLine } from "./use-modification-flow";

/** The pieces of a sellable variant a draft line needs. The price is a display hint — the server prices the change. */
export function draftLineFromVariant(product: Product, variantId: string): DraftLine {
  const v = product.variants.find((x) => x.id === variantId)!;
  return {
    key: `${variantId}:${Date.now()}`,
    variantId,
    productName: product.name,
    size: v.size,
    color: v.color,
    productSlug: product.slug,
    imageUrl: product.images?.[0]?.url ?? null,
    quantity: 1,
    originalQuantity: 0,
    unitPriceHint: Number(variantDisplayPrice(product, variantId).price),
  };
}

/** The sellable variants of a product, with server availability (D5: untracked products are always sellable). */
export function sellableVariants(product: Product, exclude: string[] = []) {
  return product.variants.filter((v) => !exclude.includes(v.id) && v.isActive !== false && Boolean(variantAvailabilityOf(product, v.id)?.sellable));
}

/** Variant chooser for one product — buttons with aria-pressed, size/colour + display price. */
export function VariantChooser({
  product,
  exclude = [],
  selected,
  onSelect,
}: {
  product: Product;
  exclude?: string[];
  selected: string | null;
  onSelect: (variantId: string) => void;
}) {
  const options = sellableVariants(product, exclude);
  if (options.length === 0) return <p className="text-sm text-ink-500">No other size or colour is available right now.</p>;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={`Options for ${product.name}`}>
      {options.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-pressed={selected === v.id}
          onClick={() => onSelect(v.id)}
          className={cn(
            "min-h-11 rounded-xl border px-3 py-1.5 text-left text-sm transition-colors",
            selected === v.id ? "border-ink-900 bg-ink-900 text-cream-50" : "border-line-strong bg-surface hover:border-ink-400",
          )}
        >
          <span className="block font-medium">{[v.sizeLabel ?? v.size, v.color].filter(Boolean).join(" / ") || v.sku}</span>
          <span className={cn("block text-xs", selected === v.id ? "text-cream-100" : "text-ink-500")}>{formatPrice(variantDisplayPrice(product, v.id).price)}</span>
        </button>
      ))}
    </div>
  );
}

/** Search the catalogue and add a variant to the draft. Uses the storefront's own product search and detail (what a
 * shopper could buy); the server re-checks everything when it prices the change. */
export function ProductPicker({ onAdd, onCancel, exclude }: { onAdd: (line: DraftLine) => void; onCancel: () => void; exclude: string[] }) {
  const [query, setQuery] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const search = query.trim();
  const { data: results, isFetching } = useQuery({
    queryKey: ["change-order-product-search", search],
    queryFn: () => listStorefrontProducts({ search, pageSize: 6 }),
    enabled: search.length >= 2 && !slug,
  });
  const { data: productData } = useQuery({ queryKey: ["product-slug", slug], queryFn: () => getProductBySlug(slug!), enabled: Boolean(slug) });
  const product = productData?.product;

  return (
    <div className="space-y-3 rounded-xl border border-line-subtle bg-surface p-3" data-testid="product-picker">
      {!slug ? (
        <>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <Input autoFocus aria-label="Search products to add" placeholder="Search products…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {search.length < 2 ? (
            <p className="text-xs text-ink-500">Type at least 2 letters.</p>
          ) : isFetching ? (
            <p className="text-xs text-ink-500" aria-live="polite">
              Searching…
            </p>
          ) : (results?.items.length ?? 0) === 0 ? (
            <p className="text-xs text-ink-500" aria-live="polite">
              No products found.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Search results">
              {results!.items.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setSlug(p.slug)} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-ink-50">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line-subtle bg-ink-50">
                      {p.images?.[0]?.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolveImageUrl(p.images[0].url)} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <Package size={14} className="text-ink-300" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <button type="button" onClick={() => (setSlug(null), setVariantId(null))} className="inline-flex min-h-11 items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
            <ArrowLeft size={14} aria-hidden="true" /> Back to results
          </button>
          {!product ? <p className="text-sm text-ink-500">Loading…</p> : (
            <>
              <p className="font-medium text-ink-900">{product.name}</p>
              <VariantChooser product={product} exclude={exclude} selected={variantId} onSelect={setVariantId} />
            </>
          )}
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!product || !variantId} onClick={() => product && variantId && onAdd(draftLineFromVariant(product, variantId))}>
          <Plus size={14} aria-hidden="true" /> Add to order
        </Button>
      </div>
    </div>
  );
}
