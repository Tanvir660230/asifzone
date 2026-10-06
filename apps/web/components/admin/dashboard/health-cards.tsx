"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CreditCard, Truck, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { ProgressRing } from "@/components/ui/progress-ring";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as analyticsApi from "@/lib/api/admin-analytics";
import type { PaymentsOverview } from "@/lib/api/payments-admin";
import { formatPrice, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useProviderCapabilities } from "@/hooks/use-provider-capabilities";

function HealthCardShell({ title, icon, href, linkLabel, children }: { title: string; icon: ReactNode; href: string; linkLabel: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-4 sm:px-6">
        <h2 className="flex items-center gap-2 font-display text-lg tracking-tight text-ink-900">
          <span className="text-ink-400">{icon}</span>
          {title}
        </h2>
        <Link
          href={href}
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-ink-500 transition-colors duration-150 ease-smooth hover:text-ink-900"
        >
          {linkLabel} <ArrowUpRight size={14} />
        </Link>
      </div>
      <div className="flex-1 space-y-5 px-5 py-5 sm:px-6">{children}</div>
    </Card>
  );
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warning" }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums tracking-tight", tone === "warning" ? "text-warning-600" : "text-ink-900")}>
        {value}
      </p>
    </div>
  );
}

function HealthSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 shrink-0 rounded-full ui-skeleton" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded ui-skeleton" />
          <div className="h-3 w-44 rounded ui-skeleton" />
        </div>
      </div>
      <div className="h-10 rounded ui-skeleton" />
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = { SSLCOMMERZ: "SSLCommerz", EPS_PG: "EPS", COD: "COD" };
const providerLabel = (p: string) => PROVIDER_LABELS[p] ?? p;

/** Online-payment health for today: does checkout's gateway leg work, and what's gone wrong recently. */
export function PaymentsHealthCard({ data }: { data?: PaymentsOverview }) {
  return (
    <HealthCardShell title="Payments today" icon={<CreditCard size={17} />} href="/admin/payments/overview" linkLabel="Payments">
      {!data ? (
        <HealthSkeleton />
      ) : (
        <>
          <div className="flex items-center gap-4">
            {data.attemptsToday > 0 ? (
              <ProgressRing value={data.successRateTodayPct} size={64} strokeWidth={6} tone="threshold" label="Payment success rate today">
                <span className="text-sm font-semibold tabular-nums text-ink-900">{Math.round(data.successRateTodayPct)}%</span>
              </ProgressRing>
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-[6px] border-ink-100 text-xs font-semibold text-ink-400">
                —
              </div>
            )}
            <div className="min-w-0">
              <p className="font-medium text-ink-900">
                {data.attemptsToday > 0 ? "Success rate" : "No online payments yet today"}
              </p>
              <p className="text-sm text-ink-500">
                {data.attemptsToday} attempt{data.attemptsToday === 1 ? "" : "s"} · {data.activeSessionsCount} in progress
              </p>
              {data.attemptsTodayByProvider.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.attemptsTodayByProvider.map((p) => (
                    <span key={p.provider} className="rounded-full bg-ink-50 px-2 py-0.5 text-xs font-medium text-ink-600">
                      {providerLabel(p.provider)} · {p.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-line-subtle pt-4">
            <MiniStat label="Refunds this month" value={`${data.refundsThisMonthCount} · ${formatPrice(data.refundsThisMonthAmount)}`} />
            <MiniStat
              label="Cancelled but paid"
              value={String(data.cancelledButPaidCount)}
              tone={data.cancelledButPaidCount > 0 ? "warning" : "default"}
            />
          </div>

          {data.recentFailures.length > 0 && (
            <div className="border-t border-line-subtle pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Recent failures</p>
              <ul className="space-y-1.5">
                {data.recentFailures.slice(0, 3).map((f, i) => (
                  <li key={`${f.orderNumber}-${f.failedAt}-${i}`} className="flex items-center gap-2 text-sm">
                    <XCircle size={14} className="shrink-0 text-danger-500" />
                    <span className="truncate text-ink-700">{f.orderNumber ? `#${f.orderNumber}` : "Checkout session"}</span>
                    <span className="text-ink-400">· {providerLabel(f.provider)}</span>
                    <span className="ml-auto shrink-0 text-xs text-ink-400">{timeAgo(f.failedAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </HealthCardShell>
  );
}

// Steadfast delivery_status values, bucketed for a single stacked bar. Anything unlisted counts as "in transit".
const DELIVERED = new Set(["delivered", "partial_delivered", "delivered_approval_pending", "partial_delivered_approval_pending"]);
const FAILED = new Set(["cancelled", "cancelled_approval_pending"]);
const HOLD = new Set(["hold"]);

const SEGMENTS = [
  { key: "delivered", label: "Delivered", bar: "bg-success-500", dot: "bg-success-500" },
  { key: "transit", label: "In transit", bar: "bg-info-500", dot: "bg-info-500" },
  { key: "hold", label: "On hold", bar: "bg-warning-500", dot: "bg-warning-500" },
  { key: "failed", label: "Cancelled", bar: "bg-danger-500", dot: "bg-danger-500" },
] as const;

/** Courier side of fulfilment over 30 days: how many booked parcels actually arrive, plus the Steadfast wallet. */
export function CourierHealthCard({ courierLoss30d, enabled = true }: { courierLoss30d?: number; enabled?: boolean }) {
  const { courier: courierConfigured } = useProviderCapabilities(); // Phase 12 D-4
  const { data: perf } = useQuery({
    queryKey: ["analytics-courier-performance", 30],
    queryFn: () => analyticsApi.getCourierPerformance(30),
    enabled,
  });
  // Throws when Steadfast isn't configured for this store — a missing balance is a normal state, not an error.
  const { data: balance } = useQuery({
    queryKey: ["steadfast-balance"],
    queryFn: adminOrdersApi.getSteadfastBalance,
    retry: false,
    staleTime: 60_000,
    enabled: enabled && courierConfigured,
  });

  const buckets = { delivered: 0, transit: 0, hold: 0, failed: 0 };
  for (const row of perf?.byStatus ?? []) {
    const s = (row.status ?? "").toLowerCase();
    if (DELIVERED.has(s)) buckets.delivered += row.count;
    else if (FAILED.has(s)) buckets.failed += row.count;
    else if (HOLD.has(s)) buckets.hold += row.count;
    else buckets.transit += row.count;
  }
  const total = buckets.delivered + buckets.transit + buckets.hold + buckets.failed;
  const settled = buckets.delivered + buckets.failed;
  // Success rate over parcels whose outcome is known — counting in-transit ones would drag it down for no reason.
  const successPct = settled > 0 ? (buckets.delivered / settled) * 100 : null;

  return (
    <HealthCardShell title="Delivery (30d)" icon={<Truck size={17} />} href="/admin/orders?queue=courierIssue" linkLabel="Courier issues">
      {!perf ? (
        <HealthSkeleton />
      ) : (
        <>
          <div className="flex items-center gap-4">
            {successPct !== null ? (
              <ProgressRing value={successPct} size={64} strokeWidth={6} tone="threshold" label="Delivery success rate, last 30 days">
                <span className="text-sm font-semibold tabular-nums text-ink-900">{Math.round(successPct)}%</span>
              </ProgressRing>
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-[6px] border-ink-100 text-xs font-semibold text-ink-400">
                —
              </div>
            )}
            <div className="min-w-0">
              <p className="font-medium text-ink-900">{successPct !== null ? "Delivery success" : "No settled deliveries yet"}</p>
              <p className="text-sm text-ink-500">
                {total} parcel{total === 1 ? "" : "s"} booked · {buckets.transit} on the way
              </p>
            </div>
          </div>

          {total > 0 && (
            <div>
              <div className="flex h-2 overflow-hidden rounded-full bg-ink-100" role="img" aria-label="Courier outcomes">
                {SEGMENTS.map((seg) =>
                  buckets[seg.key] > 0 ? (
                    <div key={seg.key} className={seg.bar} style={{ width: `${(buckets[seg.key] / total) * 100}%` }} />
                  ) : null,
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                {SEGMENTS.map((seg) => (
                  <span key={seg.key} className="flex items-center gap-1.5 text-xs text-ink-500">
                    <span className={cn("h-2 w-2 rounded-full", seg.dot)} />
                    {seg.label} <span className="font-semibold tabular-nums text-ink-700">{buckets[seg.key]}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 border-t border-line-subtle pt-4">
            {balance ? <MiniStat label="Steadfast balance" value={formatPrice(balance.balance)} /> : <MiniStat label="Steadfast balance" value="—" />}
            <MiniStat
              label="Cancellation loss"
              value={formatPrice(courierLoss30d ?? perf.totalLoss)}
              tone={(courierLoss30d ?? perf.totalLoss) > 0 ? "warning" : "default"}
            />
          </div>
        </>
      )}
    </HealthCardShell>
  );
}
