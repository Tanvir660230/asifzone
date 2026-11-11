"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";
import { ancestryOf, moduleOf, navNode, resolveNavNode, sectionTabsFor } from "@/lib/admin/navigation";
import { cn } from "@/lib/utils";
import { useNavAccess } from "@/hooks/use-nav-access";
import { isStockSectionPath } from "@/components/admin/stock/stock-side-nav";

/**
 * In-page section tabs derived from the navigation manifest (lib/admin/navigation.ts): the pages beside the current one
 * or a grouping page's own pages (Catalog setup's ten). Replaces the per-module subnav route arrays — the pages, labels,
 * order and visibility all come from the manifest.
 *
 * A module's own pages (Orders › All orders / Return requests) are the shell's section bar (components/admin/section-bar.tsx),
 * pinned under the toolbar, so here they'd say the same thing twice — only deeper tab sets like Catalog setup's render.
 */
export function ModuleTabs({ className = "mb-6", "aria-label": ariaLabel, frame = false }: { className?: string; "aria-label"?: string; frame?: boolean }) {
  const pathname = usePathname();
  const access = useNavAccess();
  const tabs = sectionTabsFor(pathname, access);
  if (tabs.length === 0) return null;
  if (tabs.every((t) => moduleOf(t.node).id === t.node.parent)) return null;
  const current = resolveNavNode(pathname);
  const trail = current ? ancestryOf(current).map((n) => n.id) : [];
  const active = tabs.find((t) => trail.includes(t.node.id));
  // One row of tabs per screen size (owner, 2026-11-12: one navigation rule). A group's frame (SectionFrame) draws the
  // row from laptop width up, above every page of the group; the page's own <ModuleTabs /> draws it below that. Groups
  // without a frame keep the page's row at every width.
  const group = tabs[0]?.node.parent ? navNode(tabs[0].node.parent) : undefined;
  const framed = Boolean(group?.innerList) || isStockSectionPath(pathname);
  if (frame) {
    if (!framed) return null;
    return (
      // Capsules, not a second underlined row: the section bar above already underlines the module's pages, and two
      // identical rows of tabs read as one confused menu.
      <nav aria-label={ariaLabel ?? group?.label ?? "Section navigation"} className="mb-4 hidden flex-wrap gap-1 lg:flex">
        {tabs.map((t) => {
          const on = t.href === active?.href;
          return (
            <Link
              key={t.node.id}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex h-7 items-center rounded-full px-3 text-[13px] transition-colors duration-fast ease-smooth",
                on ? "bg-ink-900/[0.08] font-semibold text-fg" : "font-medium text-fg-muted hover:bg-ink-900/[0.045] hover:text-fg",
              )}
            >
              {t.node.label}
            </Link>
          );
        })}
      </nav>
    );
  }
  return (
    <NavTabs
      tabs={tabs.map((t) => ({ label: t.node.label, href: t.href }))}
      activeHref={active?.href}
      scrollable={tabs.length > 6}
      className={cn(className, framed && "lg:hidden")}
      aria-label={ariaLabel}
    />
  );
}
