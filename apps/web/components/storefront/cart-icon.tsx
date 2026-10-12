"use client";

import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { useCartCount } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { CountBadge, bagLabel } from "./count-badge";

export function CartIcon() {
  const count = useCartCount();
  const openDrawer = useCartDrawerStore((s) => s.open);
  // Avoids a hydration mismatch: the persisted cart count is only known client-side after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <button
      type="button"
      onClick={openDrawer}
      aria-label={bagLabel("Open cart", mounted ? count : 0)}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-700 transition-all duration-200 ease-smooth hover:bg-ink-100 hover:text-brass-500"
    >
      <ShoppingBag size={19} />
      {mounted && count > 0 && <CountBadge count={count} className="right-0.5 top-0.5" />}
    </button>
  );
}
