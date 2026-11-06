"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, MessageCircle, PackageSearch, ShoppingBag, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyboardFlag } from "@/hooks/use-keyboard-flag";
import { useCartCount } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { useMobileMenuStore } from "@/store/mobile-menu";
import { closeStorefrontPanels } from "@/store/panels";
import { markNavigation } from "@/lib/nav-direction";
import { bagLabel, CountBadge } from "../../count-badge";

const LINKS: Record<"home" | "orders" | "chat", { label: string; icon: LucideIcon; href: string }> = {
  home: { label: "Home", icon: Home, href: "/" },
  orders: { label: "Orders", icon: PackageSearch, href: "/track-order" },
  chat: { label: "Chat", icon: MessageCircle, href: "/contact" },
};

/**
 * The honey preset's phone tab bar: a plain white row across the bottom, like a shopping app's. Home, Shop (the category
 * sheet), the bag, order tracking and a way to reach the store. Everything it opens stops above it, the open panel's tab is
 * the active one, and it steps aside for the on-screen keyboard and on the checkout, as the classic bar does
 * (mobile-bottom-nav.tsx). The running total is the small bar above it (sticky-cart-bar.tsx).
 */
export function HoneyDock() {
  const pathname = usePathname();
  const count = useCartCount();
  const bagOpen = useCartDrawerStore((s) => s.isOpen);
  const openBag = useCartDrawerStore((s) => s.open);
  const menuOpen = useMobileMenuStore((s) => s.isOpen);
  const openMenu = useMobileMenuStore((s) => s.open);
  const panelOpen = bagOpen || menuOpen;
  useKeyboardFlag();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const shown = mounted ? count : 0;

  if (pathname.startsWith("/checkout")) return null;

  const tab = (active: boolean) =>
    cn(
      "flex flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold leading-none transition-colors duration-150 ease-smooth",
      active ? "text-[color:var(--nav-hover)]" : "text-fg-muted",
    );

  function link({ label, icon: Icon, href }: (typeof LINKS)[keyof typeof LINKS]) {
    const active = !panelOpen && (href === "/" ? pathname === "/" : pathname.startsWith(href));
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        onClick={(e) => {
          if (active && pathname === href) {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }
          markNavigation("none");
          closeStorefrontPanels();
        }}
        className={tab(active)}
      >
        <Icon size={22} strokeWidth={1.9} aria-hidden="true" />
        {label}
      </Link>
    );
  }

  return (
    <nav
      data-tab-bar
      data-app-chrome
      data-hide-on-keyboard
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-dock border-t border-line-subtle bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="grid h-[var(--dock-tab-bar)] grid-cols-5">
        {link(LINKS.home)}
        <button
          type="button"
          aria-expanded={menuOpen}
          onClick={() => {
            closeStorefrontPanels();
            if (!menuOpen) openMenu();
          }}
          className={tab(menuOpen)}
        >
          <LayoutGrid size={22} strokeWidth={1.9} aria-hidden="true" />
          Shop
        </button>
        <button
          type="button"
          aria-label={bagLabel("Bag", shown)}
          aria-expanded={bagOpen}
          onClick={() => {
            closeStorefrontPanels();
            if (!bagOpen) openBag();
          }}
          className={tab(bagOpen)}
        >
          <span className="relative">
            <ShoppingBag size={22} strokeWidth={1.9} aria-hidden="true" />
            {shown > 0 && <CountBadge count={shown} className="-right-2 -top-1.5" />}
          </span>
          Bag
        </button>
        {link(LINKS.orders)}
        {link(LINKS.chat)}
      </div>
    </nav>
  );
}
