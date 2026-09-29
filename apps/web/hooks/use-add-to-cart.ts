"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { maxSellableQuantity, type Product, type ProductVariant } from "@clothing-brand/shared";
import { useCartStore } from "@/store/cart";
import { useExpressCheckoutStore } from "@/store/express-checkout";
import { pixelAddToCart } from "@/lib/meta-pixel";
import { trackFunnelEvent } from "@/lib/analytics";
import { variantDisplayPrice } from "@/lib/pricing-display";

interface UseAddToCartParams {
  selectedVariant: ProductVariant | undefined;
  productId: string;
  productSlug: string;
  productName: string;
  imageUrl: string | null;
  /** The product's server-resolved prices and stored prices — the cart line's price is a display cache of the server
   * price only; every total is re-quoted by the server (PRICING_INVARIANTS §7). */
  product: Pick<Product, "pricing" | "basePrice" | "compareAtPrice" | "trackInventory">;
}

/** Shared "add this variant to the cart" / "buy it now" logic — used by both the inline PDP buttons
 * (VariantSelector) and the mobile sticky bar (StickyAddToCart), so there's one place that knows how
 * to turn a selected variant into a cart line item instead of two copies drifting apart. */
export function useAddToCart({ selectedVariant, productId, productSlug, productName, imageUrl, product }: UseAddToCartParams) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const setExpressItem = useExpressCheckoutStore((s) => s.setItem);
  const [justAdded, setJustAdded] = useState(false);

  // `variant` overrides the hook's selectedVariant — the options popup acts on the variant just chosen in it, before
  // that choice has flowed back into the page's state.
  function buildCartItem(variant: ProductVariant | undefined = selectedVariant) {
    if (!variant) return null;
    return {
      variantId: variant.id,
      productId,
      productSlug,
      productName,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      price: Number(variantDisplayPrice(product, variant.id).price),
      imageUrl,
      // D5: an untracked product has no stock ceiling (only the per-line maximum).
      maxStock: maxSellableQuantity(product.trackInventory, variant.stock),
    };
  }

  function addToCart(quantity: number, variant?: ProductVariant) {
    const item = buildCartItem(variant);
    if (!item) return;
    // The Meta AddToCart event fires inside addItem itself, with the quantity the cart actually gained.
    addItem(item, quantity);
    trackFunnelEvent("ADD_TO_CART", { productId: item.productId, variantId: item.variantId });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2500);
  }

  function buyNow(quantity: number, variant?: ProductVariant) {
    const item = buildCartItem(variant);
    if (!item) return;
    setExpressItem({ ...item, quantity });
    pixelAddToCart({ id: item.variantId, quantity, price: item.price }, productName);
    // Buy Now skips the cart drawer but still puts the item into the checkout flow, so it counts
    // the same as an explicit Add to Cart for funnel purposes.
    trackFunnelEvent("ADD_TO_CART", { productId: item.productId, variantId: item.variantId });
    router.push("/checkout");
  }

  return { addToCart, buyNow, justAdded };
}
