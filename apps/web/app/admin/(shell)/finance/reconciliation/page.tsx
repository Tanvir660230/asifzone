"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";

const STATUS_BADGE = { IN_PROGRESS: "warning", COMPLETED: "success", ABANDONED: "neutral" } as const;

/** Bank reconciliation history and a new run (docs/FINANCE_PHASE_2.md §6). Every run is kept — completed and abandoned
 * runs are history and never change. */
export default function ReconciliationPage() {
  const { can, ready } = useCapabilities();
  const router = useRouter();
  const allowed = can("finance.view");
  const accounts = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts, enabled: allowed });
  const runs = useQuery({ queryKey: financeApi.financeKeys.reconciliations(), queryFn: () => financeApi.listReconciliations({ pageSize: 100 }), enabled: allowed });
  const [form, setForm] = useState({ financialAccountId: "", periodStart: "", periodEnd: "", openingStatementBalance: "", closingStatementBalance: "" });

  const start = useMutation({
    mutationFn: () => financeApi.startReconciliation({ ...form, openingStatementBalance: Number(form.openingStatementBalance), closingStatementBalance: Number(form.closingStatementBalance) }),
    onSuccess: (run) => router.push(`/admin/finance/reconciliation/${run.id}`),
    onError: (err) => toast.error(getErrorMessage(err, "The reconciliation couldn't be started")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Scale} title="Finance is limited to the owner" />
      </div>
    );
  }
  const byId = new Map((accounts.data?.financialAccounts ?? []).map((a) => [a.id, a]));
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.financialAccountId && form.periodStart && form.periodEnd && form.openingStatementBalance !== "" && form.closingStatementBalance !== "";

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Bank reconciliation" description="Compare a statement period with the books. Differences are matched, left outstanding with a reason, or resolved by an explicit adjustment — the books are never overwritten." />

      {can("finance.reconcile") && (
        <Card className="p-4">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Start a reconciliation</h2>
          <div className="grid gap-3 sm:grid-cols-5">
            <Field htmlFor="rc-account" label="Account" required>
              <Select id="rc-account" value={form.financialAccountId} onChange={set("financialAccountId")}>
                <option value="">Choose…</option>
                {(accounts.data?.financialAccounts ?? []).filter((a) => a.isActive).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
            <Field htmlFor="rc-start" label="Statement from" required>
              <Input id="rc-start" type="date" value={form.periodStart} onChange={set("periodStart")} />
            </Field>
            <Field htmlFor="rc-end" label="to" required>
              <Input id="rc-end" type="date" value={form.periodEnd} onChange={set("periodEnd")} />
            </Field>
            <Field htmlFor="rc-open" label="Opening balance" required>
              <Input id="rc-open" inputMode="decimal" value={form.openingStatementBalance} onChange={set("openingStatementBalance")} />
            </Field>
            <Field htmlFor="rc-close" label="Closing balance" required>
              <Input id="rc-close" inputMode="decimal" value={form.closingStatementBalance} onChange={set("closingStatementBalance")} />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <Button disabled={!valid} loading={start.isPending} onClick={() => start.mutate()} data-testid="start-reconciliation">Start</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Account</TableHeaderCell>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell align="right">Statement closing</TableHeaderCell>
                <TableHeaderCell align="right">Books</TableHeaderCell>
                <TableHeaderCell align="right">Difference</TableHeaderCell>
                <TableHeaderCell align="right">Matched / open / adjusted</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {runs.data?.reconciliations.map((r) => (
                <TableRow key={r.id} data-testid="reconciliation-row">
                  <TableCell>
                    <Link href={`/admin/finance/reconciliation/${r.id}`} className="font-medium text-ink-900 hover:underline">{byId.get(r.financialAccountId)?.name ?? "Account"}</Link>
                  </TableCell>
                  <TableCell>{r.periodStart} → {r.periodEnd}</TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(r.closingStatementBalance)}</TableCell>
                  <TableCell align="right" className="tabular-nums">{r.ledgerBalance === null ? "—" : formatPrice(r.ledgerBalance)}</TableCell>
                  <TableCell align="right" className="tabular-nums">{r.difference === null ? "—" : formatPrice(r.difference)}</TableCell>
                  <TableCell align="right" className="tabular-nums">{r.matchedCount} / {r.unmatchedCount} / {r.adjustmentCount}</TableCell>
                  <TableCell><Badge variant={STATUS_BADGE[r.status]}>{r.status.replace("_", " ").toLowerCase()}</Badge></TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
        {runs.data?.reconciliations.length === 0 && <EmptyState icon={Scale} title="No reconciliations yet" description="Import a statement for an account, then start its first reconciliation." />}
      </Card>
    </div>
  );
}
