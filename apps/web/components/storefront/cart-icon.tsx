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
    <Link href="/cart" aria-label="Cart" className="relative text-ink-700 hover:text-brass-500">
      <ShoppingBag size={20} />
      {mounted && count > 0 && (
        <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass-400 px-1 text-[10px] font-medium text-ink-900">
          {count}
        </span>
      )}
    </Link>
  );
}
