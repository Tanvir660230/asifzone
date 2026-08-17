"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductVariant } from "@clothing-brand/shared";
import { useCartStore } from "@/store/cart";
import { useExpressCheckoutStore } from "@/store/express-checkout";
import { pixelAddToCart } from "@/lib/meta-pixel";

interface UseAddToCartParams {
  selectedVariant: ProductVariant | undefined;
  productId: string;
  productSlug: string;
  productName: string;
  imageUrl: string | null;
  basePrice: string;
}

/** Shared "add this variant to the cart" / "buy it now" logic — used by both the inline PDP buttons
 * (VariantSelector) and the mobile sticky bar (StickyAddToCart), so there's one place that knows how
 * to turn a selected variant into a cart line item instead of two copies drifting apart. */
export function useAddToCart({ selectedVariant, productId, productSlug, productName, imageUrl, basePrice }: UseAddToCartParams) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const setExpressItem = useExpressCheckoutStore((s) => s.setItem);
  const [justAdded, setJustAdded] = useState(false);

  function buildCartItem() {
    if (!selectedVariant) return null;
    return {
      variantId: selectedVariant.id,
      productId,
      productSlug,
      productName,
      sku: selectedVariant.sku,
      size: selectedVariant.size,
      color: selectedVariant.color,
      price: Number(selectedVariant.price ?? basePrice),
      imageUrl,
      maxStock: selectedVariant.stock,
    };
  }

  function addToCart(quantity: number) {
    const item = buildCartItem();
    if (!item) return;
    addItem(item, quantity);
    pixelAddToCart({ contentId: item.productId, contentName: productName, value: item.price, quantity });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2500);
  }

  function buyNow(quantity: number) {
    const item = buildCartItem();
    if (!item) return;
    setExpressItem({ ...item, quantity });
    pixelAddToCart({ contentId: item.productId, contentName: productName, value: item.price, quantity });
    router.push("/checkout");
  }

  return { addToCart, buyNow, justAdded };
}
