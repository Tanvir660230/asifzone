"use client";

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
      <div className="hidden lg:block">
        <NavTabs tabs={tabs.map((t) => ({ label: t.node.label, href: t.href }))} activeHref={active?.href} scrollable={tabs.length > 6} className="mb-5" aria-label={ariaLabel ?? group?.label} />
      </div>
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
