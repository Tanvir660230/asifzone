"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { BankTransaction, FinancialAccount } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";
import { counterAccountsFor } from "./money-movement-dialog";

/**
 * Matching one statement line (docs/FINANCE_PHASE_2.md §4): pair it with ledger lines of the same account (partially if
 * the amounts differ), or — when the books have no counterpart — resolve it with an explicit adjustment, which posts a
 * journal and is matched to the line. Nothing here edits a balance.
 */
export function MatchDialog({ line: given, accounts, reconciliationId, onClose }: { line: BankTransaction; accounts: FinancialAccount[]; reconciliationId?: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  // The line as the last mutation returned it, until the refetched list (newer still) arrives — so the dialog never shows
  // a remainder that a match just changed.
  const [fresh, setFresh] = useState<BankTransaction | null>(null);
  useEffect(() => setFresh(null), [given]);
  const line = fresh ?? given;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });
  const final = line.status === "RECONCILED";
  // Candidates depend on every match in the books, not only this line's, so a list is never kept for later: one cached
  // under an earlier remainder (before an unmatch) would offer ledger lines as they were then.
  const candidates = useQuery({ queryKey: [...financeApi.financeKeys.all, "candidates", line.id, line.matchedAmount], queryFn: () => financeApi.matchCandidates(line.id), enabled: !final && line.unmatchedAmount > 0, gcTime: 0 });
  const ledger = useQuery({ queryKey: financeApi.financeKeys.ledgerAccounts(), queryFn: financeApi.listLedgerAccounts, enabled: !final });
  const counters = useMemo(() => counterAccountsFor(ledger.data?.accounts ?? [], accounts), [ledger.data, accounts]);
  const [partial, setPartial] = useState<Record<string, string>>({});
  const [counter, setCounter] = useState("");
  const [reason, setReason] = useState("");

  const match = useMutation({
    mutationFn: (v: { journalLineId: string; amount?: number }) => financeApi.matchBankTransaction(line.id, { ...v, reconciliationId }),
    onSuccess: (bt) => {
      setFresh(bt);
      refresh();
      toast.success(bt.status === "MATCHED" ? "Matched" : `Partly matched — ${formatPrice(bt.unmatchedAmount)} left`);
      if (bt.status === "MATCHED") onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't match")),
  });
  const unmatch = useMutation({
    mutationFn: (matchId: string) => financeApi.unmatch(matchId, "Unmatched from the statement screen"),
    onSuccess: (bt) => {
      setFresh(bt);
      refresh();
      toast.success("Match removed — kept in the history");
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't unmatch")),
  });
  const flag = useMutation({
    mutationFn: (on: boolean) => financeApi.flagBankTransaction(line.id, on),
    onSuccess: (bt) => {
      setFresh(bt);
      refresh();
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't update the line")),
  });
  const adjust = useMutation({
    mutationFn: () => financeApi.adjustBankTransaction(line.id, { counterAccountId: counter, reason: reason.trim(), reconciliationId }),
    onSuccess: ({ movement }) => {
      refresh();
      toast.success(movement.status === "POSTED" ? `Adjustment of ${formatPrice(movement.amount)} posted and matched` : "Adjustment is waiting for approval");
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, "The adjustment couldn't be posted")),
  });

  const moneyIn = line.amount > 0;
  return (
    <Modal open onClose={onClose} title="Match statement line" description={`${line.transactionDate} · ${line.description}`} widthClassName="max-w-2xl">
      <div className="space-y-5" data-testid="match-dialog">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className={moneyIn ? "font-semibold tabular-nums text-success-700" : "font-semibold tabular-nums text-ink-900"}>{moneyIn ? "+" : "−"}{formatPrice(Math.abs(line.amount))}</span>
          <Badge variant={line.status === "MATCHED" || line.status === "RECONCILED" ? "success" : line.status === "ADJUSTMENT_REQUIRED" ? "danger" : "warning"}>{line.status.replace("_", " ").toLowerCase()}</Badge>
          {line.unmatchedAmount > 0 && <span className="text-ink-600">Unmatched {formatPrice(line.unmatchedAmount)}</span>}
          {line.reference && <span className="text-ink-500">Ref {line.reference}</span>}
        </div>

        {line.matches.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Matches</h3>
            <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle text-sm">
              {line.matches.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className={m.status === "REMOVED" ? "text-ink-400 line-through" : "text-ink-800"}>
                    #{m.journalEntry.number} {m.journalEntry.entryDate} · {m.journalEntry.description}
                  </span>
                  <span className="tabular-nums">{formatPrice(m.amount)}</span>
                  {m.status === "ACTIVE" && !final && (
                    <Button size="sm" variant="ghost" loading={unmatch.isPending} onClick={() => unmatch.mutate(m.id)}>
                      Unmatch
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {final && <Alert variant="success" title="Reconciled">This line was covered by a completed reconciliation; its matches are final.</Alert>}

        {!final && line.unmatchedAmount > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">In the books ({moneyIn ? "money in" : "money out"}, not yet matched)</h3>
            {candidates.isLoading && <p className="text-sm text-ink-500">Looking…</p>}
            {candidates.data?.candidates.length === 0 && <p className="text-sm text-ink-500">Nothing in the books matches. If the bank is right, resolve it with an adjustment below.</p>}
            <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle text-sm" data-testid="match-candidates">
              {candidates.data?.candidates.map((c) => (
                <li key={c.journalLineId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="flex-1 text-ink-800">
                    #{c.number} {c.entryDate} · {c.description}
                    {c.exactAmount && <Badge variant="success" className="ml-2">same amount</Badge>}
                  </span>
                  <span className="tabular-nums text-ink-700">{formatPrice(Math.abs(c.remaining))} open</span>
                  <Input
                    aria-label="Amount to match"
                    className="h-8 w-28"
                    inputMode="decimal"
                    placeholder={String(Math.min(Math.abs(c.remaining), line.unmatchedAmount))}
                    value={partial[c.journalLineId] ?? ""}
                    onChange={(e) => setPartial((p) => ({ ...p, [c.journalLineId]: e.target.value }))}
                  />
                  <Button size="sm" loading={match.isPending} onClick={() => match.mutate({ journalLineId: c.journalLineId, amount: partial[c.journalLineId] ? Number(partial[c.journalLineId]) : undefined })}>
                    Match
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!final && line.unmatchedAmount > 0 && (
          <section className="space-y-3 rounded-xl border border-line-subtle p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Resolve with an adjustment</h3>
              <Button size="sm" variant="ghost" loading={flag.isPending} onClick={() => flag.mutate(!line.adjustmentRequired)}>
                {line.adjustmentRequired ? "Clear the flag" : "Flag: adjustment required"}
              </Button>
            </div>
            <p className="text-xs text-ink-500">Posts a journal of {formatPrice(line.unmatchedAmount)} {moneyIn ? "into" : "out of"} this account against the account you choose, and matches it to this line. The original line stays as it is.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field htmlFor="adj-counter" label="Against" required>
                <Select id="adj-counter" value={counter} onChange={(e) => setCounter(e.target.value)}>
                  <option value="">Choose… (bank charges, interest income…)</option>
                  {counters.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field htmlFor="adj-reason" label="Reason" required>
                <Textarea id="adj-reason" rows={1} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" disabled={!counter || reason.trim().length < 3} loading={adjust.isPending} onClick={() => adjust.mutate()} data-testid="post-adjustment">
                Post adjustment
              </Button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
