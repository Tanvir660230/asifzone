"use client";

import { useState } from "react";
import Link from "next/link";
import type { CategoryTreeNode } from "@/lib/api/storefront";

export function MegaMenu({ categories }: { categories: CategoryTreeNode[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <nav className="hidden items-center gap-8 lg:flex">
      {categories.map((cat) => (
        <div
          key={cat.id}
          className="relative"
          onMouseEnter={() => setOpenId(cat.id)}
          onMouseLeave={() => setOpenId(null)}
        >
          <Link
            href={`/category/${cat.slug}`}
            className="text-sm uppercase tracking-wide text-ink-800 transition-colors hover:text-brass-500"
          >
            {cat.name}
          </Link>

          {cat.children.length > 0 && openId === cat.id && (
            <div className="absolute left-1/2 top-full z-40 w-64 -translate-x-1/2 rounded-lg border border-ink-100 bg-cream-50 py-4 shadow-lg">
              <ul>
                {cat.children.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={`/category/${child.slug}`}
                      className="block px-6 py-2 text-sm text-ink-700 hover:bg-ink-50 hover:text-brass-500"
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
