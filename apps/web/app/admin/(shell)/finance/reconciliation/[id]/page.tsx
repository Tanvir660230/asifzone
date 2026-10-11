"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { MatchDialog } from "@/components/admin/finance/match-dialog";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { BankTransaction } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";

/**
 * One bank reconciliation (docs/FINANCE_PHASE_2.md §6). Live figures while IN_PROGRESS; the frozen snapshot once completed
 * or abandoned. It completes only when the statement is complete, every statement line of the period is matched, and no
 * difference is left unexplained — outstanding items (a deposit in transit) are allowed and listed.
 */
export default function ReconciliationRunPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useCapabilities();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [matching, setMatching] = useState<BankTransaction | null>(null);
  const detail = useQuery({ queryKey: financeApi.financeKeys.reconciliation(id), queryFn: () => financeApi.getReconciliation(id) });
  const accounts = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });

  const auto = useMutation({ mutationFn: () => financeApi.autoMatch(id), onSuccess: (r) => { refresh(); toast.success(`${r.matched} line(s) matched automatically`); }, onError: (err) => toast.error(getErrorMessage(err, "Auto-match failed")) });
  const complete = useMutation({ mutationFn: () => financeApi.completeReconciliation(id, notes), onSuccess: () => { refresh(); toast.success("Reconciliation completed"); }, onError: (err) => toast.error(getErrorMessage(err, "Can't complete yet")) });
  const abandon = useMutation({ mutationFn: () => financeApi.abandonReconciliation(id, notes.trim() || "Abandoned from the reconciliation screen"), onSuccess: () => { refresh(); toast.success("Abandoned — kept in the history"); }, onError: (err) => toast.error(getErrorMessage(err, "Couldn't abandon")) });

  if (detail.isError) return <EmptyState icon={Scale} title="Reconciliation not found" />;
  const d = detail.data;
  if (!d) return null;
  const r = d.reconciliation;
  const live = d.live;
  const account = accounts.data?.financialAccounts.find((a) => a.id === r.financialAccountId);
  const figures = live ?? {
    ledgerBalance: r.ledgerBalance ?? 0, statementGap: r.statementGap ?? 0, difference: r.difference ?? 0, unexplainedDifference: r.unexplainedDifference ?? 0,
    matchedCount: r.matchedCount, unmatchedCount: r.unmatchedCount, outstandingLedgerCount: r.outstandingLedgerCount, adjustmentCount: r.adjustmentCount,
  };
  const inProgress = r.status === "IN_PROGRESS";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${account?.name ?? "Account"} · ${r.periodStart} → ${r.periodEnd}`}
        eyebrow="Bank reconciliation"
        action={<Badge variant={r.status === "COMPLETED" ? "success" : r.status === "ABANDONED" ? "neutral" : "warning"}>{r.status.replace("_", " ").toLowerCase()}</Badge>}
      />

      <div className="grid gap-3 sm:grid-cols-4" data-testid="reconciliation-figures">
        {[
          ["Statement opening → closing", `${formatPrice(r.openingStatementBalance)} → ${formatPrice(r.closingStatementBalance)}`],
          ["Books at period end", formatPrice(figures.ledgerBalance)],
          ["Difference (statement − books)", formatPrice(figures.difference)],
          ["Unexplained difference", formatPrice(figures.unexplainedDifference)],
          ["Statement gap", formatPrice(figures.statementGap)],
          ["Matched lines", String(figures.matchedCount)],
          ["Unmatched lines", String(figures.unmatchedCount)],
          ["Outstanding in the books · adjustments", `${figures.outstandingLedgerCount} · ${figures.adjustmentCount}`],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{label}</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-ink-900">{value}</p>
          </Card>
        ))}
      </div>

      {inProgress && live && !live.canComplete && (
        <Alert variant="warning" title="Not reconciled yet">
          {live.statementGap !== 0 && <>The statement&apos;s lines don&apos;t add up from its opening to its closing balance ({formatPrice(live.statementGap)}) — a line is missing or doubled. </>}
          {live.unmatchedCount > 0 && <>{live.unmatchedCount} statement line(s) still need matching or an adjustment. </>}
          {live.unexplainedDifference !== 0 && <>{formatPrice(live.unexplainedDifference)} of the difference isn&apos;t explained by any outstanding item.</>}
        </Alert>
      )}
      {r.status === "COMPLETED" && <Alert variant="success" title="Reconciled">{r.notes ?? "This period is reconciled; its statement lines and matches are final."}</Alert>}
      {r.status === "ABANDONED" && <Alert variant="neutral" title="Abandoned">{r.abandonReason}</Alert>}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Statement lines in the period</h2>
          {inProgress && can("finance.reconcile") && <Button size="sm" variant="outline" loading={auto.isPending} onClick={() => auto.mutate()}>Auto-match</Button>}
        </div>
        <Card className="p-0">
          <ul className="divide-y divide-line-subtle text-sm">
            {d.statementLines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2" data-testid="reconciliation-line">
                <span className="w-24 text-ink-600">{l.transactionDate}</span>
                <span className="flex-1 text-ink-900">{l.description}</span>
                <span className={l.amount > 0 ? "tabular-nums text-success-700" : "tabular-nums"}>{l.amount > 0 ? "+" : "−"}{formatPrice(Math.abs(l.amount))}</span>
                <Badge variant={l.unmatchedAmount === 0 ? "success" : l.adjustmentRequired ? "danger" : "warning"}>{l.status.replace("_", " ").toLowerCase()}</Badge>
                {inProgress && can("finance.reconcile") && l.unmatchedAmount > 0 && <Button size="sm" variant="ghost" onClick={() => setMatching(l)}>Resolve</Button>}
              </li>
            ))}
            {d.statementLines.length === 0 && <li className="px-4 py-3 text-ink-500">No statement lines in this period — import the statement first.</li>}
          </ul>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">In the books, not on the statement (outstanding)</h2>
        <Card className="p-0">
          <ul className="divide-y divide-line-subtle text-sm">
            {d.outstandingLedgerLines.map((l) => (
              <li key={l.journalLineId} className="flex items-center gap-3 px-4 py-2">
                <span className="w-24 text-ink-600">{l.entryDate}</span>
                <span className="flex-1 text-ink-900">#{l.number} · {l.description}</span>
                <span className="tabular-nums">{formatPrice(l.remaining)}</span>
              </li>
            ))}
            {d.outstandingLedgerLines.length === 0 && <li className="px-4 py-3 text-ink-500">Nothing outstanding.</li>}
          </ul>
        </Card>
      </section>

      {inProgress && can("finance.reconcile") && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <Input aria-label="Notes" className="flex-1" placeholder="Notes (e.g. deposit slip 88 in transit)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button variant="ghost" loading={abandon.isPending} onClick={() => abandon.mutate()}>Abandon</Button>
          <Button disabled={!live?.canComplete} loading={complete.isPending} onClick={() => complete.mutate()} data-testid="complete-reconciliation">Complete</Button>
        </Card>
      )}

      {matching && (
        <MatchDialog line={d.statementLines.find((l) => l.id === matching.id) ?? matching} accounts={accounts.data?.financialAccounts ?? []} reconciliationId={r.id} onClose={() => setMatching(null)} />
      )}
    </div>
  );
}
