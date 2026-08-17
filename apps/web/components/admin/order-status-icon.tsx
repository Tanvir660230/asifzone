import {
  Clock,
  CheckCircle2,
  Loader2,
  PackageCheck,
  Truck,
  Home,
  PackageX,
  Undo2,
  Ban,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import type { OrderStatus } from "@clothing-brand/shared";

// One icon per order status — shared by the list's status pills, the detail panel's status
// picker, and the timeline, so a given status always reads with the same glyph everywhere.
const STATUS_ICON: Record<OrderStatus, LucideIcon> = {
  PENDING: Clock,
  CONFIRMED: CheckCircle2,
  PROCESSING: Loader2,
  PACKED: PackageCheck,
  SHIPPED: Truck,
  DELIVERED: Home,
  PARTIALLY_DELIVERED: PackageX,
  CANCELLED: Ban,
  RETURNED: Undo2,
  REFUNDED: RotateCcw,
};

export function OrderStatusIcon({
  status,
  size = 14,
  className,
}: {
  status: OrderStatus;
  size?: number;
  className?: string;
}) {
  const Icon = STATUS_ICON[status];
  return <Icon size={size} className={className} />;
}
