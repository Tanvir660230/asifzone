"use client";

import Link from "next/link";
import {
  AlertOctagon,
  Banknote,
  Copy,
  FlaskConical,
  ClipboardCheck,
  BookOpen,
  Bug,
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
import type { FinanceAlert } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";

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
  /** Finance alerts (docs/FINANCE_ALERTS.md) by severity — only for roles that read the books. */
  financeAlerts?: { critical: number; warning: number };
  /** The alerts themselves: critical ones and the courier's unpaid parcels get a row of their own, by name. */
  financeAlertList?: FinanceAlert[];
  /** Open errors from the last 24 h (Site health) — only for roles with ops.read. */
  openErrors?: number;
  /** Receipts flagged as a possible duplicate, not explained (blueprint P0.3) — only for roles that read purchasing. */
  possibleDuplicatePurchases?: number;
  /** Stock work waiting on a person — only for roles that read stock. */
  stockWaiting?: { countLossesToApprove: number; fillFailures: number };
  /** Parcels cancelled after shipping still out with the courier (P1.5). */
  parcelsToReceive?: { total: number; overdue: number; followUpDays: number };
  loading: boolean;
}

/** Everything waiting on an admin, as a to-do list: only non-zero items show, most urgent first, each one a link straight
 * to the filtered list where it gets done. An empty list is the goal — it renders as an explicit "all clear". */
export function ActionCenter({ orderStats, payments, pendingReviews, unreadFeedback, lowStockCount, financeAlerts, financeAlertList, openErrors, possibleDuplicatePurchases, stockWaiting, parcelsToReceive, loading }: ActionCenterProps) {
  const q = orderStats?.queueCounts;
  // The overview's failure list reaches back weeks; only the last day's are still worth chasing.
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const freshFailures = payments?.recentFailures.filter((f) => new Date(f.failedAt).getTime() >= dayAgo).length ?? 0;
  // Every finance alert is a row of its own with its own link (blueprint P1.2: Home shows every existing alert type — none
  // is folded away), most urgent first by the alert's own severity.
  const financeRows: ActionItem[] = (financeAlertList ?? []).map((a) => ({
    key: `finance-${a.key}`,
    label: a.amount ? `${a.title} · ${formatPrice(Math.round(a.amount))}` : a.title,
    hint: a.action,
    count: Math.max(1, a.count),
    href: a.href,
    severity: a.severity,
    icon: a.key === "courier.unpaid" ? Truck : BookOpen,
  }));
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
      key: "site-errors",
      label: "Site errors (24h)",
      hint: "Something broke on the server or in a visitor's browser",
      count: openErrors ?? 0,
      href: "/admin/system-health#errors",
      severity: "warning",
      icon: Bug,
    },
    {
      // Owner decision Q6: a COD order still unconfirmed after 48 h — reviewed by a person; nothing is released automatically
      key: "cod-pending-48h",
      label: "COD orders pending over 48 h",
      hint: "Review each order — confirm, call or cancel; stock stays held until you decide",
      count: q?.codPendingStale ?? 0,
      href: "/admin/orders?queue=codPendingStale",
      severity: "warning",
      icon: Banknote,
    },
    {
      // Owner decision Q-B: past the store's follow-up days (14 by default) a parcel still out is a follow-up
      key: "parcels-to-receive",
      label: parcelsToReceive?.overdue ? `Parcels out over ${parcelsToReceive.followUpDays} days` : "Parcels to receive",
      hint: "Cancelled after shipping — receive each parcel on its order when it is back",
      count: parcelsToReceive?.overdue || parcelsToReceive?.total || 0,
      href: "/admin/return-requests?tab=parcels",
      severity: parcelsToReceive?.overdue ? "warning" : "info",
      icon: PackageX,
    },
    {
      key: "duplicate-purchases",
      label: "Possible duplicate purchases",
      hint: "Received goods that look like a purchase already entered — check before paying twice",
      count: possibleDuplicatePurchases ?? 0,
      href: "/admin/finance/goods-receipts",
      severity: "warning",
      icon: Copy,
    },
    {
      key: "count-losses",
      label: "Count losses to approve",
      hint: "A count found less than the books — approve or reject the write-off",
      count: stockWaiting?.countLossesToApprove ?? 0,
      href: "/admin/stock",
      severity: "warning",
      icon: ClipboardCheck,
    },
    {
      key: "fill-failures",
      label: "Bottles not filled at booking",
      hint: "A booked parcel's bottles are still owed — try the fill again",
      count: stockWaiting?.fillFailures ?? 0,
      href: "/admin/stock",
      severity: "warning",
      icon: FlaskConical,
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
      label: "Orders waiting",
      hint: "Pending or confirmed, not packed yet",
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
    // Without the list (still loading, or an older API), fall back to the counts.
    ...(financeAlertList
      ? financeRows
      : [
          { key: "finance-critical", label: "Finance problems", hint: "Postings that failed, checks that differ or cash forecast below zero", count: financeAlerts?.critical ?? 0, href: "/admin/finance/attention", severity: "critical" as const, icon: BookOpen },
          { key: "finance-todo", label: "Finance to-dos", hint: "Approvals, bills and costs due, months to close", count: financeAlerts?.warning ?? 0, href: "/admin/finance/attention", severity: "warning" as const, icon: BookOpen },
        ]),
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
