"use client";

import { useCurrentAdmin } from "@/hooks/use-current-admin";

/** Any admin can read the catalog setup (the product editor needs it), but changing what a product type
 * is — its fields, size guide, variant dimensions — is OWNER-only; the API enforces it, this just hides
 * the controls that would 403. */
export function useCanManageCatalog() {
  const { data } = useCurrentAdmin();
  return data?.admin.role === "OWNER";
}
