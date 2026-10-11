import { Circle } from "lucide-react";
import type { OrderStatus } from "@clothing-brand/shared";
import { statusOf } from "@/lib/status";

// One icon per order status — from the status registry (lib/status.ts), shared by the list's status pills, the detail
// panel's status picker, and the timeline, so a given status always reads with the same glyph everywhere.
export function OrderStatusIcon({
  status,
  size = 14,
  className,
}: {
  status: OrderStatus;
  size?: number;
  className?: string;
}) {
  const Icon = statusOf("order", status).icon ?? Circle;
  return <Icon size={size} className={className} />;
}
