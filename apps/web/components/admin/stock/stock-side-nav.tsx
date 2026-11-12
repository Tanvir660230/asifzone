"use client";

import type { ReactNode } from "react";
import { matchesRoute } from "@/lib/admin/navigation";
import { SectionFrame } from "@/components/admin/section-frame";

/**
 * The pages that make up the Stock section (inventory, purchasing, production, packaging, reports), wherever their
 * routes live. `isStockSectionPath` tells the frames and tab rows that a page belongs to it.
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

/** The Stock section's frame: the group's tabs above the page (components/admin/section-frame.tsx). The grouped menu
 * above is no longer drawn beside the page: the section bar and those tabs reach every page it listed. */
export function StockFrame({ children }: { children: ReactNode }) {
  return <SectionFrame>{children}</SectionFrame>;
}
