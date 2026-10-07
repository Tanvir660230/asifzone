"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { ErrorState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { useCapability } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as opsApi from "@/lib/api/ops";
import { formatCount, formatStoreDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const reliabilityKey = ["ops-reliability"] as const;

interface Check {
  key: string;
  title: string;
  /** What this check looks at, in the owner's words. */
  what: string;
  count: number;
  /** One line under the title when there is something to look at. */
  summary?: string;
  /** How to put it right. */
  fix?: string;
  items?: ReactNode;
}

function CheckRow({ check }: { check: Check }) {
  const ok = check.count === 0;
  const head = (
    <div className="flex items-start gap-3 px-5 py-4">
      {ok ? (
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success-600" aria-hidden="true" />
      ) : (
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning-600" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-fg">{check.title}</p>
        <p className="mt-0.5 text-[13px] text-fg-muted">{ok ? check.what : (check.summary ?? check.what)}</p>
      </div>
      <span className={cn("shrink-0 text-[13px] tabular-nums", ok ? "text-fg-subtle" : "font-semibold text-warning-700")}>{ok ? "OK" : formatCount(check.count)}</span>
      {!ok && <ChevronRight size={16} className="mt-0.5 shrink-0 text-fg-subtle transition-transform duration-fast group-open:rotate-90" aria-hidden="true" />}
    </div>
  );
  if (ok) return <li>{head}</li>;
  return (
    <li>
      <details className="group">
        <summary className="cursor-pointer list-none rounded-xl hover:bg-ink-900/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">{head}</summary>
        <div className="space-y-3 px-5 pb-5 pl-[52px]">
          {check.fix && (
            <p className="text-[13px] text-fg">
              <span className="font-medium">How to fix: </span>
              {check.fix}
            </p>
          )}
          {check.items}
        </div>
      </details>
    </li>
  );
}

function ItemTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <tr>
            {head.map((h, i) => (
              <TableHeaderCell key={i}>{h}</TableHeaderCell>
            ))}
          </tr>
        </TableHead>
        <tbody>
          {rows.map((cells, i) => (
            <TableRow key={i}>
              {cells.map((c, j) => (
                <TableCell key={j} className="align-top">
                  {c}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </tbody>
      </Table>
    </TableContainer>
  );
}

const orderLink = (id: string, number: string) => (
  <Link href={`/admin/orders/${id}`} className="font-medium text-accent hover:underline">
    {number}
  </Link>
);

/** Administration › System health (Admin V2): the reliability report — background jobs and the consistency checks that
 * compare stored numbers with their ledgers. Read-only; each finding says how it is put right. */
export default function SystemHealthPage() {
  const canRepair = useCapability("ops.repair");
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: reliabilityKey,
    queryFn: opsApi.getReliabilityReport,
    refetchInterval: 60_000,
  });
  const retry = useMutation({
    mutationFn: opsApi.retryOutboxEvent,
    onSuccess: () => {
      toast.success("Queued again");
      queryClient.invalidateQueries({ queryKey: reliabilityKey });
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't retry")),
  });

  const s = data?.sections;
  const checks: Check[] = s
    ? [
        {
          key: "outbox",
          title: "Background jobs",
          what: "SMS, email, courier and tracking jobs are being delivered.",
          count: s.outbox.failed + (s.outbox.dispatcherHealthy ? 0 : 1),
          summary: [
            s.outbox.failed ? `${formatCount(s.outbox.failed)} failed` : null,
            s.outbox.dispatcherHealthy ? null : "the job runner hasn't checked in for over a minute",
            s.outbox.undelivered ? `${formatCount(s.outbox.undelivered)} waiting` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          fix: s.outbox.dispatcherHealthy
            ? "Retry a failed job once its cause is fixed (e.g. SMS credit topped up). Jobs are safe to run twice."
            : "The job runner isn't running — restart the API service.",
          items: s.outbox.recentFailures.length ? (
            <ItemTable
              head={["Job", "Attempts", "Last error", ""]}
              rows={s.outbox.recentFailures.map((f) => [
                <span key="j">
                  {f.eventType} <span className="text-fg-subtle">→ {f.consumer}</span>
                </span>,
                f.attempts,
                <span key="e" className="line-clamp-2 text-fg-muted">
                  {f.lastError ?? "—"}
                </span>,
                canRepair ? (
                  <Button key="r" size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(f.id)}>
                    Retry
                  </Button>
                ) : null,
              ])}
            />
          ) : undefined,
        },
        {
          key: "courier",
          title: "Courier bookings",
          what: "No booking is stuck between the store and Steadfast.",
          count: s.courierBookings.count,
          summary: `${formatCount(s.courierBookings.count)} booking${s.courierBookings.count === 1 ? "" : "s"} didn't finish${s.courierBookings.outcomeUnknown ? ` · ${formatCount(s.courierBookings.outcomeUnknown)} with an unknown outcome` : ""}`,
          fix: "Open the order. If the outcome is unknown, look the order up in the Steadfast portal before booking again — it may already have a consignment.",
          items: (
            <ItemTable
              head={["Order", "Started", "Status"]}
              rows={s.courierBookings.items.map((c) => [
                orderLink(c.orderId, c.orderNumber),
                formatStoreDateTime(c.startedAt),
                c.outcomeUnknown ? "Outcome unknown — check Steadfast first" : c.safeToRetry ? "Safe to book again" : "Still in progress",
              ])}
            />
          ),
        },
        {
          key: "payments",
          title: "Payment status",
          what: "Every order's payment status matches its payments and refunds.",
          count: s.paymentLedgerDrift.count + s.paymentLedgerDrift.violations,
          summary: `${formatCount(s.paymentLedgerDrift.count)} order${s.paymentLedgerDrift.count === 1 ? "" : "s"} show a different payment status than their payments add up to`,
          fix: "Run the payment reconcile job (it previews every change before applying it).",
          items: s.paymentLedgerDrift.items.length ? (
            <ItemTable head={["Order", "Shows", "Payments say"]} rows={s.paymentLedgerDrift.items.map((d) => [orderLink(d.orderId, d.orderNumber), d.stored, d.derived])} />
          ) : undefined,
        },
        {
          key: "stock",
          title: "Stock",
          what: "Every variant's stock equals the sum of its stock movements.",
          count: s.stockDrift.count,
          summary: `${formatCount(s.stockDrift.count)} variant${s.stockDrift.count === 1 ? "" : "s"} where stock and the movement history disagree`,
          fix: "Count the shelf, then correct the stock with an adjustment and a reason. Never corrected automatically.",
          items: (
            <ItemTable
              head={["Variant", "Stock", "Movements add up to", ""]}
              rows={s.stockDrift.items.map((v) => [
                <span key="v">
                  {v.productName} <span className="font-mono text-xs text-fg-subtle">{v.sku}</span>
                </span>,
                v.currentStock,
                v.ledgerSum,
                <Link key="l" href={`/admin/inventory?tab=movements&variantId=${v.variantId}`} className="whitespace-nowrap text-accent hover:underline">
                  Movements
                </Link>,
              ])}
            />
          ),
        },
        {
          key: "storefront",
          title: "Storefront prices and badges",
          what: "The storefront's cached prices and sale badges match the catalogue.",
          count: s.readModelDrift.count,
          summary: `${formatCount(s.readModelDrift.count)} product${s.readModelDrift.count === 1 ? "" : "s"} out of date on the storefront`,
          fix: "Nothing to do — rebuilt automatically every 15 minutes.",
          items: (
            <ItemTable
              head={["Product", "Field", "Shows", "Should be"]}
              rows={s.readModelDrift.items.map((r) => [
                <Link key="p" href={`/admin/products/${r.productId}/edit`} className="text-accent hover:underline">
                  Open product
                </Link>,
                r.issue,
                r.stored ?? "—",
                r.expected,
              ])}
            />
          ),
        },
        {
          key: "loyalty",
          title: "Reward points",
          what: "Every customer's points balance equals their points history.",
          count: s.loyaltyDrift.count,
          summary: `${formatCount(s.loyaltyDrift.count)} customer${s.loyaltyDrift.count === 1 ? "" : "s"} whose balance and history disagree`,
          fix: "Open the customer and make a points adjustment with a note explaining it.",
          items: (
            <ItemTable
              head={["Customer", "Balance", "History adds up to"]}
              rows={s.loyaltyDrift.items.map((c) => [
                <Link key="c" href={`/admin/customers/${c.customerId}`} className="font-medium text-accent hover:underline">
                  {c.name}
                </Link>,
                c.balance,
                c.ledgerSum,
              ])}
            />
          ),
        },
        {
          key: "campaigns",
          title: "SMS campaigns",
          what: "No campaign is stuck while sending.",
          count: s.stuckCampaigns.count,
          summary: `${formatCount(s.stuckCampaigns.count)} campaign${s.stuckCampaigns.count === 1 ? "" : "s"} stopped part-way`,
          fix: "Open the campaign and check its recipients before sending again.",
          items: (
            <ItemTable
              head={["Campaign", "Last progress"]}
              rows={s.stuckCampaigns.items.map((c) => [
                <Link key="c" href="/admin/campaigns" className="text-accent hover:underline">
                  {c.name}
                </Link>,
                formatStoreDateTime(c.updatedAt),
              ])}
            />
          ),
        },
      ]
    : [];
  const attention = checks.filter((c) => c.count > 0).length;

  return (
    <div>
      <PageHeader
        title="System health"
        description="Background jobs and the checks that compare stored numbers with their history. Refreshed every minute."
        action={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={16} className={cn(isFetching && "animate-spin")} aria-hidden="true" /> Check now
          </Button>
        }
      />
      <ModuleTabs />
      {isError && !data && <ErrorState onRetry={() => refetch()} />}
      {isLoading && !data && <div className="h-96 animate-pulse rounded-2xl bg-ink-900/[0.04]" aria-busy="true" aria-label="Loading" />}
      {data && (
        <div className="space-y-4">
          <div className={cn("flex items-center gap-3 rounded-2xl px-5 py-4", attention ? "bg-warning-50" : "bg-success-50")}>
            {attention ? <AlertTriangle size={22} className="text-warning-600" aria-hidden="true" /> : <CheckCircle2 size={22} className="text-success-600" aria-hidden="true" />}
            <div>
              <p className="text-[15px] font-semibold text-fg">{attention ? `${attention} check${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} a look` : "Everything is running normally"}</p>
              <p className="text-[13px] text-fg-muted">Checked {timeAgo(data.generatedAt)}</p>
            </div>
          </div>
          <ul className="divide-y divide-line-subtle overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
            {checks.map((c) => (
              <CheckRow key={c.key} check={c} />
            ))}
          </ul>
          <p className="text-[13px] text-fg-muted">
            Payment, SMS, email and courier connections are under{" "}
            <Link href="/admin/settings" className="text-accent hover:underline">
              Settings
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
