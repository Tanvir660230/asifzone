"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";
import { ancestryOf, moduleOf, resolveNavNode, sectionTabsFor } from "@/lib/admin/navigation";
import { cn } from "@/lib/utils";
import { useNavAccess } from "@/hooks/use-nav-access";

/**
 * In-page section tabs derived from the navigation manifest (lib/admin/navigation.ts): the pages beside the current one
 * (Orders › All orders / Return requests) or a grouping page's own pages (Catalog setup's ten). Replaces the per-module
 * subnav route arrays — the pages, labels, order and visibility all come from the manifest.
 *
 * A module's own pages are already listed under it in the desktop sidebar, so there the tabs would say the same thing
 * twice: they show only below `lg` (no sidebar). Deeper sections (Catalog setup's pages, Analytics reports) aren't in
 * the sidebar and keep their tabs everywhere.
 */
export function ModuleTabs({ className = "mb-6", "aria-label": ariaLabel }: { className?: string; "aria-label"?: string }) {
  const pathname = usePathname();
  const access = useNavAccess();
  const tabs = sectionTabsFor(pathname, access);
  if (tabs.length === 0) return null;
  const current = resolveNavNode(pathname);
  const trail = current ? ancestryOf(current).map((n) => n.id) : [];
  const active = tabs.find((t) => trail.includes(t.node.id));
  const mirrorsSidebar = tabs.every((t) => moduleOf(t.node).id === t.node.parent);
  return (
    <NavTabs
      tabs={tabs.map((t) => ({ label: t.node.label, href: t.href }))}
      activeHref={active?.href}
      scrollable={tabs.length > 6}
      className={cn(className, mirrorsSidebar && "lg:hidden")}
      aria-label={ariaLabel}
    />
  );
}
