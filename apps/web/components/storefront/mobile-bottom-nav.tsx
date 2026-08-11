"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Heart, ShoppingBag, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCartCount } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/account/wishlist", label: "Wishlist", icon: Heart },
  { href: "/cart", label: "Bag", icon: ShoppingBag },
  { href: "/account", label: "Account", icon: User },
] as const;

/** Online-only store, so a "store locations" tab has no destination — this replaces it with the
 * four things a mobile shopper actually needs one tap away. Desktop already has all of these
 * reachable from the header, so this bar is mobile-only. */
export function MobileBottomNav() {
  const pathname = usePathname();
  const count = useCartCount();
  const openCartDrawer = useCartDrawerStore((s) => s.open);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <nav
      className="glass fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Primary"
    >
      <div className="grid h-16 grid-cols-4">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const badge = href === "/cart" && mounted && count > 0 && (
            <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass-400 px-1 text-[10px] font-medium text-ink-900 shadow-sm">
              {count}
            </span>
          );
          const itemClassName = cn(
            "flex flex-col items-center justify-center gap-1 text-[11px] transition-colors duration-150 ease-smooth",
            active ? "text-ink-900" : "text-ink-500 hover:text-ink-700",
          );

          // The Bag tab opens the cart drawer in place, rather than navigating — same behavior as
          // the header's cart icon, so shoppers get one consistent way to review their selection.
          if (href === "/cart") {
            return (
              <button
                key={href}
                type="button"
                onClick={openCartDrawer}
                aria-label={label}
                className={itemClassName}
              >
                <span className="relative">
                  <Icon size={21} strokeWidth={active ? 2.25 : 1.75} />
                  {badge}
                </span>
                {label}
              </button>
            );
          }

          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={itemClassName}
            >
              <span className="relative">
                <Icon size={21} strokeWidth={active ? 2.25 : 1.75} />
                {badge}
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
