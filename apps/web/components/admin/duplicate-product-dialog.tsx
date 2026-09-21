"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DUPLICATE_COPY_OPTIONS, resolveDuplicateOptions, type DuplicateCopyKey, type DuplicateProductResult } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import * as productsApi from "@/lib/api/products";
import { describeApiError } from "@/lib/api-client";

interface DuplicateProductDialogProps {
  product: { id: string; name: string } | null;
  onClose: () => void;
}

const defaults = () => resolveDuplicateOptions(undefined);

/** Make a draft copy of a product, choosing what comes along. Ends on a summary (what was copied, and anything the admin
 * should know) instead of navigating away, so warnings are never lost. */
export function DuplicateProductDialog({ product, onClose }: DuplicateProductDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [copy, setCopy] = useState<Record<DuplicateCopyKey, boolean>>(defaults);
  const [result, setResult] = useState<DuplicateProductResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      setName(`${product.name} (copy)`);
      setCopy(defaults());
      setResult(null);
      setError(null);
    }
  }, [product]);

  const mutation = useMutation({
    mutationFn: () => productsApi.duplicateProduct(product!.id, { name: name.trim() || undefined, copy }),
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err) => setError(describeApiError(err, "Couldn't duplicate the product")),
  });

  return (
    <Modal open={product !== null} onClose={onClose} title={result ? "Draft created" : `Duplicate "${product?.name ?? ""}"`} widthClassName="max-w-lg">
      {result ? (
        <div className="space-y-4" data-testid="duplicate-result">
          <p className="text-sm text-ink-700">
            <strong>{result.name}</strong> was created as a draft. It has its own SKUs, slug and images, and isn&rsquo;t visible on the store until you publish it.
          </p>
          <p className="text-sm text-ink-600">
            Brought over: {Object.entries(result.copied).map(([k, n]) => `${n} ${k}`).join(", ") || "the basics"}.
          </p>
          {result.warnings.length > 0 && (
            <ul className="list-disc space-y-1 rounded-lg bg-brass-50 p-3 pl-7 text-sm text-ink-800" data-testid="duplicate-warnings">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Link href={`/admin/products/${result.productId}/edit`}>
              <Button type="button" variant="brass">
                Open the copy
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
        >
          <div>
            <Label htmlFor="duplicate-name">Name of the copy</Label>
            <Input id="duplicate-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-ink-900">Also copy</legend>
            <div className="space-y-2.5">
              {DUPLICATE_COPY_OPTIONS.map((o) => (
                <label key={o.key} className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox className="mt-0.5" checked={copy[o.key]} onChange={(e) => setCopy((c) => ({ ...c, [o.key]: e.target.checked }))} aria-label={o.label} />
                  <span>
                    <span className="block text-sm text-ink-900">{o.label}</span>
                    <span className="block text-xs text-ink-500">{o.help}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <p className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
            Always copied: category, type, prices, descriptions, brand, details and every variant&rsquo;s options and prices. Never copied: SKUs (new ones are generated), barcodes,
            the URL slug, reviews, orders and history. The copy is a draft.
          </p>

          {error && (
            <p className="text-sm text-danger-600" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="brass" disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending ? "Copying…" : "Create draft copy"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
