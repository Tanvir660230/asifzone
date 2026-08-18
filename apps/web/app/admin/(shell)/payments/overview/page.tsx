"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCcw, Search, ShieldAlert, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import * as paymentsAdminApi from "@/lib/api/payments-admin";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatPrice } from "@/lib/format";

const SESSION_STATUS_BADGE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  SUCCEEDED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
  ACTIVE: "warning",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function PaymentsOverviewPage() {
  const { data: overview, isLoading } = useQuery({
    queryKey: ["payments-overview"],
    queryFn: paymentsAdminApi.getPaymentsOverview,
    refetchInterval: 60_000,
  });

  // Support's "a customer called saying their payment failed" lookup — searches every payment
  // attempt for this phone number, including ones that never became an Order (a failed/cancelled
  // pre-order digital-payment checkout only leaves a PaymentSession/Payment trail, see
  // payments-overview.service.ts's searchPaymentAttempts).
  const [phoneInput, setPhoneInput] = useState("");
  const debouncedPhone = useDebouncedValue(phoneInput, 350);
  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ["payment-attempt-search", debouncedPhone],
    queryFn: () => paymentsAdminApi.searchPaymentAttempts(debouncedPhone),
    enabled: debouncedPhone.trim().length >= 4,
  });
  const searchResults = debouncedPhone.trim().length >= 4 ? (searchData?.results ?? []) : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Payments</h1>
        <p className="mt-1 text-sm text-ink-500">
          EPS and SSLCommerz attempts, the reconciliation queue, and refund-risk signals — updated roughly every minute.
        </p>
      </div>

      {/* Customer lookup */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
          Look Up a Customer&apos;s Payment Attempts
        </h2>
        <Card className="p-4">
          <div className="relative max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="Search by phone number (01XXXXXXXXX)…"
              className="pl-9"
            />
          </div>
          <p className="mt-2 text-xs text-ink-400">
            Covers attempts that never became an order too — a failed or abandoned gateway checkout still
            leaves a record here, keyed on the phone number entered at checkout.
          </p>

          {debouncedPhone.trim().length >= 4 && (
            <div className="mt-4 divide-y divide-ink-100 border-t border-ink-100">
              {searching ? (
                <p className="py-4 text-sm text-ink-400">Searching…</p>
              ) : searchResults.length === 0 ? (
                <p className="py-4 text-sm text-ink-400">No payment attempts found for that number.</p>
              ) : (
                searchResults.map((r) => (
                  <div key={r.sessionId} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Badge variant={SESSION_STATUS_BADGE[r.status] ?? "neutral"}>{r.status}</Badge>
                      <span className="font-medium text-ink-900">{r.customerName || "Unknown customer"}</span>
                      <span className="text-ink-400">{r.customerPhone}</span>
                      <span className="text-ink-400">{r.provider}</span>
                      <span className="text-ink-600">{formatPrice(r.amount)}</span>
                      {r.orderNumber ? (
                        <Link
                          href={`/admin/orders?search=${r.orderNumber}`}
                          className="font-medium text-brass-600 hover:underline"
                        >
                          {r.orderNumber}
                        </Link>
                      ) : (
                        <span className="text-ink-400">No order created</span>
                      )}
                      {r.lastEventNote && <span className="text-xs text-ink-400">— {r.lastEventNote}</span>}
                    </div>
                    <span className="shrink-0 text-xs text-ink-400">{timeAgo(r.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </Card>
      </section>

      {/* Today */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Today</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {isLoading || !overview ? (
            Array.from({ length: 4 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile
                label="Payment Attempts"
                value={overview.attemptsToday.toLocaleString("en-BD")}
                icon={<Activity size={18} />}
              />
              <StatTile
                label="Success Rate"
                value={`${overview.successRateTodayPct.toFixed(1)}%`}
                icon={<CheckCircle2 size={18} />}
                tone={overview.successRateTodayPct < 80 && overview.attemptsToday > 0 ? "warning" : "accent"}
              />
              <StatTile
                label="Active Sessions"
                value={overview.activeSessionsCount.toLocaleString("en-BD")}
                icon={<Clock size={18} />}
              />
              <StatTile
                label="EPS Reconciliation Queue"
                value={overview.epsReconciliationQueueDepth.toLocaleString("en-BD")}
                icon={<RefreshCcw size={18} />}
                tone={overview.epsReconciliationQueueDepth > 0 ? "warning" : "default"}
              />
            </>
          )}
        </div>
        {overview && (
          <p className="mt-2 text-xs text-ink-400">
            {overview.attemptsTodayByProvider.length === 0
              ? "No payment attempts yet today."
              : overview.attemptsTodayByProvider.map((g) => `${g.provider}: ${g.count}`).join(" · ")}
            {" — EPS Reconciliation Queue is what the next 5-minute sweep is about to work through, not a backlog it's fallen behind on."}
          </p>
        )}
      </section>

      {/* Risk */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Refund Risk</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {isLoading || !overview ? (
            Array.from({ length: 2 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <Link href="/admin/orders?cancelledButPaid=true">
                <StatTile
                  label="Cancelled but Paid"
                  value={overview.cancelledButPaidCount.toLocaleString("en-BD")}
                  icon={<ShieldAlert size={18} />}
                  tone={overview.cancelledButPaidCount > 0 ? "warning" : "default"}
                />
              </Link>
              <StatTile
                label="Refunds This Month"
                value={`${formatPrice(overview.refundsThisMonthAmount)} · ${overview.refundsThisMonthCount}`}
                icon={<Undo2 size={18} />}
              />
            </>
          )}
        </div>
      </section>

      {/* Recent failures */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Recent Failures</h2>
        <Card className="divide-y divide-ink-100">
          {isLoading || !overview ? (
            <p className="p-5 text-sm text-ink-400">Loading…</p>
          ) : overview.recentFailures.length === 0 ? (
            <p className="p-5 text-sm text-ink-400">No failed payments recently.</p>
          ) : (
            overview.recentFailures.map((f, i) => (
              <div key={i} className="flex items-center justify-between gap-4 p-4 text-sm">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle size={16} className="shrink-0 text-danger-500" />
                  {f.orderNumber ? (
                    <Link href={`/admin/orders?search=${f.orderNumber}`} className="font-medium text-ink-900 hover:underline">
                      {f.orderNumber}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink-400">No order created</span>
                  )}
                  <span className="text-ink-400">{f.provider}</span>
                </div>
                <span className="text-xs text-ink-400">{timeAgo(f.failedAt)}</span>
              </div>
            ))
          )}
        </Card>
      </section>
    </div>
  );
}
