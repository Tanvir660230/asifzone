"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNodeAllowed, matchesRoute, resolveNavNode } from "@/lib/admin/navigation";
import { useNavAccess } from "@/hooks/use-nav-access";
import { cn } from "@/lib/utils";

/**
 * The Stock section's menu on wide screens (stock UI redesign, docs/superpowers/plans/2026-11-03-stock-ui-redesign.md):
 * every inventory, purchasing, production, packaging and report page in five groups, so nothing hides behind "More" or a
 * second row of tabs. Each link shows only when the navigation manifest lets this admin open that page; on phones the
 * shell's section bar stays (this menu is lg+ only).
 */
const GROUPS: Array<{ label: string; items: Array<{ label: string; href: string; also?: string[] }> }> = [
  {
    label: "Inventory",
    items: [
      { label: "Overview", href: "/admin/stock" },
      { label: "Materials", href: "/admin/manufacturing/materials" },
      { label: "Movements", href: "/admin/inventory" },
    ],
  },
  {
    label: "Purchase",
    items: [
      { label: "Purchases", href: "/admin/stock/purchases" },
      { label: "Purchase orders", href: "/admin/finance/purchase-orders", also: ["/admin/finance/purchase-orders/[id]"] },
      { label: "Suppliers", href: "/admin/finance/suppliers" },
      { label: "Returns to suppliers", href: "/admin/finance/supplier-returns" },
    ],
  },
  {
    label: "Production",
    items: [
      { label: "Today", href: "/admin/manufacturing/home" },
      { label: "Recipes", href: "/admin/manufacturing/boms" },
      { label: "Production runs", href: "/admin/manufacturing/production-orders", also: ["/admin/manufacturing/production-orders/[id]"] },
    ],
  },
  { label: "Packaging", items: [{ label: "Packing rules", href: "/admin/finance/packaging" }] },
  {
    label: "Reports",
    items: [
      { label: "Material usage", href: "/admin/stock/usage" },
      { label: "Stock value check", href: "/admin/finance/stock-check" },
    ],
  },
];

/** Pages the menu belongs to: every link above (and its detail pages). */
export function isStockSectionPath(pathname: string): boolean {
  return GROUPS.some((g) => g.items.some((i) => [i.href, ...(i.also ?? [])].some((r) => matchesRoute(r, pathname)) || pathname.startsWith(`${i.href}/`)));
}

export function StockSideNav() {
  const pathname = usePathname();
  const access = useNavAccess();
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      const node = resolveNavNode(i.href);
      return !node || isNodeAllowed(node, access);
    }),
  })).filter((g) => g.items.length > 0);
  // the longest matching link wins (Purchases, not Overview, on /admin/stock/purchases)
  const active = groups
    .flatMap((g) => g.items)
    .filter((i) => [i.href, ...(i.also ?? [])].some((r) => matchesRoute(r, pathname) || pathname.startsWith(`${i.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Stock" className="sticky top-chrome hidden self-start lg:block" data-testid="stock-side-nav">
      {groups.map((g) => (
        <div key={g.label} className="mb-4">
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={i.href === active ? "page" : undefined}
                  className={cn(
                    "block rounded-lg px-3 py-1.5 text-[13px] transition-colors duration-fast ease-smooth",
                    i.href === active ? "bg-ink-900/[0.07] font-medium text-fg" : "text-fg-muted hover:bg-ink-900/[0.04] hover:text-fg",
                  )}
                >
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The Stock section's frame: the menu beside the page on wide screens, the page alone on phones. */
export function StockFrame({ children }: { children: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
      <StockSideNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
