"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, MapPin, Heart, Package, User, RotateCcw, Gift, Tag, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentCustomer } from "@/hooks/use-current-customer";
import { logoutCustomer } from "@/lib/customer-auth";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";

const NAV_ITEMS = [
  { href: "/account", label: "Profile", icon: User },
  { href: "/account/orders", label: "Orders", icon: Package },
  { href: "/account/returns", label: "Returns", icon: RotateCcw },
  { href: "/account/addresses", label: "Addresses", icon: MapPin },
  { href: "/account/wishlist", label: "Wishlist", icon: Heart },
  { href: "/account/reward-points", label: "Reward Points", icon: Gift },
  { href: "/account/coupons", label: "Coupons", icon: Tag },
  { href: "/account/browsing-history", label: "Browsing History", icon: History },
];

export function AccountNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { data } = useCurrentCustomer();

  async function handleLogout() {
    await logoutCustomer();
    router.replace("/account/login");
  }

  return (
    <aside className="w-full shrink-0 sm:w-56">
      {data?.customer && <p className="mb-4 text-sm text-ink-500">Hi, {data.customer.name.split(" ")[0]}</p>}
      <nav aria-label="Account navigation">
        <HScrollShadow className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible" edgeFrom="from-cream-100">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex shrink-0 items-center gap-3 rounded px-3 py-2 text-sm transition-colors",
                  active ? "bg-ink-900 text-cream-50" : "text-ink-700 hover:bg-ink-50",
                )}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
          <button
            onClick={handleLogout}
            className="flex shrink-0 items-center gap-3 rounded px-3 py-2 text-left text-sm text-ink-700 transition-colors hover:bg-ink-50"
          >
            <LogOut size={16} />
            Log out
          </button>
        </HScrollShadow>
      </nav>
    </aside>
  );
}
