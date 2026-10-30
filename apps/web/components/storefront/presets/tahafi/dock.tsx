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
import { TwinDiamonds } from "./twin-diamonds";

type Tab = { label: string; icon: LucideIcon } & ({ href: string } | { panel: "menu" | "search" });

const TABS: Tab[] = [
  { label: "Home", icon: Home, href: "/" },
  { label: "Shop", icon: LayoutGrid, panel: "menu" },
  { label: "Search", icon: Search, panel: "search" },
  { label: "Saved", icon: Heart, href: "/wishlist" },
];

/**
 * The tahafi preset's phone tab bar: a floating ink capsule for moving around (Home, Shop, Search, Saved), and the bag on
 * its own beside it in olive with its count, so the way to checkout is always one tap away and never one icon among five.
 * Account sits in the header. It behaves like the classic tab bar (mobile-bottom-nav.tsx): the panels it opens stop
 * above it (`--dock-tab-bar` is its height plus the gap below it), the open panel's tab is the active one, and it steps
 * aside for the on-screen keyboard and on the checkout.
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

  const tabClass = (active: boolean) =>
    cn(
      "flex flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium leading-none transition-colors duration-150 ease-smooth",
      active ? "text-cream-100" : "text-ink-300 hover:text-cream-100",
    );
  const mark = (active: boolean) =>
    active ? <TwinDiamonds className="mt-0.5 h-1.5 w-3 text-cream-100" /> : <span aria-hidden="true" className="mt-0.5 h-1.5" />;

  return (
    <nav
      data-tab-bar
      data-app-chrome
      data-hide-on-keyboard
      aria-label="Primary"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-dock flex h-14 gap-2 lg:hidden"
    >
      <div className="grid flex-1 grid-cols-4 rounded-[1.375rem] bg-ink-950 px-1.5 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.55)]">
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
                className={tabClass(open)}
              >
                <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
                {label}
                {mark(open)}
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
              className={tabClass(active)}
            >
              <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
              {label}
              {mark(active)}
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
        // sale-500 is the logo's olive in this theme (the second voice): the bag stands apart from the tabs.
        className="flex w-[4.75rem] flex-col items-center justify-center gap-1 rounded-[1.375rem] bg-sale-500 text-[0.6875rem] font-medium leading-none text-cream-50 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.55)]"
      >
        <span className="relative">
          <ShoppingBag size={22} strokeWidth={1.5} aria-hidden="true" />
          {shown > 0 && (
            <span aria-hidden="true" className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cream-50 px-1 text-[0.625rem] font-semibold tabular-nums text-ink-950">
              {shown}
            </span>
          )}
        </span>
        Bag
      </button>
    </nav>
  );
}
