"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Menu, X, ChevronDown, User, PackageSearch } from "lucide-react";
import type { CategoryTreeNode } from "@/lib/api/storefront";

export function MobileNav({ categories }: { categories: CategoryTreeNode[] }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="lg:hidden">
      <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-ink-900">
        <Menu size={22} />
      </button>

      {open &&
        createPortal(
          // Rendered into document.body rather than in place: the header's `backdrop-blur`
          // creates a containing block for `position: fixed` descendants, which would
          // otherwise clip this overlay to the header's own height instead of the viewport.
          <div className="fixed inset-0 z-50 bg-cream-50">
            <div className="flex h-14 items-center justify-between border-b border-ink-100 px-4">
              <span className="font-display text-lg">Menu</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu">
                <X size={22} />
              </button>
            </div>
            <nav className="overflow-y-auto px-4 py-4">
              <div className="mb-2 flex gap-4 border-b border-ink-100 pb-4">
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 text-sm text-ink-700"
                >
                  <User size={16} /> Account
                </Link>
                <Link
                  href="/track-order"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 text-sm text-ink-700"
                >
                  <PackageSearch size={16} /> Track Order
                </Link>
              </div>
              {categories.map((cat) => (
                <div key={cat.id} className="border-b border-ink-100">
                  <div className="flex items-center justify-between py-3">
                    <Link
                      href={`/category/${cat.slug}`}
                      onClick={() => setOpen(false)}
                      className="text-sm uppercase tracking-wide"
                    >
                      {cat.name}
                    </Link>
                    {cat.children.length > 0 && (
                      <button
                        onClick={() => setExpandedId(expandedId === cat.id ? null : cat.id)}
                        aria-label="Expand"
                      >
                        <ChevronDown
                          size={18}
                          className={`transition-transform ${expandedId === cat.id ? "rotate-180" : ""}`}
                        />
                      </button>
                    )}
                  </div>
                  {expandedId === cat.id && (
                    <ul className="pb-3 pl-4">
                      {cat.children.map((child) => (
                        <li key={child.id}>
                          <Link
                            href={`/category/${child.slug}`}
                            onClick={() => setOpen(false)}
                            className="block py-2 text-sm text-ink-600"
                          >
                            {child.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </nav>
          </div>,
          document.body,
        )}
    </div>
  );
}
