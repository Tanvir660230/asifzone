"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, MapPin, Heart, Package, LayoutDashboard, RotateCcw, Gift, Tag, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutCustomer } from "@/lib/customer-auth";

const NAV_GROUPS = [
  {
    label: "Shopping",
    items: [
      { href: "/account/orders", label: "Orders", icon: Package },
      { href: "/account/returns", label: "Returns", icon: RotateCcw },
      { href: "/wishlist", label: "Wishlist", icon: Heart },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/account", label: "Dashboard", icon: LayoutDashboard },
      { href: "/account/addresses", label: "Addresses", icon: MapPin },
      { href: "/account/reward-points", label: "Reward Points", icon: Gift },
      { href: "/account/coupons", label: "Coupons", icon: Tag },
      { href: "/account/browsing-history", label: "Browsing History", icon: History },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

/** Which nav item should read as "current" for a given URL — not just the sub-pages that exactly
 * equal a nav href (Order Detail, Invoice, etc. never would), but also not naively "starts with,"
 * since "/account" would then match every other item too. Resolves to whichever nav href is the
 * longest matching prefix of the pathname, so "/account/orders/123/invoice" highlights "Orders"
 * and "/account" only highlights "Dashboard" on its own page. */
function isNavItemActive(pathname: string, href: string): boolean {
  const matches = NAV_ITEMS.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  if (matches.length === 0) return false;
  const longest = matches.reduce((best, item) => (item.href.length > best.href.length ? item : best));
  return longest.href === href;
}

export function AccountNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logoutCustomer();
    router.replace("/account/login");
  }

  return (
    <aside className="w-full shrink-0 sm:w-60">
      {/* Mobile: wrapping pill grid — every destination visible up front instead of behind a
          horizontal scroll, which previously hid most of the section (only ~3 of 8 items fit in
          one row on a typical phone, with just a faint edge shadow hinting at the rest). */}
      <nav aria-label="Account navigation" className="sm:hidden">
        <div className="flex flex-wrap gap-2">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isNavItemActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors duration-150 ease-smooth",
                  active ? "bg-ink-900 text-cream-50" : "bg-ink-50 text-ink-700 hover:bg-ink-100",
                )}
              >
                <Icon size={15} />
                {label}
              </Link>
            );
          })}
          <button
            onClick={handleLogout}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink-50 px-3.5 py-2 text-left text-sm text-ink-700 transition-colors duration-150 ease-smooth hover:bg-danger-50 hover:text-danger-600"
          >
            <LogOut size={15} />
            Log out
          </button>
        </div>
      </nav>

      {/* Desktop: grouped card with an active accent bar */}
      <nav aria-label="Account navigation" className="hidden sm:block">
        <div className="rounded-xl border border-ink-100 bg-cream-50 p-2 shadow-sm">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-1 last:mb-0">
              <p className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-ink-400 first:pt-1.5">
                {group.label}
              </p>
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = isNavItemActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-md py-2 pl-3 pr-3 text-sm transition-colors duration-150 ease-smooth",
                      active ? "bg-ink-50 font-medium text-ink-900" : "text-ink-700 hover:bg-ink-50/60",
                    )}
                  >
                    {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-ink-900" />}
                    <Icon size={16} className={active ? "text-ink-900" : "text-ink-400"} />
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="mt-1 border-t border-ink-100 pt-1">
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-ink-700 transition-colors duration-150 ease-smooth hover:bg-danger-50 hover:text-danger-600"
            >
              <LogOut size={16} className="text-ink-400" />
              Log out
            </button>
          </div>
        </div>
      </nav>
    </aside>
  );
}
