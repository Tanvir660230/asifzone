"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Heart, LayoutGrid, ShoppingBag, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyboardFlag } from "@/hooks/use-keyboard-flag";
import { useCartCount } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { useMobileMenuStore } from "@/store/mobile-menu";
import { useSearchOverlayStore } from "@/store/search-overlay";
import { closeStorefrontPanels } from "@/store/panels";
import { markNavigation } from "@/lib/nav-direction";
import { CountBadge, bagLabel } from "./count-badge";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/category", label: "Shop", icon: LayoutGrid },
  { href: "/wishlist", label: "Wishlist", icon: Heart },
  { href: "/cart", label: "Bag", icon: ShoppingBag },
  { href: "/account", label: "Account", icon: User },
] as const;

/** Online-only store, so a "store locations" tab has no destination — this replaces it with the
 * five things a mobile shopper actually needs one tap away. Shop opens the category menu (the same drawer as the
 * header's menu button), so browsing another category never needs a scroll back to the top. Desktop already has all of
 * these reachable from the header, so this bar is mobile-only.
 *
 * Like an app's tab bar it stays in view while the menu, bag, search or filters panel is open (they stop at its top edge,
 * `--dock-offset` in globals.css): the open panel's tab shows as active, tapping it again closes the panel, and tapping
 * any other tab closes it and goes there. */
export function MobileBottomNav() {
  const pathname = usePathname();
  const count = useCartCount();
  const bagOpen = useCartDrawerStore((s) => s.isOpen);
  const openCartDrawer = useCartDrawerStore((s) => s.open);
  const menuOpen = useMobileMenuStore((s) => s.isOpen);
  const openMenu = useMobileMenuStore((s) => s.open);
  const searchOpen = useSearchOverlayStore((s) => s.isOpen);
  const panelOpen = bagOpen || menuOpen || searchOpen;
  // Mounted once per storefront page (this bar is in the shell): fixed bottom bars step aside while the on-screen
  // keyboard is open, so a checkout field being typed into isn't hidden behind them.
  useKeyboardFlag();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Checkout is a focused page: nothing over the form but the form.
  if (pathname.startsWith("/checkout")) return null;

  return (
    <nav
      data-tab-bar
      data-app-chrome
      data-hide-on-keyboard
      className="fixed inset-x-0 bottom-0 z-dock border-t border-line-subtle bg-surface/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 [border-top-width:0.5px] lg:hidden"
      aria-label="Primary"
    >
      <div className="grid h-[var(--dock-tab-bar)] grid-cols-5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          // While a panel is open its own tab is the active one; otherwise the tab for the current page.
          const active = panelOpen
            ? (href === "/category" && menuOpen) || (href === "/cart" && bagOpen)
            : href === "/"
              ? pathname === "/"
              : href === "/category"
                ? pathname.startsWith("/category") || pathname.startsWith("/search")
                : pathname.startsWith(href);
          const badge = href === "/cart" && mounted && count > 0 && <CountBadge count={count} className="-right-2.5 -top-1.5" />;
          const itemClassName = cn(
            "flex flex-col items-center justify-center gap-0.5 pt-1 text-[0.6875rem] font-medium leading-none tracking-[0.01em] transition-colors duration-150 ease-smooth",
            active ? "text-ink-900" : "text-ink-500 hover:text-ink-900",
          );

          if (href === "/category") {
            return (
              <button
                key={href}
                type="button"
                onClick={() => {
                  closeStorefrontPanels();
                  if (!menuOpen) openMenu();
                }}
                aria-label="Shop by category"
                aria-expanded={menuOpen}
                className={itemClassName}
              >
                <Icon size={24} strokeWidth={active ? 2.1 : 1.6} aria-hidden="true" />
                {label}
              </button>
            );
          }

          // The Bag tab opens the cart drawer in place, rather than navigating — same behavior as
          // the header's cart icon, so shoppers get one consistent way to review their selection.
          if (href === "/cart") {
            return (
              <button
                key={href}
                type="button"
                onClick={() => {
                  closeStorefrontPanels();
                  if (!bagOpen) openCartDrawer();
                }}
                aria-label={bagLabel(label, mounted ? count : 0)}
                aria-expanded={bagOpen}
                className={itemClassName}
              >
                <span className="relative">
                  <Icon size={24} strokeWidth={active ? 2.1 : 1.6} />
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
              // A tab tapped with a panel open goes there with the panel closed — also when it is the page already
              // showing (Home on the homepage), where no route change would close it. Tapping the tab you're already
              // on, with nothing open, scrolls back to the top, as in any iOS app. Switching tabs swaps the page
              // without the push slide.
              onClick={(e) => {
                if (active && !panelOpen && pathname === href) {
                  e.preventDefault();
                  window.scrollTo({ top: 0, behavior: "smooth" });
                  return;
                }
                markNavigation("none");
                closeStorefrontPanels();
              }}
              className={itemClassName}
            >
              <span className="relative">
                <Icon size={24} strokeWidth={active ? 2.1 : 1.6} />
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
