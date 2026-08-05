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
            className="text-sm uppercase tracking-wide text-ink-800 transition-colors duration-200 ease-smooth hover:text-brass-500"
          >
            {cat.name}
          </Link>

          {cat.children.length > 0 && openId === cat.id && (
            <div className="glass absolute left-1/2 top-full z-40 w-64 -translate-x-1/2 animate-dropdown-in rounded-xl border border-ink-100/70 py-4 shadow-floatLg">
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
