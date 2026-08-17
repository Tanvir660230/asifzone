"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCartStore, useCartSubtotal } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { resolveImageUrl } from "@/lib/image-url";
import { formatPrice } from "@/lib/format";

export function CartDrawer() {
  const { isOpen, close } = useCartDrawerStore();
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const subtotal = useCartSubtotal();
  const panelRef = useFocusTrap<HTMLDivElement>({ active: isOpen, onEscape: close });

  // Zustand's persisted cart hydrates after mount — avoid a flash of "empty cart" on first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-ink-950/40 backdrop-blur-sm animate-fade-in"
      onClick={close}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="ml-auto flex h-full w-full max-w-md flex-col bg-cream-50 shadow-floatLg animate-slide-in-right"
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 className="font-display text-lg text-ink-900">
            Your Cart{mounted && items.length > 0 ? ` (${items.reduce((sum, i) => sum + i.quantity, 0)})` : ""}
          </h2>
          <button
            onClick={close}
            aria-label="Close cart"
            className="rounded-full p-1.5 text-ink-400 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-900"
          >
            <X size={20} />
          </button>
        </div>

        {!mounted ? null : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <ShoppingBag size={36} className="text-ink-200" />
            <p className="text-sm text-ink-500">Your cart is empty</p>
            <Button variant="outline" size="sm" onClick={close}>
              Continue shopping
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto divide-y divide-ink-100 px-5">
              {items.map((item) => (
                <div key={item.variantId} className="flex gap-3 py-4">
                  <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-md bg-ink-100">
                    {item.imageUrl && (
                      <Image
                        src={resolveImageUrl(item.imageUrl)}
                        alt={item.productName}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    )}
                  </div>

                  <div className="flex flex-1 flex-col justify-between min-w-0">
                    <div>
                      <Link
                        href={`/product/${item.productSlug}`}
                        onClick={close}
                        className="line-clamp-2 text-sm text-ink-900 hover:text-brass-500"
                      >
                        {item.productName}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-400">
                        {item.size} / {item.color}
                      </p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center border border-ink-200">
                        <button
                          onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                          className="flex h-7 w-7 items-center justify-center text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-200 disabled:hover:bg-transparent"
                          aria-label="Decrease quantity"
                          title={item.quantity <= 1 ? "Use the trash icon to remove this item" : undefined}
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-6 text-center text-xs">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.variantId, Math.min(item.maxStock, item.quantity + 1))}
                          className="flex h-7 w-7 items-center justify-center text-ink-700 hover:bg-ink-50"
                          aria-label="Increase quantity"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <span className="text-sm text-ink-900">{formatPrice(item.price * item.quantity)}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => removeItem(item.variantId)}
                    className="self-start text-ink-300 hover:text-red-700"
                    aria-label={`Remove ${item.productName} from cart`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>

            <div className="border-t border-ink-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm uppercase tracking-wide text-ink-500">Subtotal</span>
                <span className="text-lg text-ink-900">{formatPrice(subtotal)}</span>
              </div>
              <p className="mt-1 text-xs text-ink-400">Shipping and any discount are calculated at checkout.</p>

              <Link href="/checkout" onClick={close}>
                <Button variant="primary" size="lg" className="mt-4 w-full">
                  Proceed to Checkout
                </Button>
              </Link>
              <Link
                href="/cart"
                onClick={close}
                className="mt-3 block text-center text-sm text-ink-500 underline transition-colors duration-150 ease-smooth hover:text-brass-600"
              >
                View full cart
              </Link>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
