"use client";

import { useState } from "react";
import Link from "next/link";
import type { CategoryTreeNode } from "@/lib/api/storefront";

export function MegaMenu({ categories }: { categories: CategoryTreeNode[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <nav className="flex items-center gap-8">
      {categories.map((cat) => (
        <div
          key={cat.id}
          className="relative"
          onMouseEnter={() => setOpenId(cat.id)}
          onMouseLeave={() => setOpenId(null)}
        >
          <Link
            href={`/category/${cat.slug}`}
            className="group/navlink relative block py-2 text-sm uppercase tracking-wide text-ink-800 transition-colors duration-200 ease-smooth hover:text-brass-500"
          >
            {cat.name}
            <span className="absolute inset-x-0 -bottom-0.5 h-px origin-center scale-x-0 bg-brass-500 transition-transform duration-200 ease-smooth group-hover/navlink:scale-x-100" />
          </Link>

          {cat.children.length > 0 && openId === cat.id && (
            // Fully opaque, not the shared `.glass` (75% opacity) — this floats over whatever's on
            // the page below it, including the hero photo, and translucency let the image visibly
            // show through behind the menu text. A functional nav menu needs to read cleanly
            // regardless of what's behind it; the header's translucency (deliberate, sits over
            // plain scrolling content) doesn't carry over to this use case.
            <div className="absolute left-1/2 top-full z-40 w-64 -translate-x-1/2 animate-dropdown-in rounded-xl border border-ink-100/70 bg-cream-50 py-4 shadow-floatLg">
              <ul>
                {cat.children.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={`/category/${child.slug}`}
                      className="mx-2 block rounded-lg px-4 py-2 text-sm text-ink-700 transition-colors duration-150 ease-smooth hover:bg-ink-50 hover:text-brass-500"
                    >
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
