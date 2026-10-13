"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useCartStore } from "@/store/cart";

/** Routes where StickyCartBar never shows — /cart and /checkout already show the cart inline, and
 * /product hands the same bottom-bar slot to StickyAddToCart instead. */
export const CART_BAR_HIDDEN_ROUTES = ["/cart", "/checkout", "/product"];

interface BottomDockState {
  /** Is StickyCartBar actually showing right now (mounted, cart non-empty, not on a hidden route). */
  showCartBar: boolean;
  /** On a PDP — StickyAddToCart may occupy the same bottom-bar slot instead (its own visibility is
   * scroll-driven inside ProductShowcase, not derivable from route alone). */
  onProductPage: boolean;
  /** On /cart or /checkout — the cart is already on-screen, so nothing needs to reserve space to
   * reach it. */
  onCartOrCheckoutPage: boolean;
  /** On /checkout — a focused page without the bottom nav or the contact button. */
  onCheckoutPage: boolean;
  /** Is StickyCartBar showing below 1024px too. Not where the theme has the bottom tab bar (`--dock-tab-bar` above 0):
   * its Bag tab already carries the count one tap away, and a second bar stacked over it only took screen from the
   * products. Where there is no tab bar (the mihrab preset) the phone keeps the bar. */
  showCartBarOnPhone: boolean;
}

/** Single source of truth for "what's currently docked at the bottom of the viewport." Previously
 * StickyCartBar, StickyBottomBarSpacer, and ContactWidget each independently recomputed this from
 * their own route-prefix checks and cart state — two of them had their own copy of the same
 * hidden-route array that had to be hand-kept in sync, and it was the easiest place in the
 * storefront for a future bottom-fixed element to introduce a visual overlap. */
export function useBottomDockState(): BottomDockState {
  const pathname = usePathname() ?? "";
  const items = useCartStore((s) => s.items);
  // Cart persists to localStorage and hydrates client-side after mount — avoids a flash where
  // bottom-docked elements briefly show/hide before the real cart state loads.
  const [mounted, setMounted] = useState(false);
  const [hasTabBar, setHasTabBar] = useState(true);
  useEffect(() => {
    setMounted(true);
    setHasTabBar(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dock-tab-bar")) > 0);
  }, []);

  const onProductPage = pathname.startsWith("/product");
  const onCartOrCheckoutPage = pathname.startsWith("/cart") || pathname.startsWith("/checkout");
  const showCartBar = mounted && items.length > 0 && !CART_BAR_HIDDEN_ROUTES.some((route) => pathname.startsWith(route));

  // Checkout is a focused page: no bottom nav and no contact button over the form.
  const onCheckoutPage = pathname.startsWith("/checkout");

  return { showCartBar, onProductPage, onCartOrCheckoutPage, onCheckoutPage, showCartBarOnPhone: showCartBar && !hasTabBar };
}
