"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { X, Scale } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useCompareStore, MAX_COMPARE_ITEMS } from "@/store/compare";
import { formatPrice } from "@/lib/format";
import { env } from "@/lib/env";

function attributeList(values: (string | null)[]): string {
  const unique = Array.from(new Set(values.filter((v): v is string => Boolean(v))));
  return unique.length > 0 ? unique.join(", ") : "—";
}

export function CompareBar() {
  const items = useCompareStore((s) => s.items);
  const remove = useCompareStore((s) => s.remove);
  const clear = useCompareStore((s) => s.clear);
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <>
      <div className="glass fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 shadow-floatLg animate-modal-in">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-1 items-center gap-2 overflow-x-auto">
            {items.map((product) => {
              const image = product.images[0];
              return (
                <div key={product.id} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-ink-100">
                  {image && (
                    <Image src={`${env.apiUrl}${image.url}`} alt={product.name} fill sizes="48px" className="object-cover" />
                  )}
                  <button
                    onClick={() => remove(product.id)}
                    aria-label={`Remove ${product.name} from compare`}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-ink-900 text-cream-50"
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="hidden shrink-0 text-xs text-ink-400 sm:block">
            {items.length}/{MAX_COMPARE_ITEMS} selected
          </p>
          <Button type="button" variant="brass" size="sm" onClick={() => setOpen(true)} disabled={items.length < 2}>
            <Scale size={14} /> Compare
          </Button>
          <button onClick={clear} className="shrink-0 text-xs text-ink-400 underline hover:text-ink-700">
            Clear
          </button>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Compare products" widthClassName="max-w-5xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] table-fixed border-collapse text-left text-sm">
            <tbody>
              <tr>
                <td className="w-28 py-2 text-xs uppercase tracking-wide text-ink-400">Product</td>
                {items.map((product) => (
                  <td key={product.id} className="p-2">
                    <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-ink-100">
                      {product.images[0] && (
                        <Image
                          src={`${env.apiUrl}${product.images[0].url}`}
                          alt={product.name}
                          fill
                          sizes="200px"
                          className="object-cover"
                        />
                      )}
                    </div>
                    <Link
                      href={`/product/${product.slug}`}
                      onClick={() => setOpen(false)}
                      className="mt-2 block text-sm text-ink-900 hover:text-brass-600"
                    >
                      {product.name}
                    </Link>
                  </td>
                ))}
              </tr>
              <tr className="border-t border-ink-100">
                <td className="py-2 text-xs uppercase tracking-wide text-ink-400">Price</td>
                {items.map((product) => (
                  <td key={product.id} className="p-2 text-ink-900">
                    {formatPrice(product.activeFlashSale?.flashPrice ?? product.basePrice)}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-ink-100">
                <td className="py-2 text-xs uppercase tracking-wide text-ink-400">Brand tier</td>
                {items.map((product) => (
                  <td key={product.id} className="p-2 text-ink-700">
                    {product.brandTier}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-ink-100">
                <td className="py-2 text-xs uppercase tracking-wide text-ink-400">Category</td>
                {items.map((product) => (
                  <td key={product.id} className="p-2 text-ink-700">
                    {product.category.name}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-ink-100">
                <td className="py-2 text-xs uppercase tracking-wide text-ink-400">Sizes</td>
                {items.map((product) => (
                  <td key={product.id} className="p-2 text-ink-700">
                    {attributeList(product.variants.map((v) => v.size))}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-ink-100">
                <td className="py-2 text-xs uppercase tracking-wide text-ink-400">Colors</td>
                {items.map((product) => (
                  <td key={product.id} className="p-2 text-ink-700">
                    {attributeList(product.variants.map((v) => v.color))}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-ink-100">
                <td className="py-2 text-xs uppercase tracking-wide text-ink-400">In stock</td>
                {items.map((product) => {
                  const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);
                  return (
                    <td key={product.id} className={`p-2 ${totalStock > 0 ? "text-success-600" : "text-danger-600"}`}>
                      {totalStock > 0 ? `${totalStock} available` : "Sold out"}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  );
}
