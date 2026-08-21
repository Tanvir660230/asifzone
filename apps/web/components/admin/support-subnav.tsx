"use client";

import { SubNav } from "./sub-nav";

const TABS = [
  { label: "Feedback", href: "/admin/feedback" },
  { label: "Reviews", href: "/admin/reviews" },
];

/** Shared sub-nav across Feedback and Reviews, which now live behind a single "Support" sidebar
 * entry — see components/admin/sidebar.tsx for the other half of this change. */
export function SupportSubNav() {
  return <SubNav tabs={TABS} />;
}
