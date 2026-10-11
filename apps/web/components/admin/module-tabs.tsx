"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";
import { ancestryOf, moduleOf, navNode, resolveNavNode, sectionTabsFor } from "@/lib/admin/navigation";
import { cn } from "@/lib/utils";
import { useNavAccess } from "@/hooks/use-nav-access";

/**
 * In-page section tabs derived from the navigation manifest (lib/admin/navigation.ts): the pages beside the current one
 * or a grouping page's own pages (Catalog setup's ten). Replaces the per-module subnav route arrays — the pages, labels,
 * order and visibility all come from the manifest.
 *
 * A module's own pages (Orders › All orders / Return requests) are the shell's section bar (components/admin/section-bar.tsx),
 * pinned under the toolbar, so here they'd say the same thing twice — only deeper tab sets like Catalog setup's render.
 */
export function ModuleTabs({ className = "mb-6", "aria-label": ariaLabel }: { className?: string; "aria-label"?: string }) {
  const pathname = usePathname();
  const access = useNavAccess();
  const tabs = sectionTabsFor(pathname, access);
  if (tabs.length === 0) return null;
  if (tabs.every((t) => moduleOf(t.node).id === t.node.parent)) return null;
  const current = resolveNavNode(pathname);
  const trail = current ? ancestryOf(current).map((n) => n.id) : [];
  const active = tabs.find((t) => trail.includes(t.node.id));
  // A group shown as an inner list on wide screens (its layout's <InnerNav>) keeps the tabs for phones only.
  const group = tabs[0]?.node.parent ? navNode(tabs[0].node.parent) : undefined;
  return (
    <NavTabs
      tabs={tabs.map((t) => ({ label: t.node.label, href: t.href }))}
      activeHref={active?.href}
      scrollable={tabs.length > 6}
      className={cn(className, group?.innerList && "lg:hidden")}
      aria-label={ariaLabel}
    />
  );
}
