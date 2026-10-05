import type { ProductStatus } from "@clothing-brand/shared";
import { Badge, type BadgeProps } from "@/components/ui/badge";

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: "Draft",
  READY: "Ready",
  PUBLISHED: "Published",
  UNPUBLISHED: "Unpublished",
};

/** Lifecycle -> shared badge meaning (no per-component colors). */
const VARIANT: Record<ProductStatus, NonNullable<BadgeProps["variant"]>> = {
  DRAFT: "neutral",
  READY: "info",
  PUBLISHED: "success",
  UNPUBLISHED: "danger",
};

export function ProductStatusBadge({ status, className }: { status: ProductStatus; className?: string }) {
  return (
    <Badge variant={VARIANT[status]} dot className={className}>
      {PRODUCT_STATUS_LABELS[status]}
    </Badge>
  );
}
