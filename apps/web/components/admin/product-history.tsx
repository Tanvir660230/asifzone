"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import * as productsApi from "@/lib/api/products";

const ACTION_LABELS: Record<string, string> = {
  "product.created": "Product created",
  "product.published": "Published",
  "product.unpublished": "Unpublished",
  "product.status_changed": "Status changed",
  "product.price_changed": "Price changed",
  "product.stock_changed": "Stock changed",
  "product.variants_changed": "Variants changed",
  "product.description_updated": "Description updated",
  "product.size_guide_changed": "Size guide changed",
  "product.attributes_updated": "Details updated",
  "product.seo_updated": "SEO updated",
  "product.care_updated": "Care instructions updated",
  "product.materials_updated": "Materials updated",
  "product.details_updated": "Product details updated",
  // Written by the generic audit trail (older saves, deletes, restores, image changes).
  "products.update": "Product updated",
  "products.create": "Product created",
  "products.delete": "Moved to trash",
  "products.restore": "Restored from trash",
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Who changed what and when, newest first — fed by the structured events the API records on every save. */
export function ProductHistory({ productId }: { productId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery({ queryKey: ["product-history", productId, page], queryFn: () => productsApi.getProductHistory(productId, page) });

  if (isLoading) return <p className="text-sm text-ink-400">Loading history…</p>;
  if (isError || !data) return <p className="text-sm text-danger-600">Couldn&rsquo;t load the history.</p>;
  if (data.items.length === 0) return <p className="text-sm text-ink-500">No changes recorded yet.</p>;

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div data-testid="product-history">
      <ol className="space-y-3">
        {data.items.map((item) => (
          <li key={item.id} className="rounded-lg border border-ink-100 bg-cream-50 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-ink-900">
                {ACTION_LABELS[item.action] ?? item.action}
                {item.metadata?.bulk && <span className="ml-1.5 text-xs font-normal text-ink-400">(bulk)</span>}
              </span>
              <span className="text-xs text-ink-400">
                {item.admin?.name ?? "System"} · {new Date(item.createdAt).toLocaleString()}
              </span>
            </div>
            {item.metadata?.changes && item.metadata.changes.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-xs text-ink-600">
                {item.metadata.changes.map((c, i) => (
                  <li key={i}>
                    <span className="text-ink-500">{c.field}:</span> {show(c.from)} <span className="text-ink-300">→</span> <span className="font-medium text-ink-800">{show(c.to)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink-500">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      )}
    </div>
  );
}
