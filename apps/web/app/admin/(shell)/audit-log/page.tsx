"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import type { AuditLogEntry } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { FilterBar, useFilterState } from "@/components/admin/filters";
import type { FilterDefinition, FilterOption } from "@/lib/admin/filters";
import * as auditApi from "@/lib/api/audit";
import { useCapability } from "@/hooks/use-capability";
import { formatCount, formatStoreDateTime } from "@/lib/format";

const VERBS: Record<string, { label: string; variant: "success" | "info" | "danger" | "warning" | "neutral" }> = {
  create: { label: "Created", variant: "success" },
  update: { label: "Changed", variant: "info" },
  delete: { label: "Deleted", variant: "danger" },
  restore: { label: "Restored", variant: "warning" },
  export: { label: "Exported", variant: "neutral" },
};

/** "orders.bulk_update" → { label: "Changed", bulk: true } — the change column reads as a word, not a code. */
function describeAction(action: string) {
  const raw = action.split(".").slice(1).join(".") || action;
  const bulk = raw.startsWith("bulk_");
  const verb = raw.replace(/^bulk_/, "");
  return { ...(VERBS[verb] ?? { label: verb.replace(/_/g, " "), variant: "neutral" as const }), bulk };
}

/** Where a record of this area opens in the admin, when it has its own page. */
const RECORD_HREF: Record<string, (id: string) => string> = {
  orders: (id) => `/admin/orders/${id}`,
  products: (id) => `/admin/products/${id}/edit`,
  customers: (id) => `/admin/customers/${id}`,
};

const ACTION_OPTIONS: FilterOption[] = Object.entries(VERBS).map(([value, v]) => ({ value, label: v.label }));

/** Administration › Audit log (Admin V2): who changed what, filterable by person, area, kind of change, date and record;
 * each entry opens with its full detail and the other entries of the same request. Owner-only (audit.read). */
export default function AuditLogPage() {
  const canRead = useCapability("audit.view");
  const { data: facets } = useQuery({ queryKey: ["audit-facets"], queryFn: auditApi.getAuditFacets, enabled: canRead, staleTime: 5 * 60_000 });
  const filtersDef = useMemo<readonly FilterDefinition[]>(
    () => [
      {
        key: "f.admin",
        label: "Person",
        kind: "select",
        placement: "quick",
        options: () => [{ value: "system", label: "System / customer" }, ...(facets?.admins ?? []).map((a) => ({ value: a.id, label: a.isActive ? a.name : `${a.name} (removed)` }))],
        chip: (label) => `By ${label}`,
      },
      { key: "f.area", label: "Area", kind: "select", options: () => (facets?.entityTypes ?? []).map((t) => ({ value: t, label: t.replace(/[-_]/g, " ") })), chip: (label) => `Area: ${label}` },
      { key: "f.action", label: "Change", kind: "select", placement: "quick", options: ACTION_OPTIONS },
      { key: "f.request", label: "Request", kind: "text", chip: (_label, value) => `Request ${value.slice(0, 8)}…` },
      { key: "from", label: "From", kind: "date", chip: (label) => `From ${label}` },
      { key: "to", label: "To", kind: "date", chip: (label) => `To ${label}` },
    ],
    [facets],
  );
  const filters = useFilterState(filtersDef, { pageSizes: [30, 50, 100], defaultPageSize: 30 });
  const { values } = filters;
  const params = {
    page: values.page,
    pageSize: values.size,
    entityId: values.q || undefined,
    adminId: (values["f.admin"] as string) || undefined,
    entityType: (values["f.area"] as string) || undefined,
    action: (values["f.action"] as string) || undefined,
    requestId: (values["f.request"] as string) || undefined,
    from: (values.from as string) || undefined,
    to: (values.to as string) || undefined,
  };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["audit-logs", params],
    queryFn: () => auditApi.listAuditLogs(params),
    enabled: canRead,
    placeholderData: (prev) => prev,
  });
  const [open, setOpen] = useState<AuditLogEntry | null>(null);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Audit log" />
        <ModuleTabs />
        <p className="text-sm text-fg-muted">Only store owners can review the audit log.</p>
      </div>
    );
  }

  const requestId = open?.metadata && typeof open.metadata.requestId === "string" ? open.metadata.requestId : null;

  return (
    <div>
      <PageHeader title="Audit log" description="Every change made in the Store Console — who made it, what changed and when." />
      <ModuleTabs />
      <div className="space-y-3">
        <FilterBar
          defs={filtersDef}
          values={values}
          onChange={filters.setFilters}
          search={filters.search}
          onSearchChange={filters.setSearch}
          searchPlaceholder="Record id…"
          onClearAll={filters.clearAll}
        />
        <TableContainer>
          <Table aria-label="Audit log">
            <TableHead>
              <tr>
                <TableHeaderCell>When</TableHeaderCell>
                <TableHeaderCell>Who</TableHeaderCell>
                <TableHeaderCell>Change</TableHeaderCell>
                <TableHeaderCell>Area</TableHeaderCell>
                <TableHeaderCell>Record</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {isLoading && !data && <TableSkeleton rows={10} cols={5} />}
              {isError && !data && (
                <TableMessageRow colSpan={5}>
                  <ErrorState onRetry={() => refetch()} />
                </TableMessageRow>
              )}
              {data && data.items.length === 0 && (
                <TableMessageRow colSpan={5}>
                  <EmptyState icon={History} title="No entries match" description="Change the filters or the date range." />
                </TableMessageRow>
              )}
              {data?.items.map((entry) => {
                const action = describeAction(entry.action);
                const href = entry.entityId ? RECORD_HREF[entry.entityType]?.(entry.entityId) : undefined;
                return (
                  <TableRow key={entry.id} className="cursor-pointer" onClick={() => setOpen(entry)}>
                    <TableCell className="whitespace-nowrap text-fg-muted">{formatStoreDateTime(entry.createdAt)}</TableCell>
                    <TableCell>{entry.admin?.name ?? <span className="text-fg-subtle">System / customer</span>}</TableCell>
                    <TableCell>
                      <Badge variant={action.variant}>{action.bulk ? `${action.label} (bulk)` : action.label}</Badge>
                    </TableCell>
                    <TableCell className="capitalize text-fg-muted">{entry.entityType.replace(/[-_]/g, " ")}</TableCell>
                    <TableCell className="font-mono text-xs text-fg-muted">
                      {entry.entityId ? (
                        href ? (
                          <Link href={href} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
                            {entry.entityId.slice(0, 10)}…
                          </Link>
                        ) : (
                          `${entry.entityId.slice(0, 10)}…`
                        )
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        </TableContainer>
        {data && data.total > data.pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
            <span className="tabular-nums">{formatCount(data.total)} entries</span>
            <Pagination page={values.page} totalPages={totalPages} onChange={filters.setPage} className="mt-0" />
          </div>
        )}
      </div>

      <Drawer open={!!open} onClose={() => setOpen(null)} title="Audit entry">
        {open && (
          <div className="space-y-5 px-6 py-5 text-sm">
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2">
              <dt className="text-fg-muted">When</dt>
              <dd>{formatStoreDateTime(open.createdAt)}</dd>
              <dt className="text-fg-muted">Who</dt>
              <dd>{open.admin ? `${open.admin.name} · ${open.admin.email}` : "System / customer"}</dd>
              <dt className="text-fg-muted">Action</dt>
              <dd className="font-mono text-xs">{open.action}</dd>
              <dt className="text-fg-muted">Record</dt>
              <dd className="break-all font-mono text-xs">{open.entityId ?? "—"}</dd>
              <dt className="text-fg-muted">IP address</dt>
              <dd className="font-mono text-xs">{open.ipAddress ?? "—"}</dd>
            </dl>
            {open.metadata && (
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-fg">Details</p>
                <pre className="max-h-80 overflow-auto rounded-lg bg-ink-900/[0.03] p-3 font-mono text-xs leading-relaxed text-fg">{JSON.stringify(open.metadata, null, 2)}</pre>
              </div>
            )}
            {requestId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  filters.setFilters({ "f.request": requestId });
                  setOpen(null);
                }}
              >
                Show everything from this request
              </Button>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
