"use client";

import { useCapability } from "@/hooks/use-capability";

/** Any admin can read the catalog setup (the product editor needs it), but changing what a product type
 * is — its fields, size guide, variant dimensions — needs `catalog.configure`; the API enforces it, this just
 * hides the controls that would 403. A named view over the capability registry (lib/admin/capabilities.ts). */
export function useCanManageCatalog() {
  return useCapability("catalog.configure");
}
