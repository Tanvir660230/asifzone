"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { FilterBar, useFilterState } from "@/components/admin/filters";
import type { FilterDefinition } from "@/lib/admin/filters";
import { cn } from "@/lib/utils";
import * as paymentsApi from "@/lib/api/payments-admin";
import { PAYMENT_PROVIDER_LABEL, formatCount, formatPrice, formatStoreDateTime } from "@/lib/format";

const FILTERS: readonly FilterDefinition[] = [
  {
    key: "f.provider",
    label: "Method",
    kind: "select",
    placement: "quick",
    options: (Object.keys(PAYMENT_PROVIDER_LABEL) as Array<keyof typeof PAYMENT_PROVIDER_LABEL>).map((p) => ({ value: p, label: PAYMENT_PROVIDER_LABEL[p] })),
  },
  {
    key: "f.status",
    label: "Result",
    kind: "select",
    options: [
      { value: "SUCCEEDED", label: "Received" },
      { value: "FAILED", label: "Failed" },
    ],
    chip: (label) => `Result: ${label}`,
  },
  { key: "from", label: "Settled from", kind: "date", chip: (label) => `From ${label}` },
  { key: "to", label: "Settled to", kind: "date", chip: (label) => `To ${label}` },
];

/** Finance › Transactions (Blueprint V2 §M): every payment the ledger holds — gateway, COD collections, staff-recorded,
 * store balance — newest first, with the order it paid for. Read-only: money is recorded on the order. */
export default function PaymentTransactionsPage() {
  const filters = useFilterState(FILTERS, { pageSizes: [20, 50, 100], defaultPageSize: 50 });
  const { values } = filters;
  const params = {
    page: values.page,
    pageSize: values.size,
    search: values.q || undefined,
    provider: (values["f.provider"] as string) || undefined,
    status: ((values["f.status"] as string) || undefined) as "SUCCEEDED" | "FAILED" | undefined,
    from: (values.from as string) || undefined,
    to: (values.to as string) || undefined,
  };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["payment-transactions", params],
    queryFn: ({ signal }) => paymentsApi.listPaymentTransactions(params, { signal }),
    placeholderData: (prev) => prev,
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Transactions" description="Every payment in the ledger — gateway, cash on delivery, staff-recorded and store balance." />
      <ModuleTabs />
      <div className="space-y-3">
        <FilterBar
          defs={FILTERS}
          values={values}
          onChange={filters.setFilters}
          search={filters.search}
          onSearchChange={filters.setSearch}
          searchPlaceholder="Search order #, customer, phone…"
          onClearAll={filters.clearAll}
        />
        <TableContainer>
          <Table aria-label="Payment transactions">
            <TableHead>
              <tr>
                <TableHeaderCell>Settled</TableHeaderCell>
                <TableHeaderCell>Order</TableHeaderCell>
                <TableHeaderCell>Method</TableHeaderCell>
                <TableHeaderCell>Reference</TableHeaderCell>
                <TableHeaderCell>Recorded by</TableHeaderCell>
                <TableHeaderCell>Result</TableHeaderCell>
                <TableHeaderCell align="right">Amount</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {isLoading && !data && <TableSkeleton rows={8} cols={7} />}
              {isError && !data && (
                <TableMessageRow colSpan={7}>
                  <ErrorState onRetry={() => refetch()} />
                </TableMessageRow>
              )}
              {data && data.items.length === 0 && (
                <TableMessageRow colSpan={7}>
                  <EmptyState icon={Receipt} title="No payments match" description="Change the search or filters." />
                </TableMessageRow>
              )}
              {data?.items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap text-fg-muted">{formatStoreDateTime(t.settledAt)}</TableCell>
                  <TableCell>
                    {t.order ? (
                      <Link href={`/admin/orders/${t.order.id}`} className="block hover:text-accent hover:underline">
                        <span className="font-medium text-fg">{t.order.orderNumber}</span>
                        <span className="block text-xs text-fg-subtle">
                          {t.order.customerName} · {t.order.customerPhone}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-fg-subtle">No order</span>
                    )}
                  </TableCell>
                  <TableCell>{PAYMENT_PROVIDER_LABEL[t.provider]}</TableCell>
                  <TableCell className={cn("max-w-[200px] truncate text-fg-muted", t.providerTransactionId && "font-mono text-xs")} title={t.providerTransactionId ?? t.note ?? undefined}>
                    {t.providerTransactionId ?? t.note ?? "—"}
                  </TableCell>
                  <TableCell className="text-fg-muted">{t.recordedBy ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === "SUCCEEDED" ? "success" : "danger"} dot>
                      {t.status === "SUCCEEDED" ? "Received" : "Failed"}
                    </Badge>
                  </TableCell>
                  <TableCell align="right" className="font-semibold text-fg">
                    {formatPrice(t.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </TableContainer>
        {data && data.total > data.pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
            <span className="tabular-nums">{formatCount(data.total)} payments</span>
            <Pagination page={values.page} totalPages={totalPages} onChange={filters.setPage} className="mt-0" />
          </div>
        )}
      </div>
    </div>
  );
}
