"use client";

import { NavTabs, type NavTab } from "@/components/ui/tabs";

export type SubNavTab = NavTab;

/** Admin sub-navigation for pages grouped behind one sidebar entry (Products, Orders, Promotions,
 * Content, Support, Settings, Catalog). Thin wrapper over the shared NavTabs. */
export function SubNav({ tabs }: { tabs: SubNavTab[] }) {
  return <NavTabs tabs={tabs} className="mb-6" />;
}
