"use client";

import type { ProductVariant } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/format";
import { useAddToCart } from "@/hooks/use-add-to-cart";

interface StickyAddToCartProps {
  visible: boolean;
  selectedVariant: ProductVariant | undefined;
  productId: string;
  productSlug: string;
  productName: string;
  imageUrl: string | null;
  basePrice: string;
  price: string;
  /** Called when tapped with no variant selected yet, so the page can scroll up to the size/color
   * picker and highlight what's still missing, instead of the button just doing nothing. */
  onRequireSelection?: () => void;
}

/** Mobile-only PDP action bar — appears once the inline Add to Cart/Buy Now buttons in
 * VariantSelector have scrolled out of view (driven by an IntersectionObserver in ProductShowcase),
 * so there's never more than one "add to cart" affordance on screen at a time. Always adds/buys a
 * single unit — it's a quick-action shortcut, not a replacement for the full selector above. */
export function StickyAddToCart({
  visible,
  selectedVariant,
  productId,
  productSlug,
  productName,
  imageUrl,
  basePrice,
  price,
  onRequireSelection,
}: StickyAddToCartProps) {
  const { addToCart, buyNow } = useAddToCart({ selectedVariant, productId, productSlug, productName, imageUrl, basePrice });

  if (!visible) return null;

  // Genuinely out of stock is a hard stop; a not-yet-finished selection isn't — tapping it instead
  // scrolls up to the size/color picker so the shopper can see what's still needed.
  const outOfStock = !!selectedVariant && selectedVariant.stock === 0;

  function handleAddToCart() {
    if (!selectedVariant) return onRequireSelection?.();
    addToCart(1);
  }

  function handleBuyNow() {
    if (!selectedVariant) return onRequireSelection?.();
    buyNow(1);
  }

  return (
    <div className="glass fixed inset-x-0 bottom-16 z-40 animate-fade-in border-t border-ink-200 shadow-floatLg lg:hidden">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        <p className="shrink-0 text-sm font-semibold text-ink-900">{formatPrice(price)}</p>
        <div className="flex flex-1 gap-2">
          <Button variant="outline" size="lg" className="flex-1" disabled={outOfStock} onClick={handleAddToCart}>
            Add to Cart
          </Button>
          <Button variant="primary" size="lg" className="flex-1" disabled={outOfStock} onClick={handleBuyNow}>
            Buy Now
          </Button>
        </div>
      </div>
    </div>
  );
}
