"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CategoryTreeNode } from "@/lib/api/storefront";

export function FooterCategoryNav({ categories }: { categories: CategoryTreeNode[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const topLevel = categories.filter((cat) => cat.children.length > 0);

  if (topLevel.length === 0) return null;

  return (
    <div className="mt-10 border-t border-ink-800 pt-8">
      <h3 className="mb-4 text-xs uppercase tracking-wide text-ink-400">Shop by Category</h3>
      <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
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
