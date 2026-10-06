"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CalendarClock, ChevronRight, CircleDollarSign, PackageOpen, RotateCcw, ShoppingBag, Truck, Undo2, Wallet } from "lucide-react";
import type { OrderQueueId } from "@clothing-brand/shared";
import { Card } from "@/components/ui/card";
import type { OrderStats } from "@/lib/api/admin-orders";
import { formatCount, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ORDER_QUEUE_LABELS } from "./use-orders-list-state";

function Metric({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 bg-surface px-4 py-3.5 sm:px-5 sm:py-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-900/[0.04] text-ink-500" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase leading-tight tracking-wider text-ink-400">{label}</p>
        <p className="truncate text-xl font-semibold tabular-nums tracking-tight text-ink-900">{value}</p>
        {hint && <p className="hidden truncate text-[11px] text-ink-400 sm:block">{hint}</p>}
      </div>
    </div>
  );
}

const QUEUE_TILES: Array<{ id: OrderQueueId; icon: ReactNode; tone: "warning" | "danger"; hint: string }> = [
  { id: "followUpDue", icon: <CalendarClock size={16} />, tone: "warning", hint: "Pending, callback time reached" },
  { id: "courierIssue", icon: <Truck size={16} />, tone: "warning", hint: "On courier hold or sync failing" },
  { id: "cancelledButPaid", icon: <CircleDollarSign size={16} />, tone: "danger", hint: "Refund owed on a cancellation" },
  { id: "refundDue", icon: <Undo2 size={16} />, tone: "danger", hint: "Returned, money still held" },
  { id: "unpaid", icon: <Wallet size={16} />, tone: "warning", hint: "No payment recorded yet" },
];

const TONE = {
  warning: { chip: "bg-warning-50 text-warning-700", dot: "bg-warning-500" },
  danger: { chip: "bg-danger-50 text-danger-700", dot: "bg-danger-500" },
};

function QueueTile({
  label,
  hint,
  count,
  icon,
  tone,
  active,
  onClick,
  href,
}: {
  label: string;
  hint: string;
  count: number | undefined;
  icon: ReactNode;
  tone: "warning" | "danger";
  active?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const hot = (count ?? 0) > 0;
  const body = (
    <>
      <span
        className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", hot ? TONE[tone].chip : "bg-ink-900/[0.04] text-ink-400")}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5 text-xs font-medium leading-tight text-ink-700">
          <span>{label}</span>
          {hot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE[tone].dot)} aria-hidden="true" />}
        </span>
        <span className="hidden truncate text-[11px] text-ink-400 sm:block 2xl:hidden">{hint}</span>
      </span>
      <span className={cn("text-lg font-semibold tabular-nums", hot ? "text-ink-900" : "text-ink-300")}>{count === undefined ? "–" : formatCount(count)}</span>
      {href && <ChevronRight size={14} className="shrink-0 text-ink-300" aria-hidden="true" />}
    </>
  );
  const className = cn(
    "flex min-h-[52px] w-full items-center gap-2.5 rounded-xl border bg-surface px-3 py-2.5 transition-[border-color,box-shadow,background-color] duration-fast ease-smooth hover:border-line-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
    active ? "border-ink-900 ring-1 ring-ink-900" : "border-line-subtle",
  );
  if (href) {
    return (
      <Link href={href} className={className} title={hint}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={className} title={hint}>
      {body}
    </button>
  );
}

/**
 * The Orders workspace's operational summary: today's volume and realised sales (the metrics registry's numbers, same as
 * the dashboard), what is open, and the queues that need a person — each queue tile filters the list to exactly the
 * orders it counts (counts come from GET /api/orders/stats, through the list's own filter).
 */
export function OrdersSummary({
  stats,
  activeQueue,
  onSelectQueue,
}: {
  stats: OrderStats | undefined;
  activeQueue: OrderQueueId | null;
  onSelectQueue: (id: OrderQueueId) => void;
}) {
  return (
    <section aria-label="Operational summary" className="mb-5 space-y-3">
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line-subtle lg:grid-cols-4">
        {stats ? (
          <>
            <Metric label="Orders today" value={formatCount(stats.todayOrders)} icon={<ShoppingBag size={17} />} />
            <Metric label="Realised sales today" value={formatPrice(stats.todayRevenue)} hint="Net of returns & refunds" icon={<Wallet size={17} />} />
            <Metric label="Open orders" value={formatCount(stats.pending)} hint="Pending or confirmed" icon={<PackageOpen size={17} />} />
            <Metric label="Needs attention" value={formatCount(stats.needsAttention)} hint="Stuck, failed, held or refund owed" icon={<AlertTriangle size={17} />} />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 bg-surface px-5 py-4" aria-hidden="true">
              <div className="h-9 w-9 rounded-xl ui-skeleton" />
              <div className="space-y-1.5">
                <div className="h-3 w-20 rounded ui-skeleton" />
                <div className="h-5 w-14 rounded ui-skeleton" />
              </div>
            </div>
          ))
        )}
      </Card>

      <div role="group" aria-label="Work queues" className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6">
        {QUEUE_TILES.map((q) => (
          <QueueTile
            key={q.id}
            label={ORDER_QUEUE_LABELS[q.id]}
            hint={q.hint}
            icon={q.icon}
            tone={q.tone}
            count={stats?.queueCounts?.[q.id]}
            active={activeQueue === q.id}
            onClick={() => onSelectQueue(q.id)}
          />
        ))}
        <QueueTile
          label="Returns to review"
          hint="Return & exchange requests"
          icon={<RotateCcw size={16} />}
          tone="warning"
          count={stats?.returnRequestsPending}
          href="/admin/return-requests"
        />
      </div>
    </section>
  );
}
