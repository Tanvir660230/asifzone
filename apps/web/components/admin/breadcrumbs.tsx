"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { breadcrumbsFor } from "@/lib/admin/navigation";
import { cn } from "@/lib/utils";

/** Where this page sits — derived from the navigation manifest. Shown only below a module's landing page (a module
 * page's own header already says where you are). */
export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname);
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1 text-xs text-ink-500">
        {crumbs.map((crumb, i) => (
          <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight size={12} className="shrink-0 text-ink-300" aria-hidden />}
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
