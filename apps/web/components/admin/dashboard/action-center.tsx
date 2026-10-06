"use client";

import Link from "next/link";
import {
  AlertOctagon,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  MessageSquare,
  PackageX,
  PhoneCall,
  RotateCcw,
  Star,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { OrderStats } from "@/lib/api/admin-orders";
import type { PaymentsOverview } from "@/lib/api/payments-admin";

type Severity = "critical" | "warning" | "info";

interface ActionItem {
  key: string;
  label: string;
  /** One line on what doing it means — the item should read as a task, not a metric. */
  hint: string;
  count: number;
  href: string;
  severity: Severity;
  icon: LucideIcon;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

const SEVERITY_STYLE: Record<Severity, { chip: string; count: string; bar: string }> = {
  critical: { chip: "bg-danger-50 text-danger-600", count: "bg-danger-600 text-white", bar: "bg-danger-500" },
  warning: { chip: "bg-warning-50 text-warning-600", count: "bg-warning-100 text-warning-700", bar: "bg-warning-500" },
  info: { chip: "bg-info-50 text-info-600", count: "bg-ink-100 text-ink-700", bar: "bg-info-500" },
};

interface ActionCenterProps {
  orderStats?: OrderStats;
  payments?: PaymentsOverview;
  pendingReviews?: number;
  unreadFeedback?: number;
  lowStockCount?: number;
  loading: boolean;
}

/** Everything waiting on an admin, as a to-do list: only non-zero items show, most urgent first, each one a link straight
 * to the filtered list where it gets done. An empty list is the goal — it renders as an explicit "all clear". */
export function ActionCenter({ orderStats, payments, pendingReviews, unreadFeedback, lowStockCount, loading }: ActionCenterProps) {
  const q = orderStats?.queueCounts;
  // The overview's failure list reaches back weeks; only the last day's are still worth chasing.
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const freshFailures = payments?.recentFailures.filter((f) => new Date(f.failedAt).getTime() >= dayAgo).length ?? 0;
  const candidates: ActionItem[] = [
    {
      key: "cancelled-paid",
      label: "Cancelled but paid",
      hint: "Money was collected on a cancelled order — refund it",
      count: orderStats?.cancelledButPaidCount ?? 0,
      href: "/admin/orders?queue=cancelledButPaid",
      severity: "critical",
      icon: AlertOctagon,
    },
    {
      key: "refund-due",
      label: "Returned · refund due",
      hint: "Returned parcels still holding the customer's money",
      count: q?.refundDue ?? 0,
      href: "/admin/orders?queue=refundDue",
      severity: "critical",
      icon: Undo2,
    },
    {
      key: "payment-failures",
      label: "Failed payments (24h)",
      hint: "Gateway failures today — check whether the customer retried",
      count: freshFailures,
      href: "/admin/payments/overview",
      severity: "critical",
      icon: CreditCard,
    },
    {
      key: "follow-up",
      label: "Follow-up calls due",
      hint: "Pending orders whose confirmation call is due now",
      count: orderStats?.followUpDue ?? 0,
      href: "/admin/orders?queue=followUpDue",
      severity: "warning",
      icon: PhoneCall,
    },
    {
      key: "courier-issue",
      label: "Courier issues",
      hint: "On hold with the courier or failing to sync",
      count: q?.courierIssue ?? 0,
      href: "/admin/orders?queue=courierIssue",
      severity: "warning",
      icon: Truck,
    },
    {
      key: "returns",
      label: "Return requests",
      hint: "Returns & exchanges waiting for a decision",
      count: orderStats?.returnRequestsPending ?? 0,
      href: "/admin/return-requests",
      severity: "warning",
      icon: RotateCcw,
    },
    {
      key: "eps-queue",
      label: "Payments to reconcile",
      hint: "Gateway sessions awaiting reconciliation",
      count: payments?.epsReconciliationQueueDepth ?? 0,
      href: "/admin/payments/overview",
      severity: "warning",
      icon: CreditCard,
    },
    {
      key: "pending",
      label: "Orders to confirm",
      hint: "Pending or confirmed, not yet moving",
      count: orderStats?.pending ?? 0,
      href: "/admin/orders?status=PENDING,CONFIRMED",
      severity: "info",
      icon: Clock,
    },
    {
      key: "low-stock",
      label: "Low-stock items",
      hint: "Variants at or below their reorder level",
      count: lowStockCount ?? 0,
      href: "/admin/inventory",
      severity: "info",
      icon: PackageX,
    },
    {
      key: "reviews",
      label: "Reviews to moderate",
      hint: "New product reviews waiting for approval",
      count: pendingReviews ?? 0,
      href: "/admin/reviews",
      severity: "info",
      icon: Star,
    },
    {
      key: "feedback",
      label: "Unread messages",
      hint: "Customer feedback nobody has opened yet",
      count: unreadFeedback ?? 0,
      href: "/admin/feedback",
      severity: "info",
      icon: MessageSquare,
    },
  ];

  const items = candidates.filter((i) => i.count > 0).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const urgent = items.filter((i) => i.severity === "critical").length;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-lg tracking-tight text-ink-900">Needs your attention</h2>
          {!loading && items.length > 0 && (
            <span className="rounded-full bg-ink-900 px-2 py-0.5 text-xs font-semibold tabular-nums text-cream-50">{items.length}</span>
          )}
        </div>
        {!loading && urgent > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-danger-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-danger-500" />
            </span>
            {urgent} urgent
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-px bg-line-subtle md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 bg-surface px-5 py-4">
              <div className="h-9 w-9 shrink-0 rounded-xl ui-skeleton" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-32 rounded ui-skeleton" />
                <div className="h-3 w-48 rounded ui-skeleton" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-4 px-5 py-6 sm:px-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-success-50 text-success-600">
            <CheckCircle2 size={22} />
          </div>
          <div>
            <p className="font-medium text-ink-900">All clear</p>
            <p className="text-sm text-ink-500">Nothing is waiting on you right now — no refunds, calls, returns or messages pending.</p>
          </div>
        </div>
      ) : (
        // gap-px over a tinted background draws hairline dividers between cells in any column count.
        <ul className={cn("grid grid-cols-1 gap-px bg-line-subtle", items.length > 1 && "md:grid-cols-2")}>
          {items.map((item) => {
            const style = SEVERITY_STYLE[item.severity];
            const Icon = item.icon;
            return (
              // An odd last item spans both columns so the grid never ends on an empty tinted cell.
              <li key={item.key} className="bg-surface md:[&:last-child:nth-child(odd)]:col-span-2">
                <Link
                  href={item.href}
                  className="group relative flex h-full items-center gap-3.5 px-5 py-3.5 transition-colors duration-150 ease-smooth hover:bg-ink-50/70 focus-visible:bg-ink-50 focus-visible:outline-none sm:px-6"
                >
                  <span aria-hidden className={cn("absolute inset-y-3 left-0 w-[3px] rounded-r-full", style.bar)} />
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", style.chip)}>
                    <Icon size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">{item.label}</span>
                    <span className="block truncate text-xs text-ink-500">{item.hint}</span>
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums", style.count)}>
                    {item.count}
                  </span>
                  <ChevronRight
                    size={16}
                    aria-hidden
                    className="shrink-0 text-ink-300 transition-transform duration-150 ease-smooth group-hover:translate-x-0.5 group-hover:text-ink-500"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
