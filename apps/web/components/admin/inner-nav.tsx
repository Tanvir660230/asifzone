"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ancestryOf, resolveNavNode, sectionTabsFor } from "@/lib/admin/navigation";
import { useNavAccess } from "@/hooks/use-nav-access";
import { cn } from "@/lib/utils";

/**
 * The vertical inner list of a grouping page marked `innerList` in the navigation manifest (Blueprint V2 N4) — Catalog
 * setup's pages beside the page on wide screens, like macOS Settings. Phones keep the tab row (ModuleTabs).
 */
export function InnerNav({ title }: { title: string }) {
  const pathname = usePathname();
  const access = useNavAccess();
  const items = sectionTabsFor(pathname, access);
  const current = resolveNavNode(pathname);
  const trail = current ? ancestryOf(current).map((n) => n.id) : [];
  if (items.length === 0) return null;
  return (
    <nav aria-label={title} className="sticky top-chrome hidden self-start lg:block">
      <p className="mb-2 px-3 text-[12px] font-medium text-fg-subtle">{title}</p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = trail.includes(item.node.id);
          return (
            <li key={item.node.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-lg px-3 py-1.5 text-[13px] transition-colors duration-fast ease-smooth",
                  active ? "bg-accent/[0.1] font-medium text-accent" : "text-fg-muted hover:bg-ink-900/[0.04] hover:text-fg",
                )}
              >
                {item.node.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
