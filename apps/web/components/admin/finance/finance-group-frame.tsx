"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SectionFrame } from "@/components/admin/section-frame";
import { navNode, resolveNavNode } from "@/lib/admin/navigation";
import { isStockSectionPath, StockFrame } from "@/components/admin/stock/stock-side-nav";

/**
 * The money and books groups (Accounts & cash, Bills to pay, Payments & refunds, Courier & gateway, Statements, Ledger &
 * journals, Profit, Stock › More, Settings › Books setup) list their pages beside the page on wide screens, like
 * Catalog setup — the manifest marks each group `innerList`. Pages outside a group (Overview, Needs attention) and detail views
 * (a money account, a supplier's account) keep the full width.
 *
 * `data-area="finance"` turns on the Money "Liquid Glass" look (globals.css: glossy controls, .liquid recipes) for every
 * finance page and nothing else in the admin.
 */
export function FinanceGroupFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const node = resolveNavNode(pathname);
  const group = node?.parent ? navNode(node.parent) : undefined;
  // purchasing, packaging and the stock check belong to the Stock section: its menu, not the money groups
  if (isStockSectionPath(pathname)) return <div data-area="finance"><StockFrame>{children}</StockFrame></div>;
  if (!node || node.kind === "detail" || !group?.innerList) return <div data-area="finance">{children}</div>;
  return (
    <div data-area="finance">
      <SectionFrame>{children}</SectionFrame>
    </div>
  );
}
