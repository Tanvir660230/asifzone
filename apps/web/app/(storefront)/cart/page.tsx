"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCartStore, useCartSubtotal } from "@/store/cart";
import { env } from "@/lib/env";
import { formatPrice } from "@/lib/format";

export default function CartPage() {
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const subtotal = useCartSubtotal();

  // Zustand's persisted state hydrates after mount — render nothing cart-specific until then to avoid a flash of "empty cart".
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="mb-3 font-display text-2xl text-ink-900">Your cart is empty</h1>
        <Link href="/" className="text-sm text-brass-500 underline">
          Continue shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-8 font-display text-2xl text-ink-900">Your Cart</h1>

      <div className="divide-y divide-ink-100 border-y border-ink-100">
        {items.map((item) => (
          <div key={item.variantId} className="flex gap-4 py-5">
            <div className="relative h-24 w-20 shrink-0 overflow-hidden bg-ink-100">
              {item.imageUrl && (
                <Image src={`${env.apiUrl}${item.imageUrl}`} alt={item.productName} fill sizes="80px" className="object-cover" />
              )}
            </div>

            <div className="flex flex-1 flex-col justify-between">
              <div>
                <Link href={`/product/${item.productSlug}`} className="text-sm text-ink-900 hover:text-brass-500">
                  {item.productName}
                </Link>
                <p className="mt-1 text-xs text-ink-400">
                  {item.size} / {item.color} · SKU {item.sku}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center border border-ink-200">
                  <button
                    onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                    className="h-8 w-8 text-ink-700 hover:bg-ink-50"
                    aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.variantId, Math.min(item.maxStock, item.quantity + 1))}
                    className="h-8 w-8 text-ink-700 hover:bg-ink-50"
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>
                <span className="text-sm text-ink-900">{formatPrice(item.price * item.quantity)}</span>
              </div>
            </div>

            <button
              onClick={() => removeItem(item.variantId)}
              className="self-start text-ink-300 hover:text-red-700"
              aria-label="Remove item"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <span className="text-sm uppercase tracking-wide text-ink-500">Subtotal</span>
        <span className="text-lg text-ink-900">{formatPrice(subtotal)}</span>
      </div>
      <p className="mt-1 text-xs text-ink-400">Shipping and any discount are calculated at checkout.</p>

      <Link href="/checkout">
        <Button variant="primary" size="lg" className="mt-6 w-full">
          Proceed to Checkout
        </Button>
      </Link>
    </div>
  );
}
