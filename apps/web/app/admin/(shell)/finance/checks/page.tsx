"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { CheckResult } from "@/lib/api/finance";
import { formatPrice, formatStoreDateTime } from "@/lib/format";

const STATUS_BADGE = { MATCHED: "success", DIFFERENCE: "danger", NOT_APPLICABLE: "neutral", ERROR: "danger" } as const;
const STATUS_LABEL = { MATCHED: "matches", DIFFERENCE: "difference", NOT_APPLICABLE: "not applicable", ERROR: "error" } as const;
type OrderDiff = { orderNumber: string | null; orderId: string; dashboard: number; ledger: number; difference: number };

/** Finance checks (docs/FINANCE_PHASE_3.md §9): the books proved against the dashboard's own engine and against
 * themselves. A difference names the records responsible; nothing is corrected automatically. */
export default function FinanceChecksPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const checks = useQuery({ queryKey: [...financeApi.financeKeys.all, "checks"], queryFn: financeApi.reconciliationChecks, enabled: allowed });
  const runs = useQuery({ queryKey: [...financeApi.financeKeys.all, "check-runs"], queryFn: () => financeApi.listCheckRuns({ pageSize: 100 }), enabled: allowed });
  const run = useMutation({
    mutationFn: () => financeApi.runChecks(),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: [...financeApi.financeKeys.all, "check-runs"] });
      if (r.ok) toast.success("Every check matches");
      else toast.error(`${r.results.filter((x) => x.status === "DIFFERENCE" || x.status === "ERROR").length} check(s) need attention`);
    },
    onError: (err) => toast.error(getErrorMessage(err, "The checks couldn't run")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={ShieldCheck} title="Finance is limited to finance roles" />
      </div>
    );
  }
  // The latest run of each check — runs are history and never change.
  const latest = new Map<string, CheckResult>();
  for (const r of runs.data?.runs ?? []) if (!latest.has(r.checkKey)) latest.set(r.checkKey, r);
  // the summary above the list: how many of the latest results match, differ or were never run
  const all = checks.data?.checks ?? [];
  const tally = { matched: 0, problems: 0, notRun: 0 };
  let lastRun: string | null = null;
  for (const c of all) {
    const r = latest.get(c.key);
    if (!r) tally.notRun++;
    else if (r.status === "DIFFERENCE" || r.status === "ERROR") tally.problems++;
    else tally.matched++;
    if (r && (!lastRun || r.createdAt > lastRun)) lastRun = r.createdAt;
  }
  // what needs a look comes first: differences and errors, then checks never run, then the ones that match
  const rank = (key: string) => {
    const r = latest.get(key);
    return !r ? 1 : r.status === "DIFFERENCE" || r.status === "ERROR" ? 0 : 2;
  };
  const ordered = [...all].sort((a, b) => rank(a.key) - rank(b.key));
  const loading = checks.isLoading || runs.isLoading;
  const failed = checks.error ?? runs.error;

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Finance checks"
        description="Revenue and cost of goods are proved against the dashboard's own figures, and the ledger against itself. A difference lists the orders or records behind it."
        action={can("finance.reconcile") && <Button size="sm" loading={run.isPending} onClick={() => run.mutate()} data-testid="run-checks">Run all checks</Button>}
      />
      {failed && <Alert variant="danger" title="The checks couldn't load">{getErrorMessage(failed)}</Alert>}
      {all.length > 0 && !runs.isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="check-summary">
          {[
            { label: "Match", value: String(tally.matched), tone: "text-success-700" },
            { label: "Need attention", value: String(tally.problems), tone: tally.problems ? "text-danger-600" : "text-ink-900" },
            { label: "Not run yet", value: String(tally.notRun), tone: "text-ink-900" },
            { label: "Last run", value: lastRun ? formatStoreDateTime(lastRun) : "never", tone: "text-ink-900" },
          ].map((f) => (
            <Card key={f.label} className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{f.label}</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${f.tone}`}>{f.value}</p>
            </Card>
          ))}
        </div>
      )}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      )}
      <div className="space-y-3" data-testid="check-list">
        {ordered.map((c) => {
          const r = latest.get(c.key);
          const details = (r?.details ?? {}) as Record<string, unknown>;
          const orders = Array.isArray(details.orders) ? (details.orders as OrderDiff[]) : [];
          return (
            <Card key={c.key} className="space-y-2 p-4" data-testid={`check-${c.key}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{c.label}</p>
                  <p className="text-sm text-ink-600">{c.description}</p>
                </div>
                <span className="shrink-0">
                  {r ? <Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge> : <Badge variant="neutral">not run</Badge>}
                </span>
              </div>
              {r && r.expected !== null && (
                <p className="text-sm tabular-nums text-ink-700">
                  Expected {formatPrice(r.expected)} · books {formatPrice(r.actual ?? 0)}{r.difference ? ` · difference ${formatPrice(r.difference)}` : ""}
                  <span className="ml-2 text-xs text-ink-500">{formatStoreDateTime(r.createdAt)}</span>
                </p>
              )}
              {orders.length > 0 && (
                <ul className="divide-y divide-line-subtle rounded-md border border-line-subtle text-sm">
                  {orders.slice(0, 50).map((o, i) => (
                    <li key={o.orderId ?? i} className="flex justify-between gap-3 px-3 py-1.5">
                      <Link href={`/admin/orders/${o.orderId}`} className="text-accent hover:underline">
                        {o.orderNumber ?? o.orderId}
                      </Link>
                      <span className="tabular-nums">dashboard {formatPrice(o.dashboard)} · books {formatPrice(o.ledger)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {r && r.status !== "MATCHED" && Object.keys(details).length > 0 && (
                <details className="text-xs text-ink-600">
                  <summary className="cursor-pointer">Details</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2">{JSON.stringify(details, null, 2)}</pre>
                </details>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
