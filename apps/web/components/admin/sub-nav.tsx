"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface SubNavTab {
  label: string;
  href: string;
}

/** Shared tab-strip markup for admin sub-navs that group several pages behind one sidebar entry
 * (Products, Orders, Promotions, Content, Support, Settings — see their thin wrappers in this
 * folder). BiSubNav renders its own markup instead: at 15 tabs it needs a non-wrapping scroll row
 * rather than this wrapping one. */
export function SubNav({ tabs }: { tabs: SubNavTab[] }) {
  const pathname = usePathname();

  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-ink-100">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-150 ease-smooth",
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
