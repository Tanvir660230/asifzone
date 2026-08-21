"use client";

import { SubNav } from "./sub-nav";

const TABS = [
  { label: "All Products", href: "/admin/products" },
  { label: "Attributes", href: "/admin/attributes" },
];

/** Shared sub-nav across Products and Attributes, which now live behind a single sidebar entry —
 * see components/admin/sidebar.tsx for the other half of this change. */
export function ProductsSubNav() {
  return <SubNav tabs={TABS} />;
}
