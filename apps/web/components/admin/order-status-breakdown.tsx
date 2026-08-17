import { Clock, CheckCircle2, Package, Truck, Home, XCircle, RotateCcw, Undo2, ClipboardList } from "lucide-react";
import type { OrderStatusCount } from "@/lib/api/admin-analytics";
import { orderStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

// Covers every OrderStatus enum value (see schema.prisma) so a status never silently falls back to
// the neutral/unstyled treatment — colors follow the same tone convention as orderStatusBadgeClass
// in lib/format.ts (the badge shown elsewhere in the app), just expressed as icon/ring/bar classes
// for this donut+list instead of a solid pill.
const STATUS_META: Record<string, { icon: typeof Clock; text: string; chip: string; ring: string; bar: string }> = {
  PENDING: { icon: Clock, text: "text-warning-600", chip: "bg-warning-50", ring: "stroke-warning-500", bar: "bg-warning-500" },
  CONFIRMED: { icon: CheckCircle2, text: "text-info-600", chip: "bg-info-50", ring: "stroke-info-500", bar: "bg-info-500" },
  PROCESSING: { icon: Package, text: "text-info-600", chip: "bg-info-50", ring: "stroke-info-500", bar: "bg-info-500" },
  PACKED: { icon: Package, text: "text-info-600", chip: "bg-info-50", ring: "stroke-info-500", bar: "bg-info-500" },
  SHIPPED: { icon: Truck, text: "text-info-600", chip: "bg-info-50", ring: "stroke-info-500", bar: "bg-info-500" },
  DELIVERED: { icon: Home, text: "text-success-600", chip: "bg-success-50", ring: "stroke-success-500", bar: "bg-success-500" },
  PARTIALLY_DELIVERED: { icon: Truck, text: "text-warning-600", chip: "bg-warning-50", ring: "stroke-warning-500", bar: "bg-warning-500" },
  CANCELLED: { icon: XCircle, text: "text-danger-600", chip: "bg-danger-50", ring: "stroke-danger-500", bar: "bg-danger-500" },
  RETURNED: { icon: RotateCcw, text: "text-warning-600", chip: "bg-warning-50", ring: "stroke-warning-500", bar: "bg-warning-500" },
  REFUNDED: { icon: Undo2, text: "text-ink-500", chip: "bg-ink-100", ring: "stroke-ink-400", bar: "bg-ink-400" },
};

const FALLBACK_META = { icon: Package, text: "text-ink-500", chip: "bg-ink-100", ring: "stroke-ink-400", bar: "bg-ink-400" };

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function OrderStatusBreakdown({ counts }: { counts: OrderStatusCount[] }) {
  const total = counts.reduce((sum, c) => sum + c.count, 0);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <ClipboardList size={22} className="text-ink-300" />
        <p className="text-sm text-ink-500">No orders yet.</p>
      </div>
    );
  }

  const active = counts.filter((c) => c.count > 0);
  let cumulative = 0;

  return (
    <div className="flex flex-col items-center gap-7 sm:flex-row sm:items-center">
      {/* Donut — a single-glance read of the mix; the list beside it is where the precision lives. */}
      <div className="relative shrink-0">
        <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90">
          <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth="10" className="stroke-ink-100" />
          {active.map((c) => {
            const meta = STATUS_META[c.status] ?? FALLBACK_META;
            const dash = (c.count / total) * CIRCUMFERENCE;
            const offset = cumulative;
            cumulative += dash;
            return (
              <circle
                key={c.status}
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                strokeWidth="10"
                strokeLinecap="round"
                className={cn(meta.ring, "transition-all duration-500 ease-smooth")}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-offset}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-ink-900">{total}</span>
          <span className="text-[10px] uppercase tracking-wide text-ink-400">orders</span>
        </div>
      </div>

      <div className="w-full flex-1 space-y-3">
        {active.map((c) => {
          const meta = STATUS_META[c.status] ?? FALLBACK_META;
          const label = orderStatusLabel(c.status);
          const Icon = meta.icon;
          const pct = (c.count / total) * 100;
          return (
            <div key={c.status} className="flex items-center gap-3">
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", meta.chip)}>
                <Icon size={14} className={meta.text} />
              </div>
              <span className="w-28 shrink-0 truncate text-sm text-ink-700" title={label}>
                {label}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                <div className={cn("h-full rounded-full transition-all duration-500 ease-smooth", meta.bar)} style={{ width: `${pct}%` }} />
              </div>
              <span className="shrink-0 whitespace-nowrap text-right text-sm tabular-nums text-ink-900">
                {c.count} <span className="text-ink-400">· {pct.toFixed(0)}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
