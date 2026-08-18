"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Overview", href: "/admin/bi/overview" },
  { label: "Visitors", href: "/admin/bi/visitors" },
  { label: "Journey", href: "/admin/bi/journey" },
  { label: "Search", href: "/admin/bi/search" },
  { label: "Product Intel", href: "/admin/bi/products" },
  { label: "Customer Intel", href: "/admin/bi/customers" },
  { label: "Marketing", href: "/admin/bi/marketing" },
  { label: "Sales", href: "/admin/bi/sales" },
  { label: "Financial", href: "/admin/bi/financial" },
  { label: "Inventory Intel", href: "/admin/bi/inventory" },
  { label: "Operations", href: "/admin/bi/operations" },
  { label: "Behavior", href: "/admin/bi/behavior" },
  { label: "AI Insights", href: "/admin/bi/ai-insights" },
  { label: "Lifetime", href: "/admin/bi/lifetime" },
  { label: "Reports", href: "/admin/bi/reports" },
];

/** Shared sub-nav across the 15 BI pages, which now live behind a single sidebar entry —
 * see components/admin/sidebar.tsx for the other half of this change.
 *
 * A single non-wrapping scroll row, not flex-wrap: at 15 tabs, wrapping ate 4-5 full rows on
 * mobile/tablet — the entire first screen was navigation, with every KPI pushed below the fold.
 * `-webkit-overflow-scrolling: touch` isn't needed (modern WebKit does this by default); the
 * scrollbar is left visible (no hide hack) so touch users get a visible affordance that there's
 * more to scroll to, per the same reasoning as `revenue-chart-card.tsx`'s segmented control. */
export function BiSubNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-ink-100">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium transition-colors duration-150 ease-smooth sm:px-4",
            pathname.startsWith(t.href)
              ? "border-ink-900 text-ink-900"
              : "border-transparent text-ink-400 hover:text-ink-700",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
