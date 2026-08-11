"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { useCartStore, useCartCount, useCartSubtotal } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { formatPrice } from "@/lib/format";

const HIDDEN_ON = ["/cart", "/checkout", "/product"];

/** Persistent quick-checkout access, distinct from CartReminderBanner (which only nudges after
 * inactivity) — this shows any time the cart has items, so "go pay" is always one tap away.
 * Hidden on PDPs, where StickyAddToCart takes over the same bottom-bar slot with an action for
 * the item actually being viewed rather than a generic "view cart" link. */
export function StickyCartBar() {
  const pathname = usePathname();
  const items = useCartStore((s) => s.items);
  const count = useCartCount();
  const subtotal = useCartSubtotal();
  const openCartDrawer = useCartDrawerStore((s) => s.open);
  // Cart persists to localStorage and hydrates client-side after mount — avoids a flash where
  // the bar briefly shows/hides before the real cart state loads.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || items.length === 0) return null;
  if (HIDDEN_ON.some((path) => pathname.startsWith(path))) return null;

  return (
    <div className="glass fixed inset-x-0 bottom-16 z-40 border-t border-ink-200 shadow-floatLg animate-fade-in lg:bottom-0">
      <button
        type="button"
        onClick={openCartDrawer}
        className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-smooth hover:bg-ink-50/50 sm:px-6 lg:px-8"
      >
        <div className="relative shrink-0 text-ink-900">
          <ShoppingBag size={20} />
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass-400 px-1 text-[10px] font-medium text-ink-900">
            {count}
          </span>
        </div>
        <p className="flex-1 text-sm text-ink-700">
          {count} item{count === 1 ? "" : "s"} · <span className="font-medium text-ink-900">{formatPrice(subtotal)}</span>
        </p>
        <span className="glossy shrink-0 rounded-full bg-ink-900 px-4 py-2 text-xs uppercase tracking-wide text-cream-50">
          View Cart
        </span>
      </button>
    </div>
  );
}
