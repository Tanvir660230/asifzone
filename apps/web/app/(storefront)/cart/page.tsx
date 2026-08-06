"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Trash2, Heart, Gift } from "lucide-react";
import type { BundleCartPreview, Product } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { useCartStore, useCartSubtotal } from "@/store/cart";
import { useExpressCheckoutStore } from "@/store/express-checkout";
import { env } from "@/lib/env";
import { formatPrice } from "@/lib/format";
import { useOptionalCustomer } from "@/hooks/use-current-customer";
import { addToWishlist } from "@/lib/api/wishlist";
import { fetchProductsByIds, getSimilarProducts } from "@/lib/api/storefront";
import { previewBundle } from "@/lib/api/bundles";

export default function CartPage() {
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const subtotal = useCartSubtotal();
  const { data: customerData } = useOptionalCustomer();
  const isLoggedIn = Boolean(customerData?.customer);

  const [alternatives, setAlternatives] = useState<Record<string, Product[]>>({});
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [bundlePreview, setBundlePreview] = useState<BundleCartPreview | null>(null);

  // Zustand's persisted state hydrates after mount — render nothing cart-specific until then to avoid a flash of "empty cart".
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Landing on the full cart page means the shopper wants to check out everything in it, not
  // whatever single item a previous "Buy Now" click staged — discard any leftover express item so
  // it can't silently hijack this checkout later (see checkout/page.tsx for the other half of this).
  const clearExpressItem = useExpressCheckoutStore((s) => s.clear);
  useEffect(() => clearExpressItem(), [clearExpressItem]);

  // Real-time check: is any cart line now low/out of stock? If so, surface real alternatives
  // for it, rather than trusting the stale `maxStock` captured at add-to-cart time.
  useEffect(() => {
    if (!mounted || items.length === 0) return;
    const productIds = [...new Set(items.map((i) => i.productId))];

    fetchProductsByIds(productIds)
      .then(async ({ items: liveProducts }) => {
        const byId = new Map(liveProducts.map((p) => [p.id, p]));
        const results: Record<string, Product[]> = {};

        await Promise.all(
          items.map(async (item) => {
            const liveProduct = byId.get(item.productId);
            const liveVariant = liveProduct?.variants.find((v) => v.id === item.variantId);
            const isLowStock =
              !liveProduct || !liveVariant || liveVariant.stock === 0 || liveVariant.stock <= liveProduct.lowStockThreshold;
            if (!isLowStock) return;

            const { items: similar } = await getSimilarProducts(item.productId);
            if (similar.length > 0) results[item.productId] = similar.slice(0, 2);
          }),
        );

        setAlternatives(results);
      })
      .catch(() => setAlternatives({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, items.length]);

  // Checks the cart against every active cross-sell bundle: shows a savings banner once the anchor
  // (e.g. a Panjabi) plus enough matching categories are in the cart, or a nudge naming what's missing.
  useEffect(() => {
    if (!mounted || items.length === 0) {
      setBundlePreview(null);
      return;
    }
    previewBundle(items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })))
      .then(setBundlePreview)
      .catch(() => setBundlePreview(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, items.length]);

  async function handleSaveForLater(productId: string, variantId: string) {
    setSavingProductId(productId);
    try {
      await addToWishlist(productId);
      removeItem(variantId);
    } finally {
      setSavingProductId(null);
    }
  }

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

      {bundlePreview?.eligible && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-brass-300 bg-brass-50 p-4 text-sm text-ink-800">
          <Gift size={18} className="mt-0.5 shrink-0 text-brass-500" />
          <p>
            <span className="font-medium">{bundlePreview.eligible.bundle.name} unlocked</span> — save{" "}
            {formatPrice(bundlePreview.eligible.discount)} at checkout.
          </p>
        </div>
      )}
      {!bundlePreview?.eligible && bundlePreview?.nearMiss && (
        <div className="mb-6 rounded-lg border border-ink-200 bg-cream-50 p-4 text-sm text-ink-700">
          <p className="flex items-start gap-3">
            <Gift size={18} className="mt-0.5 shrink-0 text-ink-400" />
            <span>
              Add one of these to unlock <span className="font-medium">{bundlePreview.nearMiss.bundle.name}</span>{" "}
              savings:
            </span>
          </p>
          <div className="ml-[30px] mt-2 flex flex-wrap gap-2">
            {bundlePreview.nearMiss.missingCategories.map((c) => (
              <Link
                key={c.id}
                href={`/category/${c.slug}`}
                className="rounded-full border border-ink-200 px-3 py-1 text-xs text-ink-700 transition-colors duration-150 ease-smooth hover:border-brass-400"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="divide-y divide-ink-100 border-y border-ink-100">
        {items.map((item) => (
          <div key={item.variantId} className="py-5">
            <div className="flex gap-4">
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
                {isLoggedIn && (
                  <button
                    onClick={() => handleSaveForLater(item.productId, item.variantId)}
                    disabled={savingProductId === item.productId}
                    className="mt-2 flex w-fit items-center gap-1.5 text-xs text-ink-400 transition-colors duration-150 ease-smooth hover:text-brass-600 disabled:opacity-50"
                  >
                    <Heart size={12} />
                    Save for later
                  </button>
                )}
              </div>

              <button
                onClick={() => removeItem(item.variantId)}
                className="self-start text-ink-300 hover:text-red-700"
                aria-label="Remove item"
              >
                <Trash2 size={16} />
              </button>
            </div>

            {alternatives[item.productId] && (
              <div className="ml-24 mt-3 border-l-2 border-brass-200 pl-4">
                <p className="text-xs text-ink-500">Running low — you might also like:</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {alternatives[item.productId]!.map((alt) => (
                    <Link
                      key={alt.id}
                      href={`/product/${alt.slug}`}
                      className="flex items-center gap-2 rounded-full border border-ink-200 py-1 pl-1 pr-3 text-xs text-ink-700 transition-colors duration-150 ease-smooth hover:border-brass-400"
                    >
                      {alt.images[0] && (
                        <span className="relative h-6 w-6 overflow-hidden rounded-full bg-ink-100">
                          <Image src={`${env.apiUrl}${alt.images[0].url}`} alt={alt.name} fill sizes="24px" className="object-cover" />
                        </span>
                      )}
                      {alt.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
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
