"use client";

import { SubNav } from "./sub-nav";

const TABS = [
  { label: "Flash Sales", href: "/admin/flash-sales" },
  { label: "Coupons", href: "/admin/coupons" },
  { label: "Bundles", href: "/admin/bundles" },
  { label: "Campaigns", href: "/admin/campaigns" },
];

/** Shared sub-nav across Flash Sales, Coupons, Bundles, and Campaigns, which now live behind a
 * single "Promotions" sidebar entry — see components/admin/sidebar.tsx for the other half. */
export function PromotionsSubNav() {
  return <SubNav tabs={TABS} />;
}
