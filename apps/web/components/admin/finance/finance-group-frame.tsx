"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { InnerNav } from "@/components/admin/inner-nav";
import { navNode, resolveNavNode } from "@/lib/admin/navigation";

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
  if (!node || node.kind === "detail" || !group?.innerList) return <div data-area="finance">{children}</div>;
  return (
    <div data-area="finance" className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
      <InnerNav title={group.label} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
