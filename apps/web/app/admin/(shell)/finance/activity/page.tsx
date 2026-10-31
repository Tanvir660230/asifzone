"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { FinancialEventStatus } from "@/lib/api/finance";
import { formatBookDate, formatStoreDateTime } from "@/lib/format";
import { PermissionState } from "@/components/admin/permission-state";

type View = "changes" | "events";
const PAGE_SIZE = 50;
const EVENT_STATUS: Record<FinancialEventStatus, { label: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  POSTED: { label: "Posted", variant: "success" },
  RECEIVED: { label: "Waiting", variant: "warning" },
  FAILED: { label: "Failed", variant: "danger" },
  IGNORED: { label: "Not needed", variant: "neutral" },
};
/** "opening.prefill_inventory" → "Opening · prefill inventory"; "ORDER_PAID" → "Order paid". */
const words = (s: string) => s.replace(/[._]/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const action = (a: string) => {
  const [area, ...rest] = a.split(".");
  return rest.length ? `${words(area!)} · ${rest.join(" ").replace(/_/g, " ")}` : words(a);
};

/**
 * Finance activity: the append-only audit trail of every change in the books (who, what, why), and the accounting events
 * commerce sends — with a retry for one that failed or is still waiting (after a missing mapping or cost is fixed).
 */
export default function FinanceActivityPage() {
  const { can, ready } = useCapabilities();
  const params = useSearchParams();
  const [view, setView] = useState<View>(params.get("view") === "events" ? "events" : "changes");
  if (ready && !can("finance.view")) {
    return (
      <div>
        <ModuleTabs />
        <PermissionState icon={History} page="the finance activity log" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Activity log" description="Every change made in Finance — who did it, when and why — and the accounting events orders send to the books." />
      <SegmentedControl aria-label="Show" options={[{ value: "changes" as const, label: "Changes" }, { value: "events" as const, label: "Accounting events" }]} value={view} onChange={setView} />
      {view === "changes" ? <Changes /> : <Events />}
    </div>
  );
}

function Changes() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: financeApi.activityKeys.audit({ page }), queryFn: () => financeApi.listFinanceAudit({ page, pageSize: PAGE_SIZE }), placeholderData: keepPreviousData });
  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError || !q.data) return <Alert variant="danger" title="The activity log couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>;
  if (q.data.entries.length === 0) return <EmptyState variant="bordered" icon={History} title="No changes yet" description="Everything done in Finance will be listed here." />;
  return (
    <>
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>When</TableHeaderCell>
                <TableHeaderCell>Who</TableHeaderCell>
                <TableHeaderCell>What</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {q.data.entries.map((e) => (
                <TableRow key={e.id} data-testid="audit-row">
                  <TableCell className="whitespace-nowrap text-sm text-fg-muted">{formatStoreDateTime(e.createdAt)}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm" title={e.actorLabel}>{e.actorLabel}</TableCell>
                  <TableCell className="min-w-[220px]">
                    <span className="block text-sm text-fg">{action(e.action)}</span>
                    <span className="block text-xs text-fg-subtle">{words(e.entityType.replace(/([a-z])([A-Z])/g, "$1 $2"))}</span>
                  </TableCell>
                  <TableCell className="min-w-[200px] text-sm text-fg-muted">{e.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
      </Card>
      <Pagination page={page} totalPages={Math.ceil(q.data.total / PAGE_SIZE)} onChange={setPage} />
    </>
  );
}

function Events() {
  const { can } = useCapabilities();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<FinancialEventStatus | "ALL">("FAILED");
  const [page, setPage] = useState(1);
  const filter = status === "ALL" ? undefined : status;
  const q = useQuery({ queryKey: financeApi.activityKeys.events({ status: filter, page }), queryFn: () => financeApi.listFinancialEvents({ status: filter, page, pageSize: PAGE_SIZE }), placeholderData: keepPreviousData });
  const retry = useMutation({
    mutationFn: financeApi.retryFinancialEvent,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["finance"] }); toast.success("Tried again"); },
    onError: (err) => toast.error(getErrorMessage(err, "It still couldn't be posted")),
  });
  return (
    <div className="space-y-4">
      <SegmentedControl
        aria-label="Event status"
        options={[{ value: "FAILED" as const, label: "Failed" }, { value: "RECEIVED" as const, label: "Waiting" }, { value: "POSTED" as const, label: "Posted" }, { value: "ALL" as const, label: "All" }]}
        value={status}
        onChange={(v) => { setStatus(v); setPage(1); }}
      />
      {q.isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : q.isError || !q.data ? (
        <Alert variant="danger" title="Events couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>
      ) : q.data.events.length === 0 ? (
        <EmptyState variant="bordered" icon={History} title={status === "FAILED" ? "No failed events" : status === "RECEIVED" ? "Nothing waiting" : "No events"} description={status === "FAILED" ? "Every accounting event from orders reached the books." : undefined} testId="events-empty" />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <HScrollShadow>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Event</TableHeaderCell>
                    <TableHeaderCell>Date in the books</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Entry</TableHeaderCell>
                    <TableHeaderCell />
                  </tr>
                </TableHead>
                <tbody>
                  {q.data.events.map((e) => (
                    <TableRow key={e.id} data-testid="event-row">
                      <TableCell className="min-w-[240px]">
                        <span className="block text-sm text-fg">{words(e.eventType)}</span>
                        <span className="block font-mono text-xs text-fg-subtle">{e.sourceEntityType} {e.sourceEntityId.slice(-8)}</span>
                        {e.lastError && <span className="mt-1 block text-xs text-danger-700">{e.lastError}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatBookDate(e.financialDate)}</TableCell>
                      <TableCell><Badge variant={EVENT_STATUS[e.status].variant}>{EVENT_STATUS[e.status].label}</Badge>{e.attempts > 1 && <span className="ml-2 text-xs text-fg-subtle">{e.attempts} tries</span>}</TableCell>
                      <TableCell className="text-sm">{e.journalEntry ? `#${e.journalEntry.number ?? "—"}` : "—"}</TableCell>
                      <TableCell align="right">
                        {(e.status === "FAILED" || e.status === "RECEIVED") && can("finance.reconcile") && (
                          <Button size="sm" variant="outline" loading={retry.isPending && retry.variables === e.id} onClick={() => retry.mutate(e.id)}>Try again</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </HScrollShadow>
          </Card>
          <Pagination page={page} totalPages={Math.ceil(q.data.total / PAGE_SIZE)} onChange={setPage} />
        </>
      )}
    </div>
  );
}
