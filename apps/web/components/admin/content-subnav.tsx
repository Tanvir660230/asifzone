"use client";

import { SubNav } from "./sub-nav";

const TABS = [
  { label: "Homepage", href: "/admin/homepage" },
  { label: "Banners", href: "/admin/banners" },
];

/** Shared sub-nav across Homepage and Banners, which now live behind a single "Content" sidebar
 * entry — see components/admin/sidebar.tsx for the other half of this change. */
export function ContentSubNav() {
  return <SubNav tabs={TABS} />;
}
