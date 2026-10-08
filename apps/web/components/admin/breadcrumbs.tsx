"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { breadcrumbsFor, moduleOf, resolveNavNode } from "@/lib/admin/navigation";
import { cn } from "@/lib/utils";

/** Where this page sits — derived from the navigation manifest. Shown only below a module's landing page (a module
 * page's own header already says where you are) — unless `titleOnLanding`: the toolbar then names the module, so its
 * left side is never an empty strip. */
export function Breadcrumbs({ className, titleOnLanding = false }: { className?: string; titleOnLanding?: boolean }) {
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname);
  const node = resolveNavNode(pathname);
  if (crumbs.length === 1 && titleOnLanding && node) {
    // The module's own name, as the sidebar writes it.
    return <p className={cn("min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-fg", className)}>{moduleOf(node).label}</p>;
  }
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1 text-[13px] text-ink-500">
        {crumbs.map((crumb, i) => (
          <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight size={13} className="shrink-0 text-ink-300" aria-hidden />}
            {crumb.href ? (
              <Link href={crumb.href} className="truncate hover:text-ink-800">
                {crumb.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate font-medium text-ink-700">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
