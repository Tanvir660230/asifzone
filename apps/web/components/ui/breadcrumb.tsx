import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

/** A trail of links above the page title, for pages nested below a sidebar item (e.g. an order's
 * detail/invoice pages, one level under "Orders") — the sidebar alone can't show that nesting
 * since it only ever highlights the top-level section. Last item renders as plain text with
 * aria-current="page" since it's where the visitor already is. */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={12} className="shrink-0 text-ink-300" aria-hidden="true" />}
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-ink-700 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} className={isLast ? "text-ink-600" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
