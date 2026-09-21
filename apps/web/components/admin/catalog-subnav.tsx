"use client";

import { SubNav } from "./sub-nav";

const TABS = [
  { label: "Product types", href: "/admin/catalog/types" },
  { label: "Templates", href: "/admin/catalog/templates" },
  { label: "Attributes", href: "/admin/catalog/attributes" },
  { label: "Size guides", href: "/admin/catalog/size-guides" },
  { label: "Care guides", href: "/admin/catalog/care-guides" },
  { label: "Materials", href: "/admin/catalog/materials" },
  { label: "SKUs", href: "/admin/catalog/sku" },
  { label: "Page sections", href: "/admin/catalog/sections" },
  { label: "Spec groups", href: "/admin/catalog/spec-groups" },
];

/** Tabs for the catalog setup area: what kinds of products the store sells and what each collects. */
export function CatalogSubNav() {
  return <SubNav tabs={TABS} />;
}
