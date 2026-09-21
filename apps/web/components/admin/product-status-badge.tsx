import type { ProductStatus } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: "Draft",
  READY: "Ready",
  PUBLISHED: "Published",
  UNPUBLISHED: "Unpublished",
};

const STYLES: Record<ProductStatus, string> = {
  DRAFT: "bg-ink-100 text-ink-600",
  READY: "bg-brass-100 text-brass-800",
  PUBLISHED: "bg-success-100 text-success-700",
  UNPUBLISHED: "bg-danger-50 text-danger-700",
};

export function ProductStatusBadge({ status, className }: { status: ProductStatus; className?: string }) {
  return <Badge className={cn(STYLES[status], className)}>{PRODUCT_STATUS_LABELS[status]}</Badge>;
}
