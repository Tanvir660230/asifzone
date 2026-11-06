"use client";

import { ShoppingBag } from "lucide-react";
import { useCartCount } from "@/store/cart";
import { useCartQuote } from "@/hooks/use-quote";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { useBottomDockState } from "@/hooks/use-bottom-dock";
import { Money } from "@/components/ui/money";
import { cn } from "@/lib/utils";
import { storeLayout } from "@/lib/theme-layout";
import { CountBadge } from "./count-badge";

/** Persistent quick-checkout access, distinct from CartReminderBanner (which only nudges after
 * inactivity) — this shows any time the cart has items, so "go pay" is always one tap away.
 * Hidden on PDPs, where StickyAddToCart takes over the same bottom-bar slot with an action for
 * the item actually being viewed rather than a generic "view cart" link. */
export function StickyCartBar() {
  const { showCartBar, showCartBarOnPhone } = useBottomDockState();
  const count = useCartCount();
  const { data: quote } = useCartQuote();
  const openCartDrawer = useCartDrawerStore((s) => s.open);

  if (!showCartBar) return null;

  // The honey preset: a small dark bar floating just above the tab bar, on phones only (the header shows the total on wide
  // screens). It is the shopper's running total while they add from the cards.
  if (storeLayout() === "honey") {
    return (
      <button
        type="button"
        data-hide-on-keyboard
        onClick={openCartDrawer}
        className="fixed inset-x-3 bottom-[calc(var(--dock-offset)+0.5rem)] z-40 flex h-12 animate-fade-in items-center gap-2.5 rounded-[var(--control-radius)] bg-ink-900 px-4 text-sm text-cream-50 shadow-floatLg lg:hidden"
      >
        <span>
          {count} item{count === 1 ? "" : "s"}
        </span>
        <span className="font-bold tabular-nums">{quote ? <Money value={quote.subtotal} /> : null}</span>
        <span className="ml-auto font-semibold text-[color:var(--bag-bar-action)]">View bag</span>
      </button>
    );
  }

  return (
    <div data-hide-on-keyboard className={cn("glass fixed inset-x-0 bottom-[var(--dock-offset)] z-40 border-t border-ink-200 shadow-floatLg animate-fade-in lg:bottom-0", !showCartBarOnPhone && "max-lg:hidden")}>
      <button
        type="button"
        onClick={openCartDrawer}
        className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-smooth hover:bg-ink-50/50 sm:px-6 lg:px-8"
      >
        <div className="relative shrink-0 text-ink-900">
          <ShoppingBag size={20} />
          <CountBadge count={count} className="-right-2 -top-2" />
        </div>
        <p className="flex-1 text-sm text-ink-700">
          {count} item{count === 1 ? "" : "s"} · <span className="font-medium text-ink-900">{quote ? <Money value={quote.subtotal} /> : "…"}</span>
        </p>
        <span className="glossy shrink-0 rounded-[var(--control-radius)] bg-ink-900 px-4 py-2 text-xs ui-caps text-cream-50">
          View bag
        </span>
      </button>
    </div>
  );
}
