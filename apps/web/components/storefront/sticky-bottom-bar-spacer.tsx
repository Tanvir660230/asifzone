"use client";

import { useBottomDockState } from "@/hooks/use-bottom-dock";
import { cn } from "@/lib/utils";

/** MobileBottomNav and StickyCartBar are both `fixed` at the bottom of the viewport, so they're
 * out of normal document flow and would otherwise sit on top of the footer's last section. This
 * reserves the matching space in flow, right after the footer, so nothing gets covered.
 *
 * Shares StickyCartBar's own visibility state via useBottomDockState (it's the one whose height
 * varies): the nav bar alone needs one row of space on mobile, and when the cart bar is also
 * showing — stacked above the nav on mobile, or alone at the bottom on desktop — that's another
 * row. StickyAddToCart (the PDP equivalent of the cart bar) is scroll-driven and local to the
 * product page rather than pathname/cart-state driven, so its space is reserved conservatively
 * whenever on a product page instead of trying to mirror its exact toggle here. */
export function StickyBottomBarSpacer() {
  const { showCartBar, onProductPage } = useBottomDockState();

  return <div aria-hidden className={cn(showCartBar || onProductPage ? "h-32" : "h-16", showCartBar ? "lg:h-16" : "lg:h-0")} />;
}
