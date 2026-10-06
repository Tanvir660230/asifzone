"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";
import { ancestryOf, resolveNavNode, sectionTabsFor } from "@/lib/admin/navigation";
import { useNavAccess } from "@/hooks/use-nav-access";

/**
 * In-page section tabs derived from the navigation manifest (lib/admin/navigation.ts): the pages beside the current one
 * (Orders › All orders / Return requests) or a grouping page's own pages (Catalog setup's ten). Replaces the per-module
 * subnav route arrays — the pages, labels, order and visibility all come from the manifest.
 */
export function ModuleTabs({ className = "mb-6", "aria-label": ariaLabel }: { className?: string; "aria-label"?: string }) {
  const pathname = usePathname();
  const access = useNavAccess();
  const tabs = sectionTabsFor(pathname, access);
  if (tabs.length === 0) return null;
  const current = resolveNavNode(pathname);
  const trail = current ? ancestryOf(current).map((n) => n.id) : [];
  const active = tabs.find((t) => trail.includes(t.node.id));
  return (
    <NavTabs
      tabs={tabs.map((t) => ({ label: t.node.label, href: t.href }))}
      activeHref={active?.href}
      scrollable={tabs.length > 6}
      className={className}
      aria-label={ariaLabel}
    />
  );
}
