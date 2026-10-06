import type { ProductStatus } from "@clothing-brand/shared";
import { StatusBadge } from "@/components/ui/status-badge";
import { STATUS_REGISTRY } from "@/lib/status";

/** Product lifecycle labels — from the status registry (lib/status.ts). */
export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = Object.fromEntries(
  Object.entries(STATUS_REGISTRY.product).map(([status, entry]) => [status, entry.label]),
) as Record<ProductStatus, string>;

export function ProductStatusBadge({ status, className }: { status: ProductStatus; className?: string }) {
  return <StatusBadge domain="product" value={status} dot className={className} />;
}
