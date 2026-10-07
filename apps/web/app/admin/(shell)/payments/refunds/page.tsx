"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { FilterBar, useFilterState } from "@/components/admin/filters";
import type { FilterDefinition } from "@/lib/admin/filters";
import * as paymentsApi from "@/lib/api/payments-admin";
import { formatCount, formatPrice, formatStoreDateTime } from "@/lib/format";

const FILTERS: readonly FilterDefinition[] = [
  {
    key: "f.status",
    label: "Status",
    kind: "select",
    placement: "quick",
    options: [
      { value: "REQUESTED", label: "Waiting to be paid out" },
      { value: "COMPLETED", label: "Paid out" },
    ],
  },
  { key: "from", label: "Recorded from", kind: "date", chip: (label) => `From ${label}` },
  { key: "to", label: "Recorded to", kind: "date", chip: (label) => `To ${label}` },
];

/** Finance › Refunds (Blueprint V2 §M): every refund the ledger holds, the ones still to be paid out first. Refunds are
 * recorded and completed on the order (there is no gateway refund API — the money goes back outside the system). */
export default function RefundsPage() {
  const filters = useFilterState(FILTERS, { pageSizes: [20, 50, 100], defaultPageSize: 50 });
  const { values } = filters;
  const params = {
    page: values.page,
    pageSize: values.size,
    search: values.q || undefined,
    status: ((values["f.status"] as string) || undefined) as "REQUESTED" | "COMPLETED" | undefined,
    from: (values.from as string) || undefined,
    to: (values.to as string) || undefined,
  };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["refund-list", params],
    queryFn: () => paymentsApi.listAllRefunds(params),
    placeholderData: (prev) => prev,
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Refunds" description="Money owed or returned to customers. Record or complete a refund from its order." />
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
          <Table aria-label="Refunds">
            <TableHead>
              <tr>
                <TableHeaderCell>Recorded</TableHeaderCell>
                <TableHeaderCell>Order</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
                <TableHeaderCell>Method</TableHeaderCell>
                <TableHeaderCell>By</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell align="right">Amount</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {isLoading && !data && <TableSkeleton rows={6} cols={7} />}
              {isError && !data && (
                <TableMessageRow colSpan={7}>
                  <ErrorState onRetry={() => refetch()} />
                </TableMessageRow>
              )}
              {data && data.items.length === 0 && (
                <TableMessageRow colSpan={7}>
                  <EmptyState icon={Undo2} title="No refunds" description="Refunds recorded on orders appear here." />
                </TableMessageRow>
              )}
              {data?.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-fg-muted">{formatStoreDateTime(r.createdAt)}</TableCell>
                  <TableCell>
                    <Link href={`/admin/orders/${r.order.id}`} className="block hover:text-accent hover:underline">
                      <span className="font-medium text-fg">{r.order.orderNumber}</span>
                      <span className="block text-xs text-fg-subtle">
                        {r.order.customerName} · {r.order.customerPhone}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate text-fg-muted" title={r.reason ?? undefined}>
                    {r.reason ?? "—"}
                  </TableCell>
                  <TableCell className="text-fg-muted">{r.method ?? "—"}</TableCell>
                  <TableCell className="text-fg-muted">{r.completedBy ?? r.requestedBy ?? "—"}</TableCell>
                  <TableCell>
                    {r.status === "COMPLETED" ? (
                      <Badge variant="success" dot>
                        Paid out{r.completedAt ? ` · ${formatStoreDateTime(r.completedAt)}` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="warning" dot>
                        Waiting to be paid out
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell align="right" className="font-semibold text-fg">
                    {formatPrice(r.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </TableContainer>
        {data && data.total > data.pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
            <span className="tabular-nums">{formatCount(data.total)} refunds</span>
            <Pagination page={values.page} totalPages={totalPages} onChange={filters.setPage} className="mt-0" />
          </div>
        )}
      </div>
    </div>
  );
}
