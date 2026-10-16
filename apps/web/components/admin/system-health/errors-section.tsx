"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Globe, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { useCapability } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as opsApi from "@/lib/api/ops";
import { attentionKeys } from "@/lib/query-keys";
import { formatCount, formatStoreDateTime, timeAgo } from "@/lib/format";

type Status = "open" | "resolved";

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Fixed" },
] as const;

function ErrorDetail({ id }: { id: string }) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: opsApi.errorKeys.detail(id), queryFn: () => opsApi.getError(id) });
  if (isError) return <ErrorState onRetry={() => refetch()} />;
  if (isLoading || !data) return <div className="h-24 animate-pulse rounded-xl bg-ink-900/[0.04]" aria-busy="true" aria-label="Loading" />;
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-fg-muted">
        First seen {formatStoreDateTime(data.firstSeenAt)} · last seen {formatStoreDateTime(data.lastSeenAt)}
      </p>
      {data.sampleStack && (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-ink-900/[0.035] p-3 font-mono text-xs leading-relaxed text-fg">{data.sampleStack}</pre>
      )}
      {data.lastCorrelationId && (
        <p className="text-[13px] text-fg-muted">
          Support code <span className="select-all font-mono text-fg">{data.lastCorrelationId}</span> — share it with your developer to find this in the logs.
        </p>
      )}
    </div>
  );
}

function ErrorRow({ row, canRepair, onResolve, resolving }: { row: opsApi.ErrorGroupRow; canRepair: boolean; onResolve: (id: string) => void; resolving: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = row.source === "web" ? Globe : Server;
  const where = row.source === "web" ? "Website" : "Server";
  return (
    <li data-testid="error-row">
      <details className="group" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4 hover:bg-ink-900/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">
          <Icon size={18} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 break-words text-[15px] font-medium text-fg">{row.title}</p>
            <p className="mt-0.5 truncate text-[13px] text-fg-muted">
              {where}
              {row.lastPath ? ` · ${row.lastPath}` : ""}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[13px] font-semibold tabular-nums text-fg">×{formatCount(row.count)}</p>
            <p className="text-xs text-fg-subtle">{timeAgo(row.lastSeenAt)}</p>
          </div>
          <ChevronRight size={16} className="mt-0.5 shrink-0 text-fg-subtle transition-transform duration-fast group-open:rotate-90" aria-hidden="true" />
        </summary>
        <div className="space-y-3 px-5 pb-5 pl-[52px]">
          {open && <ErrorDetail id={row.id} />}
          {canRepair && !row.resolvedAt && (
            <Button size="sm" variant="outline" disabled={resolving} onClick={() => onResolve(row.id)}>
              Mark fixed
            </Button>
          )}
        </div>
      </details>
    </li>
  );
}

/** Admin › System health › Errors (Site health): what broke on the server or in visitors' browsers, one row per kind of
 * failure. "Mark fixed" hides a row until it happens again. */
export function ErrorsSection() {
  const [status, setStatus] = useState<Status>("open");
  const canRepair = useCapability("ops.repair");
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: opsApi.errorKeys.list(status), queryFn: () => opsApi.listErrors(status), refetchInterval: 60_000 });
  const resolve = useMutation({
    mutationFn: opsApi.resolveError,
    onSuccess: () => {
      toast.success("Marked fixed — it will come back here if it happens again");
      queryClient.invalidateQueries({ queryKey: opsApi.errorKeys.all });
      queryClient.invalidateQueries({ queryKey: attentionKeys.all });
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't mark it fixed")),
  });

  return (
    <section id="errors" aria-labelledby="errors-heading" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="errors-heading" className="font-display text-lg tracking-tight text-fg">
            Errors
          </h2>
          <p className="text-[13px] text-fg-muted">Things that broke on the server or in a visitor&apos;s browser. Each row is one kind of error.</p>
        </div>
        <SegmentedControl aria-label="Show errors" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        {isError && !data ? (
          <ErrorState onRetry={() => refetch()} className="py-10" />
        ) : isLoading || !data ? (
          <div className="h-40 animate-pulse bg-ink-900/[0.03]" aria-busy="true" aria-label="Loading" />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={status === "open" ? "No open errors" : "Nothing marked fixed yet"}
            description={status === "open" ? "Nothing has broken since the last fix. New errors appear here within a few seconds." : undefined}
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {data.items.map((row) => (
              <ErrorRow key={row.id} row={row} canRepair={canRepair} onResolve={(id) => resolve.mutate(id)} resolving={resolve.isPending} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
