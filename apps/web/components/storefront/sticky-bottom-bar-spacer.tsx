"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useCartStore } from "@/store/cart";
import { cn } from "@/lib/utils";

const CART_BAR_HIDDEN_ON = ["/cart", "/checkout", "/product"];

/** MobileBottomNav and StickyCartBar are both `fixed` at the bottom of the viewport, so they're
 * out of normal document flow and would otherwise sit on top of the footer's last section. This
 * reserves the matching space in flow, right after the footer, so nothing gets covered.
 *
 * Mirrors StickyCartBar's own mount/pathname/cart-emptiness checks (it's the one whose height
 * varies): the nav bar alone needs one row of space on mobile, and when the cart bar is also
 * showing — stacked above the nav on mobile, or alone at the bottom on desktop — that's another
 * row. StickyAddToCart (the PDP equivalent of the cart bar) is scroll-driven and local to the
 * product page rather than pathname/cart-state driven, so its space is reserved conservatively
 * whenever on a product page instead of trying to mirror its exact toggle here. */
export function StickyBottomBarSpacer() {
  const pathname = usePathname();
  const items = useCartStore((s) => s.items);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const showCartBar = mounted && items.length > 0 && !CART_BAR_HIDDEN_ON.some((path) => pathname.startsWith(path));
  const isProductPage = pathname.startsWith("/product");

  return <div aria-hidden className={cn(showCartBar || isProductPage ? "h-32" : "h-16", showCartBar ? "lg:h-16" : "lg:h-0")} />;
}
