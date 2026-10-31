"use client";

import Link from "next/link";
import { BellRing, ChevronDown, ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/admin/page-header";
import { OwnerHome } from "@/components/admin/finance/owner-home";
import { useCapabilities } from "@/hooks/use-capability";
import { useNavAccess } from "@/hooks/use-nav-access";
import { navChildren, navNode, type NavAccess, type NavItem } from "@/lib/admin/navigation";

/** The menu sections the map covers, in sidebar order (blueprint tab 2 §2): Money, Books, Reports › profit and costs,
 * Settings › Books setup. Store analytics is not a money page, so Reports lists only its book-side pages. */
const SECTIONS = ["finance", "books", "analytics", "settings.books"];
const IN_MAP = (item: NavItem) => item.node.id !== "finance.home" && item.node.id !== "reports.analytics" && item.node.id !== "analytics.ai-assistant";

/** One heading per section for its loose pages, and one per grouping page (Money › Payments & refunds) for its own pages. */
function mapGroups(access: NavAccess) {
  return SECTIONS.flatMap((id) => {
    const section = navNode(id)!;
    const items = navChildren(id, access).filter(IN_MAP);
    const loose = items.filter((i) => i.children.length === 0);
    const grouped = items.filter((i) => i.children.length > 0);
    return [
      ...(loose.length ? [{ id, label: section.label, description: undefined as string | undefined, pages: loose }] : []),
      ...grouped.map((g) => ({ id: g.node.id, label: `${section.label} › ${g.node.label}`, description: g.node.description, pages: g.children })),
    ];
  });
}

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
      <PageHeader title="Money" description="How the month is going, where your money is and who is owed what." />
      {ready && books && <OwnerHome />}
      {ready && !books && (
        <Alert variant="info" title="You see the payments side of Money">
          The books — money accounts, profit and suppliers — are visible to the owner. Your pages are listed below.
        </Alert>
      )}
      {ready && books ? (
        <details className="liquid group px-5 py-4 sm:px-6" data-testid="finance-map-fold">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
            <span>All money and books pages<span className="block text-xs font-normal text-fg-muted">Accounts, bills, payments, the books, profit reports and books setup</span></span>
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
  const groups = mapGroups(access);
  return (
    <section aria-labelledby="finance-map-title" data-testid="finance-map">
      <div className="mb-1 flex items-center gap-2">
        <h2 id="finance-map-title" className="text-[17px] font-semibold tracking-tight text-fg">Everything in Money and Books</h2>
      </div>
      <p className="mb-4 text-sm text-fg-muted">Every finance page, grouped the way the menu is. Not sure where something lives? Start here.</p>
      <div className="gap-x-10 md:columns-2">
        {groups.map(({ id, label, description, pages }) => (
          <div key={id} className="mb-7 break-inside-avoid">
            <h3 className="text-sm font-semibold text-fg">{label}</h3>
            {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
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
          Problems in the books are on <Link href="/admin/dashboard?queue=finance#work-queue" className="text-accent underline-offset-2 hover:underline">Home</Link>; closing the month is on <Link href="/admin/finance/month-end" className="text-accent underline-offset-2 hover:underline">Month-end</Link>.
        </p>
      )}
    </section>
  );
}
