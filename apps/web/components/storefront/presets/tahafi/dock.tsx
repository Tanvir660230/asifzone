"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, Home, LayoutGrid, Search, ShoppingBag, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyboardFlag } from "@/hooks/use-keyboard-flag";
import { useCartCount } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { useMobileMenuStore } from "@/store/mobile-menu";
import { useSearchOverlayStore } from "@/store/search-overlay";
import { closeStorefrontPanels } from "@/store/panels";
import { markNavigation } from "@/lib/nav-direction";
import { bagLabel } from "../../count-badge";
import { BagCount } from "./header-actions";

type Tab = { label: string; icon: LucideIcon } & ({ href: string } | { panel: "menu" | "search" });

const TABS: Tab[] = [
  { label: "Home", icon: Home, href: "/" },
  { label: "Shop", icon: LayoutGrid, panel: "menu" },
  { label: "Search", icon: Search, panel: "search" },
  { label: "Saved", icon: Heart, href: "/wishlist" },
];

/**
 * The tahafi preset's phone tab bar, in light glass like a new iPhone's: a floating capsule for moving around (Home, Shop,
 * Search, Saved) with the open tab on a soft pill, and the bag on its own beside it with its olive count, so the way to
 * checkout is always one tap away and never one icon among five. Account sits in the header. It behaves like the classic
 * tab bar (mobile-bottom-nav.tsx): the panels it opens stop above it (`--dock-tab-bar` is its height plus the gap below
 * it), the open panel's tab is the active one, and it steps aside for the on-screen keyboard and on the checkout.
 */
export function TahafiDock() {
  const pathname = usePathname();
  const count = useCartCount();
  const bagOpen = useCartDrawerStore((s) => s.isOpen);
  const openBag = useCartDrawerStore((s) => s.open);
  const menuOpen = useMobileMenuStore((s) => s.isOpen);
  const openMenu = useMobileMenuStore((s) => s.open);
  const searchOpen = useSearchOverlayStore((s) => s.isOpen);
  const openSearch = useSearchOverlayStore((s) => s.open);
  const panelOpen = bagOpen || menuOpen || searchOpen;
  useKeyboardFlag();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const shown = mounted ? count : 0;

  if (pathname.startsWith("/checkout")) return null;

  const tab = (active: boolean) =>
    cn(
      "my-1.5 flex flex-col items-center justify-center gap-0.5 rounded-full text-[0.6875rem] leading-none transition-colors duration-150 ease-smooth",
      active ? "bg-ink-900/[0.08] font-semibold text-fg" : "font-medium text-fg-muted",
    );

  return (
    <nav
      data-tab-bar
      data-app-chrome
      data-hide-on-keyboard
      aria-label="Primary"
      className="fixed inset-x-3.5 bottom-[calc(env(safe-area-inset-bottom)+0.875rem)] z-dock flex h-[3.875rem] gap-2.5 lg:hidden"
    >
      <div className="glass-panel grid flex-1 grid-cols-4 rounded-full px-1.5">
        {TABS.map(({ label, icon: Icon, ...target }) => {
          if ("panel" in target) {
            const open = target.panel === "menu" ? menuOpen : searchOpen;
            return (
              <button
                key={label}
                type="button"
                aria-expanded={open}
                onClick={() => {
                  closeStorefrontPanels();
                  if (!open) (target.panel === "menu" ? openMenu : openSearch)();
                }}
                className={tab(open)}
              >
                <Icon size={22} strokeWidth={open ? 2 : 1.6} aria-hidden="true" />
                {label}
              </button>
            );
          }
          const { href } = target;
          const active = !panelOpen && (href === "/" ? pathname === "/" : pathname.startsWith(href));
          return (
            <Link
              key={label}
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
              <Icon size={22} strokeWidth={active ? 2 : 1.6} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </div>
      <button
        type="button"
        aria-label={bagLabel("Bag", shown)}
        aria-expanded={bagOpen}
        onClick={() => {
          closeStorefrontPanels();
          if (!bagOpen) openBag();
        }}
        className="glass-panel relative flex w-[3.875rem] shrink-0 items-center justify-center rounded-full text-fg"
      >
        <ShoppingBag size={24} strokeWidth={1.75} aria-hidden="true" />
        <BagCount count={shown} className="right-2 top-2" />
      </button>
    </nav>
  );
}
