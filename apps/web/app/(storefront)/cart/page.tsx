"use client";

import { formatVariantLabel } from "@clothing-brand/shared";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Trash2, Heart, Gift, ShoppingBag } from "lucide-react";
import type { BundleCartPreview, Product } from "@clothing-brand/shared";
import { buttonVariants } from "@/components/ui/button";
import { StorefrontPage, StorefrontPageHeader } from "@/components/storefront/storefront-page";
import { ProductCarousel } from "@/components/storefront/product-carousel";
import { RecentlyViewedCarousel } from "@/components/storefront/recently-viewed-carousel";
import { useCartStore } from "@/store/cart";
import { useCartQuote, quoteLineAmount } from "@/hooks/use-quote";
import { useExpressCheckoutStore } from "@/store/express-checkout";
import { resolveImageUrl } from "@/lib/image-url";
import { formatPrice } from "@/lib/format";
import { variantAvailabilityOf } from "@/lib/availability-display";
import { useCartSuggestions } from "@/hooks/use-cart-suggestions";
import { useOptionalCustomer } from "@/hooks/use-current-customer";
import { addToWishlist } from "@/lib/api/wishlist";
import { fetchProductsByIds, fetchTrendingProducts, getSimilarProducts } from "@/lib/api/storefront";
import { previewBundle } from "@/lib/api/bundles";

export default function CartPage() {
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  // Server quote — the only source of the money shown here.
  const { data: quote } = useCartQuote();
  const { data: customerData } = useOptionalCustomer();
  const isLoggedIn = Boolean(customerData?.customer);

  const [alternatives, setAlternatives] = useState<Record<string, Product[]>>({});
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [bundlePreview, setBundlePreview] = useState<BundleCartPreview | null>(null);
  const [trending, setTrending] = useState<Product[]>([]);

  // Only needed for the empty-cart state, but cheap enough (and rare enough a page) not to gate
  // behind `items.length === 0` — avoids a flash of "no suggestions yet" right as the cart empties.
  useEffect(() => {
    fetchTrendingProducts({ limit: 8 })
      .then(({ items }) => setTrending(items))
      .catch(() => setTrending([]));
  }, []);

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
            // Server-derived stock state (D5: an untracked product is never low or out of stock).
            const state = liveProduct ? variantAvailabilityOf(liveProduct, item.variantId)?.state : undefined;
            const isLowStock = !state || state === "OUT_OF_STOCK" || state === "LOW_STOCK";
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

  const { data: suggestions } = useCartSuggestions(mounted);
  const completeOrder = suggestions ?? { products: [] as Product[], bundleName: null };

  async function handleSaveForLater(productId: string, variantId: string) {
    setSavingProductId(productId);
    try {
      await addToWishlist(productId);
      removeItem(variantId);
    } finally {
      setSavingProductId(null);
    }
  }

  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  if (!mounted) {
    return (
      <StorefrontPage>
        <StorefrontPageHeader breadcrumb={[{ name: "Bag" }]} title="Your bag" />
      </StorefrontPage>
    );
  }

  if (items.length === 0) {
    return (
      <StorefrontPage>
        <StorefrontPageHeader breadcrumb={[{ name: "Bag" }]} title="Your bag" description="It's empty for now. Everything you add shows up here." />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/" className={buttonVariants({ variant: "primary", size: "lg" })}>
            <ShoppingBag size={18} aria-hidden="true" /> Continue shopping
          </Link>
          <Link href="/wishlist" className={buttonVariants({ variant: "outline", size: "lg" })}>
            View your wishlist
          </Link>
        </div>

        <div className="-mx-4 mt-8 sm:-mx-6 lg:-mx-8">
          <RecentlyViewedCarousel />
          <ProductCarousel eyebrow="Popular right now" title="Trending products" products={trending} />
        </div>
      </StorefrontPage>
    );
  }

  return (
    <StorefrontPage>
      <StorefrontPageHeader breadcrumb={[{ name: "Bag" }]} title="Your bag" description={`${count} item${count === 1 ? "" : "s"}`} />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
        <div className="min-w-0">
          {bundlePreview?.eligible && (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-sale-500/30 bg-sale-50 p-4 text-sm text-ink-800">
              <Gift size={18} className="mt-0.5 shrink-0 text-sale-500" />
              <p>
                <span className="font-medium">{bundlePreview.eligible.bundle.name} unlocked</span> — save {formatPrice(bundlePreview.eligible.discount)} at
                checkout.
              </p>
            </div>
          )}
          {!bundlePreview?.eligible && bundlePreview?.nearMiss && (
            <div className="mb-6 rounded-lg border border-ink-200 bg-cream-50 p-4 text-sm text-ink-700">
              <p className="flex items-start gap-3">
                <Gift size={18} className="mt-0.5 shrink-0 text-ink-400" />
                <span>
                  Add one of these to unlock <span className="font-medium">{bundlePreview.nearMiss.bundle.name}</span> savings:
                </span>
              </p>
              <div className="ml-[30px] mt-2 flex flex-wrap gap-2">
                {bundlePreview.nearMiss.missingCategories.map((c) => (
                  <Link
                    key={c.id}
                    href={`/category/${c.slug}`}
                    className="rounded-[var(--chip-radius)] border border-ink-200 px-3 py-1 text-xs text-ink-700 transition-colors duration-150 ease-smooth hover:border-brass-400"
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
                  <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-[var(--line-item-radius)] bg-ink-100">
                    {item.imageUrl && <Image src={resolveImageUrl(item.imageUrl)} alt={item.productName} fill sizes="80px" className="object-cover" />}
                  </div>

                  <div className="flex flex-1 flex-col justify-between">
                    <div>
                      <Link href={`/product/${item.productSlug}`} className="text-sm text-ink-900 hover:text-brass-500">
                        {item.productName}
                      </Link>
                      <p className="mt-1 text-xs text-ink-400">{[formatVariantLabel(item.size, item.color), `SKU ${item.sku}`].filter(Boolean).join(" · ")}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center overflow-hidden rounded-[var(--stepper-radius)] border border-ink-200">
                        <button
                          onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                          className="h-10 w-10 text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-200 disabled:hover:bg-transparent"
                          aria-label="Decrease quantity"
                          title={item.quantity <= 1 ? "Use the trash icon to remove this item" : undefined}
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-sm">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.variantId, Math.min(item.maxStock, item.quantity + 1))}
                          className="h-10 w-10 text-ink-700 hover:bg-ink-50"
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-sm text-ink-900">
                        {(() => {
                          const amount = quoteLineAmount(quote, item.variantId);
                          return amount === null ? "…" : formatPrice(amount);
                        })()}
                      </span>
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
                    // Negative margin cancels the padding's footprint in the row layout, so the icon
                    // stays visually in place while the actual tappable box grows to ~40px (this app's
                    // baseline touch target, see Button's "md" size) instead of the bare 16px glyph.
                    className="-m-3 shrink-0 self-start p-3 text-fg-muted hover:text-danger-600"
                    aria-label={`Remove ${item.productName} from cart`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {alternatives[item.productId] && (
                  <div className="ml-24 mt-3 border-l-2 border-brass-200 pl-4">
                    <p className="text-xs text-ink-500">Few left — similar styles:</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {alternatives[item.productId]!.map((alt) => (
                        <Link
                          key={alt.id}
                          href={`/product/${alt.slug}`}
                          className="flex items-center gap-2 rounded-[var(--chip-radius)] border border-ink-200 py-1 pl-1 pr-3 text-xs text-ink-700 transition-colors duration-150 ease-smooth hover:border-brass-400"
                        >
                          {alt.images[0] && (
                            <span className="relative h-6 w-6 overflow-hidden rounded-full bg-ink-100">
                              <Image src={resolveImageUrl(alt.images[0].url)} alt={alt.name} fill sizes="24px" className="object-cover" />
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
        </div>

        <aside
          aria-label="Order summary"
          className="rounded-2xl bg-surface p-5 ring-1 ring-inset ring-line-subtle lg:sticky lg:top-[calc(var(--sticky-top)+1.5rem)]"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-600">Subtotal</span>
            <span className="text-lg font-medium tabular-nums text-ink-900">{quote ? formatPrice(quote.subtotal) : "…"}</span>
          </div>
          <p className="mt-1 text-xs text-ink-500">Delivery and any discount are added at checkout.</p>
          <Link href="/checkout" className={buttonVariants({ variant: "primary", size: "lg", className: "mt-5 w-full" })}>
            Checkout
          </Link>
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "md", className: "mt-2 w-full" })}>
            Continue shopping
          </Link>
        </aside>
      </div>

      {completeOrder.products.length > 0 && (
        <div className="-mx-4 mt-12 sm:-mx-6 lg:-mx-8" data-testid="complete-order">
          <ProductCarousel
            eyebrow={completeOrder.bundleName ? `${completeOrder.bundleName} bundle` : "Goes well with your bag"}
            title="Complete your order"
            products={completeOrder.products}
          />
        </div>
      )}
    </StorefrontPage>
  );
}
