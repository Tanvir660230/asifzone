"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCartCount } from "@/store/cart";

export function CartIcon() {
  const count = useCartCount();
  // Avoids a hydration mismatch: the persisted cart count is only known client-side after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Link
      href="/cart"
      aria-label="Cart"
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-700 transition-all duration-200 ease-smooth hover:bg-ink-100 hover:text-brass-500"
    >
      <ShoppingBag size={19} />
      {mounted && count > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 animate-modal-in items-center justify-center rounded-full bg-brass-400 px-1 text-[10px] font-medium text-ink-900 shadow-sm">
          {count}
        </span>
      )}
    </Link>
  );
}
