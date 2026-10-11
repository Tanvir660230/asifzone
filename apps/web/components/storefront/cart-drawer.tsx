"use client";

import { formatVariantLabel, type Product } from "@clothing-brand/shared";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, ShoppingBag, Trash2, Truck, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCartStore } from "@/store/cart";
import { useCartQuote, quoteLineAmount } from "@/hooks/use-quote";
import { useCartSuggestions } from "@/hooks/use-cart-suggestions";
import { useAddToCart } from "@/hooks/use-add-to-cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { getSettings } from "@/lib/api/settings";
import { availabilityOf } from "@/lib/availability-display";
import { productDisplayPrice } from "@/lib/pricing-display";
import { resolveImageUrl } from "@/lib/image-url";
import { formatPrice } from "@/lib/format";

/** The bag: what's in it (quantities editable), what goes with it, the subtotal and delivery fee, then Checkout — or
 * Continue shopping, which simply closes it. Opened from the bag icon, the bottom nav and "View bag". */
export function CartDrawer() {
  const { isOpen, close } = useCartDrawerStore();
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  // Server quote — the only source of the money shown here.
  const { data: quote } = useCartQuote();
  const { data: suggestions } = useCartSuggestions(isOpen, 4);
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 5 * 60 * 1000, enabled: isOpen });
  const panelRef = useFocusTrap<HTMLDivElement>({ active: isOpen, onEscape: close });

  // Zustand's persisted cart hydrates after mount — avoid a flash of "empty bag" on first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!isOpen) return null;
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  const settings = settingsData?.settings;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={close}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your bag"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="ml-auto flex h-full w-full max-w-md flex-col bg-cream-50 shadow-floatLg animate-slide-in-right"
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 className="font-display text-lg text-ink-900">
            Your bag
            {mounted && count > 0 ? (
              <span className="ml-1.5 font-sans text-sm text-ink-500">
                ({count} item{count === 1 ? "" : "s"})
              </span>
            ) : null}
          </h2>
          <button onClick={close} aria-label="Close bag" className="rounded-full p-2 text-ink-500 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-900">
            <X size={20} />
          </button>
        </div>

        {!mounted ? null : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-ink-500">
              <ShoppingBag size={24} />
            </span>
            <p className="font-medium text-ink-900">Your bag is empty</p>
            <p className="text-sm text-ink-500">Add something you like and it will show up here.</p>
            <Button variant="outline" size="md" onClick={close} className="mt-2">
              Continue shopping
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5">
              <ul className="divide-y divide-ink-100">
                {items.map((item) => (
                  <li key={item.variantId} className="flex gap-3 py-4">
                    <Link href={`/product/${item.productSlug}`} onClick={close} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-ink-100">
                      {item.imageUrl && <Image src={resolveImageUrl(item.imageUrl)} alt={item.productName} fill sizes="80px" className="object-cover" />}
                    </Link>

                    <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/product/${item.productSlug}`} onClick={close} className="line-clamp-2 text-sm font-medium text-ink-900 hover:text-ink-700">
                            {item.productName}
                          </Link>
                          <p className="mt-0.5 text-xs text-ink-500">{formatVariantLabel(item.size, item.color)}</p>
                        </div>
                        <button
                          onClick={() => removeItem(item.variantId)}
                          className="-mr-2 -mt-1 shrink-0 rounded-full p-2 text-fg-muted transition-colors hover:bg-ink-50 hover:text-danger-600"
                          aria-label={`Remove ${item.productName} from bag`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center overflow-hidden rounded-full border border-ink-200">
                          <button
                            onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            className="flex h-9 w-9 items-center justify-center text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-200 disabled:hover:bg-transparent"
                            aria-label="Decrease quantity"
                            title={item.quantity <= 1 ? "Use the bin icon to remove this item" : undefined}
                          >
                            <Minus size={14} />
                          </button>
                          <span className="w-7 text-center text-sm tabular-nums" aria-live="polite">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.variantId, Math.min(item.maxStock, item.quantity + 1))}
                            disabled={item.quantity >= item.maxStock}
                            className="flex h-9 w-9 items-center justify-center text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-200 disabled:hover:bg-transparent"
                            aria-label="Increase quantity"
                            title={item.quantity >= item.maxStock ? "That's all we have in stock" : undefined}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <span className="text-sm font-medium tabular-nums text-ink-900">
                          {(() => {
                            const amount = quoteLineAmount(quote, item.variantId);
                            return amount === null ? "…" : formatPrice(amount);
                          })()}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {suggestions && suggestions.products.length > 0 && (
                <section aria-label="Complete your order" className="border-t border-ink-100 py-5" data-testid="drawer-suggestions">
                  <p className="text-xs ui-eyebrow text-fg-muted">{suggestions.bundleName ? `${suggestions.bundleName} bundle` : "Goes well with your bag"}</p>
                  <p className="mt-1 font-display text-base text-ink-900">Complete your order</p>
                  <ul className="mt-3 space-y-3">
                    {suggestions.products.map((product) => (
                      <SuggestionRow key={product.id} product={product} onNavigate={close} />
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <div className="border-t border-ink-100 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-600">Subtotal</span>
                <span className="text-lg font-medium tabular-nums text-ink-900">{quote ? formatPrice(quote.subtotal) : "…"}</span>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
                <Truck size={13} aria-hidden="true" className="shrink-0" />
                {settings
                  ? `Delivery ${formatPrice(settings.shippingFeeDhaka)} inside Dhaka, ${formatPrice(settings.shippingFeeOutsideDhaka)} elsewhere. Discounts apply at checkout.`
                  : "Delivery and any discount are added at checkout."}
              </p>

              <Link href="/checkout" onClick={close} className={buttonVariants({ variant: "primary", size: "lg", className: "mt-4 w-full" })}>
                Checkout{quote ? ` · ${formatPrice(quote.subtotal)}` : ""}
              </Link>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="outline" size="md" onClick={close}>
                  Continue shopping
                </Button>
                <Link href="/cart" onClick={close} className={buttonVariants({ variant: "ghost", size: "md" })}>
                  View full bag
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** One "Complete your order" product: added in one tap when it has a single option to buy, otherwise "Choose" opens its
 * page (where the size or colour is picked). */
function SuggestionRow({ product, onNavigate }: { product: Product; onNavigate: () => void }) {
  const availability = availabilityOf(product);
  const sellable = product.variants.filter((v) => availability.variants[v.id]?.sellable);
  const single = sellable.length === 1 ? sellable[0] : undefined;
  const image = product.images[0]?.url ?? null;
  const { addToCart } = useAddToCart({ selectedVariant: single, productId: product.id, productSlug: product.slug, productName: product.name, imageUrl: image, product });
  const shown = productDisplayPrice(product);

  return (
    <li className="flex items-center gap-3">
      <Link href={`/product/${product.slug}`} onClick={onNavigate} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-100">
        {image && <Image src={resolveImageUrl(image)} alt={product.name} fill sizes="56px" className="object-cover" />}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/product/${product.slug}`} onClick={onNavigate} className="line-clamp-2 text-sm leading-5 text-ink-900 hover:text-ink-700">
          {product.name}
        </Link>
        <p className="text-sm font-medium tabular-nums text-ink-900">{formatPrice(shown.price)}</p>
      </div>
      {single ? (
        <Button variant="outline" size="sm" onClick={() => addToCart(1)} aria-label={`Add ${product.name} to bag`}>
          <Plus size={14} aria-hidden="true" /> Add
        </Button>
      ) : (
        <Link href={`/product/${product.slug}`} onClick={onNavigate} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Choose
        </Link>
      )}
    </li>
  );
}
