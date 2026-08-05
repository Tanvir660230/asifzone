import type { BundleCartPreview } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function previewBundle(items: { variantId: string; quantity: number }[]) {
  return apiFetch<BundleCartPreview>("/api/bundles/preview", { method: "POST", body: { items } });
}
