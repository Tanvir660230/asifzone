"use client";

import Link from "next/link";
import { BellRing, ChevronDown, ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/admin/page-header";
import { OwnerHome } from "@/components/admin/finance/owner-home";
import { useCapabilities } from "@/hooks/use-capability";
import { useNavAccess } from "@/hooks/use-nav-access";
import { navChildren, navNode } from "@/lib/admin/navigation";

/** The order the groups appear in the map — the same order as the sidebar. */
const GROUPS = ["finance.money", "finance.selling", "finance.purchasing", "finance.books", "finance.people", "finance.setup"];

/**
 * Finance's front door (docs/FINANCE_OWNER_HOME.md): how the month is going, where the money is, who is owed what and
 * what needs doing, with one Add for everyday entries. Every other finance page is one tap away in the map, folded
 * below. Roles that only see payments get the map (their pages), not the books' figures.
 */
export default function FinanceOverviewPage() {
  const { can, ready } = useCapabilities();
  const books = can("finance.view");

  return (
    <div className="space-y-8">
      <PageHeader title="Finance" description="How the month is going, where your money is and who is owed what." />
      {ready && books && <OwnerHome />}
      {ready && !books && (
        <Alert variant="info" title="You see the payments side of Finance">
          The books — money accounts, profit and suppliers — are visible to the owner. Your pages are listed below.
        </Alert>
      )}
      {ready && books ? (
        <details className="group rounded-2xl border border-line-subtle bg-surface px-5 py-4 sm:px-6" data-testid="finance-map-fold">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
            <span>All finance pages<span className="block text-xs font-normal text-fg-muted">Detailed books, purchasing, payroll, statements and settings</span></span>
            <ChevronDown className="h-4 w-4 text-fg-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-5"><FinanceMap /></div>
        </details>
      ) : (
        <FinanceMap />
      )}
    </div>
  );
}

function FinanceMap() {
  const access = useNavAccess();
  if (!access.ready) return null;
  const top = ["finance.attention"].map((id) => navNode(id)).filter((n) => n && (!n.capability || access.can(n.capability)));
  const groups = GROUPS.map((id) => ({ node: navNode(id)!, pages: navChildren(id, access) })).filter((g) => g.node && g.pages.length > 0 && (!g.node.capability || access.can(g.node.capability)));
  return (
    <section aria-labelledby="finance-map-title" data-testid="finance-map">
      <div className="mb-1 flex items-center gap-2">
        <h2 id="finance-map-title" className="text-[17px] font-semibold tracking-tight text-fg">Everything in Finance</h2>
      </div>
      <p className="mb-4 text-sm text-fg-muted">Every finance page, grouped the way the menu is. Not sure where something lives? Start here.</p>
      <div className="gap-x-10 md:columns-2">
        {groups.map(({ node, pages }) => (
          <div key={node.id} className="mb-7 break-inside-avoid">
            <h3 className="text-sm font-semibold text-fg">{node.label}</h3>
            {node.description && <p className="mt-0.5 text-xs text-fg-muted">{node.description}</p>}
            <ul className="mt-2 divide-y divide-line-subtle border-y border-line-subtle">
              {pages.map(({ node: page, href }) => (
                <li key={page.id}>
                  <Link href={href} className="group flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-fg group-hover:text-accent">{page.label}</span>
                      {page.description && <span className="block text-xs text-fg-muted">{page.description}</span>}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-accent" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {top.length > 0 && (
        <p className="mt-6 flex items-center gap-2 text-sm text-fg-muted">
          <BellRing className="h-4 w-4 text-ink-400" aria-hidden />
          Problems in the books and the month-end close live in <Link href="/admin/finance/attention" className="text-accent hover:underline">Needs attention</Link>.
        </p>
      )}
    </section>
  );
}
