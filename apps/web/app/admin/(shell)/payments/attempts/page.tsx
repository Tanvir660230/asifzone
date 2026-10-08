"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import type { PaymentSessionRow } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { FilterBar, useFilterState } from "@/components/admin/filters";
import type { FilterDefinition } from "@/lib/admin/filters";
import * as paymentsApi from "@/lib/api/payments-admin";
import { PAYMENT_PROVIDER_LABEL, formatCount, formatPrice, formatStoreDateTime } from "@/lib/format";

const STATUS: Record<PaymentSessionRow["status"], { label: string; variant: "success" | "danger" | "warning" | "neutral" }> = {
  ACTIVE: { label: "Waiting for payment", variant: "warning" },
  SUCCEEDED: { label: "Paid", variant: "success" },
  FAILED: { label: "Failed", variant: "danger" },
  CANCELLED: { label: "Cancelled", variant: "neutral" },
  EXPIRED: { label: "Expired", variant: "neutral" },
};

const SOURCE: Record<PaymentSessionRow["source"], string> = {
  checkout: "Storefront checkout",
  order: "Payment for an order",
  payment_link: "Payment link",
  modification: "Order change",
};

const FILTERS: readonly FilterDefinition[] = [
  {
    key: "f.status",
    label: "Result",
    kind: "select",
    placement: "quick",
    options: (Object.keys(STATUS) as Array<PaymentSessionRow["status"]>).map((s) => ({ value: s, label: STATUS[s].label })),
  },
  {
    key: "f.provider",
    label: "Gateway",
    kind: "select",
    options: [
      { value: "SSLCOMMERZ", label: PAYMENT_PROVIDER_LABEL.SSLCOMMERZ },
      { value: "EPS_PG", label: PAYMENT_PROVIDER_LABEL.EPS_PG },
    ],
    chip: (label) => `Gateway: ${label}`,
  },
  { key: "from", label: "Started from", kind: "date", chip: (label) => `From ${label}` },
  { key: "to", label: "Started to", kind: "date", chip: (label) => `To ${label}` },
];

/** Finance › Online attempts (Blueprint V2 P5): every gateway checkout — including the storefront ones that failed or
 * were abandoned before an order existed — for "I paid but there's no order" questions. Read-only. */
export default function PaymentAttemptsPage() {
  const filters = useFilterState(FILTERS, { pageSizes: [20, 50, 100], defaultPageSize: 50 });
  const { values } = filters;
  const params = {
    page: values.page,
    pageSize: values.size,
    search: values.q || undefined,
    status: ((values["f.status"] as string) || undefined) as PaymentSessionRow["status"] | undefined,
    provider: ((values["f.provider"] as string) || undefined) as PaymentSessionRow["provider"] | undefined,
    from: (values.from as string) || undefined,
    to: (values.to as string) || undefined,
  };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["payment-sessions", params],
    queryFn: ({ signal }) => paymentsApi.listPaymentSessions(params, { signal }),
    placeholderData: (prev) => prev,
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Online attempts" description="Every online checkout with SSLCommerz or EPS — paid, failed or abandoned — even when no order was created." />
      <ModuleTabs />
      <div className="space-y-3">
        <FilterBar
          defs={FILTERS}
          values={values}
          onChange={filters.setFilters}
          search={filters.search}
          onSearchChange={filters.setSearch}
          searchPlaceholder="Phone, order #, gateway reference…"
          onClearAll={filters.clearAll}
        />
        <TableContainer>
          <Table aria-label="Online payment attempts">
            <TableHead>
              <tr>
                <TableHeaderCell>Started</TableHeaderCell>
                <TableHeaderCell>Customer</TableHeaderCell>
                <TableHeaderCell>Gateway</TableHeaderCell>
                <TableHeaderCell>Result</TableHeaderCell>
                <TableHeaderCell>Gateway said</TableHeaderCell>
                <TableHeaderCell align="right">Amount</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {isLoading && !data && <TableSkeleton rows={8} cols={6} />}
              {isError && !data && (
                <TableMessageRow colSpan={6}>
                  <ErrorState onRetry={() => refetch()} />
                </TableMessageRow>
              )}
              {data && data.items.length === 0 && (
                <TableMessageRow colSpan={6}>
                  <EmptyState icon={CreditCard} title="No attempts match" description="Search a phone number, an order number or the gateway's reference." />
                </TableMessageRow>
              )}
              {data?.items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap text-fg-muted">{formatStoreDateTime(s.createdAt)}</TableCell>
                  <TableCell>
                    <span className="block font-medium text-fg">{s.customerName ?? "—"}</span>
                    <span className="block text-xs text-fg-subtle">
                      {s.customerPhone ?? "—"} ·{" "}
                      {s.order ? (
                        <Link href={`/admin/orders/${s.order.id}`} className="text-accent hover:underline">
                          {s.order.orderNumber}
                        </Link>
                      ) : (
                        "no order"
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block whitespace-nowrap">{PAYMENT_PROVIDER_LABEL[s.provider]}</span>
                    <span className="block text-xs text-fg-subtle">{SOURCE[s.source]}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS[s.status].variant} dot>
                      {STATUS[s.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <span className="block truncate text-fg-muted" title={s.lastEvent?.note ?? s.lastEvent?.type ?? undefined}>
                      {s.lastEvent ? (s.lastEvent.note ?? s.lastEvent.type) : "—"}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-fg-subtle" title={s.gatewayRef}>
                      {s.gatewayRef}
                    </span>
                  </TableCell>
                  <TableCell align="right" className="font-semibold text-fg">
                    {s.amount !== null ? formatPrice(s.amount) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </TableContainer>
        {data && data.total > data.pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
            <span className="tabular-nums">{formatCount(data.total)} attempts</span>
            <Pagination page={values.page} totalPages={totalPages} onChange={filters.setPage} className="mt-0" />
          </div>
        )}
      </div>
    </div>
  );
}
