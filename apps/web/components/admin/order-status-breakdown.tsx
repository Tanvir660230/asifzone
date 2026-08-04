import { Clock, CheckCircle2, Package, Truck, Home, XCircle, RotateCcw } from "lucide-react";
import type { OrderStatusCount } from "@/lib/api/admin-analytics";

// Reuses the reserved status palette (never repurposed for arbitrary series) — in-flight states share
// "info" since they're distinguished by icon + label, not color identity; only the two terminal
// states (delivered/cancelled) get their own success/danger tone.
const STATUS_META: Record<string, { label: string; icon: typeof Clock; className: string; barClassName: string }> = {
  PENDING: { label: "Pending", icon: Clock, className: "text-warning-600", barClassName: "bg-warning-500" },
  CONFIRMED: { label: "Confirmed", icon: CheckCircle2, className: "text-info-600", barClassName: "bg-info-500" },
  PROCESSING: { label: "Processing", icon: Package, className: "text-info-600", barClassName: "bg-info-500" },
  SHIPPED: { label: "Shipped", icon: Truck, className: "text-info-600", barClassName: "bg-info-500" },
  DELIVERED: { label: "Delivered", icon: Home, className: "text-success-600", barClassName: "bg-success-500" },
  CANCELLED: { label: "Cancelled", icon: XCircle, className: "text-danger-600", barClassName: "bg-danger-500" },
  REFUNDED: { label: "Refunded", icon: RotateCcw, className: "text-ink-500", barClassName: "bg-ink-400" },
};

export function OrderStatusBreakdown({ counts }: { counts: OrderStatusCount[] }) {
  const total = counts.reduce((sum, c) => sum + c.count, 0);

  if (total === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">No orders yet.</p>;
  }

  return (
    <div className="space-y-3">
      {counts
        .filter((c) => c.count > 0)
        .map((c) => {
          const meta = STATUS_META[c.status] ?? {
            label: c.status,
            icon: Package,
            className: "text-ink-500",
            barClassName: "bg-ink-400",
          };
          const Icon = meta.icon;
          return (
            <div key={c.status} className="flex items-center gap-3">
              <Icon size={16} className={meta.className} />
              <span className="w-24 text-sm text-ink-700">{meta.label}</span>
              <div className="h-2 flex-1 rounded-full bg-ink-100">
                <div className={`h-2 rounded-full ${meta.barClassName}`} style={{ width: `${(c.count / total) * 100}%` }} />
              </div>
              <span className="w-6 text-right text-sm text-ink-900">{c.count}</span>
            </div>
          );
        })}
    </div>
  );
}
