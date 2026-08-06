"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CategoryTreeNode } from "@/lib/api/storefront";

/** Picks a desktop column count that keeps every row as evenly filled as possible, for however
 * many top-level categories happen to exist — 6 categories on a 4-column grid leaves a lonely
 * 4-then-2 last row, but the same 6 on 3 columns fills two clean rows of 3. Caps at `maxColumns`
 * (any more and the labels get cramped), then picks the smallest column count that still hits the
 * minimum number of rows, so the last row is never more ragged than it has to be. */
function balancedColumnCount(itemCount: number, maxColumns: number): number {
  if (itemCount <= maxColumns) return Math.max(itemCount, 1);
  const rows = Math.ceil(itemCount / maxColumns);
  return Math.ceil(itemCount / rows);
}

export function FooterCategoryNav({ categories }: { categories: CategoryTreeNode[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const topLevel = categories.filter((cat) => cat.children.length > 0);

  if (topLevel.length === 0) return null;

  const tabletColumns = balancedColumnCount(topLevel.length, 2);
  const desktopColumns = balancedColumnCount(topLevel.length, 4);

  return (
    <div className="mt-10 border-t border-ink-800 pt-8">
      <h3 className="mb-4 text-xs uppercase tracking-wide text-ink-400">Shop by Category</h3>
      {/* A real grid, not multi-column flow: `items-start` keeps every group's heading top-aligned
          within its row without stretching short groups to match a taller neighbour, and the
          column count is computed above so the last row is always as full as it can be — instead
          of the browser's own column-balancing algorithm scattering groups unpredictably. */}
      <div
        className="grid grid-cols-1 items-start gap-x-8 gap-y-0 sm:gap-y-8 sm:[grid-template-columns:repeat(var(--footer-cat-cols-sm),minmax(0,1fr))] lg:[grid-template-columns:repeat(var(--footer-cat-cols-lg),minmax(0,1fr))]"
        style={{ "--footer-cat-cols-sm": tabletColumns, "--footer-cat-cols-lg": desktopColumns } as CSSProperties}
      >
        {topLevel.map((cat) => {
          const isOpen = openId === cat.id;
          return (
            <div key={cat.id} className="border-b border-ink-800 py-3 lg:border-none lg:py-0">
              <Link
                href={`/category/${cat.slug}`}
                className="hidden text-xs uppercase tracking-wide text-ink-400 transition-colors duration-200 ease-smooth hover:text-brass-400 lg:block lg:pb-3"
              >
                {cat.name}
              </Link>

              <button
                onClick={() => setOpenId(isOpen ? null : cat.id)}
                className="flex w-full items-center justify-between text-left text-sm text-cream-100 lg:hidden"
                aria-expanded={isOpen}
              >
                {cat.name}
                <ChevronDown size={14} className={cn("transition-transform duration-200 ease-smooth", isOpen && "rotate-180")} />
              </button>

              <div
                className={cn(
                  "grid overflow-hidden transition-all duration-300 lg:grid-rows-[1fr] lg:opacity-100",
                  isOpen ? "grid-rows-[1fr] pt-2 opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                <ul className="overflow-hidden">
                  {cat.children.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={`/category/${child.slug}`}
                        className="block py-1.5 text-sm text-ink-300 transition-colors duration-200 ease-smooth hover:text-brass-400 lg:text-xs"
                      >
                        {child.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
