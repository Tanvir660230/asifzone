"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AdjustStockInput } from "@clothing-brand/shared";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import * as inventoryApi from "@/lib/api/inventory";
import * as productsApi from "@/lib/api/products";
import { ApiError } from "@/lib/api-client";

export interface AdjustStockPrefill {
  variantId: string;
  label: string;
}

interface AdjustStockModalProps {
  open: boolean;
  onClose: () => void;
  /** Skips the product/variant picker and adjusts this exact variant — used by the Check Integrity
   * panel's one-click "Adjust" link, which already knows which variant drifted. */
  prefill?: AdjustStockPrefill | null;
  onSuccess: () => void;
}

export function AdjustStockModal({ open, onClose, prefill, onSuccess }: AdjustStockModalProps) {
  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [delta, setDelta] = useState<string>("");
  const [reason, setReason] = useState<"ADJUSTMENT" | "RESTOCK">("ADJUSTMENT");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const searchQuery = useQuery({
    queryKey: ["inventory-product-search", search],
    queryFn: () => productsApi.listProducts({ search, pageSize: 8 }),
    enabled: !prefill && search.trim().length > 1,
  });

  const selectedProduct = searchQuery.data?.items.find((p) => p.id === selectedProductId);

  const adjustMutation = useMutation({
    mutationFn: ({ variantId, input }: { variantId: string; input: AdjustStockInput }) =>
      inventoryApi.adjustStock(variantId, input),
  });

  function reset() {
    setSearch("");
    setSelectedProductId(null);
    setSelectedVariantId(null);
    setDelta("");
    setReason("ADJUSTMENT");
    setNote("");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const variantId = prefill?.variantId ?? selectedVariantId;
    if (!variantId) {
      setError("Pick a product and variant first");
      return;
    }
    const parsedDelta = Number(delta);
    if (delta.trim() === "" || Number.isNaN(parsedDelta) || parsedDelta === 0) {
      setError("Enter a non-zero quantity change (e.g. 10 or -3)");
      return;
    }

    try {
      await adjustMutation.mutateAsync({ variantId, input: { delta: parsedDelta, reason, note: note.trim() || null } });
      toast.success("Stock adjusted");
      onSuccess();
      handleClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to adjust stock");
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Adjust stock">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-danger-600">{error}</p>}

        {prefill ? (
          <div className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-sm text-ink-700">{prefill.label}</div>
        ) : (
          <>
            <div>
              <Label htmlFor="stock-product-search">Product</Label>
              <Input
                id="stock-product-search"
                placeholder="Search by product name…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelectedProductId(null);
                  setSelectedVariantId(null);
                }}
              />
              {search.trim().length > 1 && !selectedProductId && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-ink-100">
                  {searchQuery.isLoading ? (
                    <p className="px-3 py-2 text-xs text-ink-400">Searching…</p>
                  ) : searchQuery.data && searchQuery.data.items.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-ink-400">No matches.</p>
                  ) : (
                    searchQuery.data?.items.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => {
                          setSelectedProductId(p.id);
                          setSelectedVariantId(null);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-ink-50"
                      >
                        {p.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {selectedProduct && (
              <div>
                <Label htmlFor="stock-variant-select">Variant</Label>
                <Select
                  id="stock-variant-select"
                  value={selectedVariantId ?? ""}
                  onChange={(e) => setSelectedVariantId(e.target.value || null)}
                >
                  <option value="">Select a variant…</option>
                  {selectedProduct.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.sku} — {v.size}/{v.color} (current: {v.stock})
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="stock-delta">Quantity change</Label>
            <Input
              id="stock-delta"
              type="number"
              placeholder="e.g. 10 or -3"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="stock-reason">Reason</Label>
            <Select id="stock-reason" value={reason} onChange={(e) => setReason(e.target.value as "ADJUSTMENT" | "RESTOCK")}>
              <option value="ADJUSTMENT">Adjustment / correction</option>
              <option value="RESTOCK">Restock (new stock arrived)</option>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="stock-note">Note (optional)</Label>
          <Textarea id="stock-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" variant="brass" disabled={adjustMutation.isPending}>
            {adjustMutation.isPending ? "Saving…" : "Adjust stock"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
