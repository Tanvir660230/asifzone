"use client";

import { SubNav } from "./sub-nav";

const TABS = [
  { label: "All Orders", href: "/admin/orders" },
  { label: "Return Requests", href: "/admin/return-requests" },
];

/** Shared sub-nav across Orders and Return Requests, which now live behind a single sidebar entry —
 * see components/admin/sidebar.tsx for the other half of this change. */
export function OrdersSubNav() {
  return <SubNav tabs={TABS} />;
}
