"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { AccountDialog } from "@/components/admin/finance/account-dialog";
import { MatchDialog } from "@/components/admin/finance/match-dialog";
import { MoneyMovementDialog, type MovementDialogKind } from "@/components/admin/finance/money-movement-dialog";
import { StatementImportDialog, StatementLineDialog } from "@/components/admin/finance/statement-dialogs";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { BankTransaction, BankTransactionStatus, MovementStatus } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const LINE_BADGE: Record<BankTransactionStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  UNMATCHED: "warning",
  PARTIALLY_MATCHED: "info",
  MATCHED: "success",
  ADJUSTMENT_REQUIRED: "danger",
  RECONCILED: "neutral",
};
const MOVEMENT_BADGE: Record<MovementStatus, "success" | "warning" | "danger" | "neutral"> = { POSTED: "success", PENDING_APPROVAL: "warning", REJECTED: "neutral", REVERSED: "danger" };

type Tab = "ledger" | "movements" | "statement";

/** One money account (docs/FINANCE_PHASE_2.md §10): its ledger, its movements and its statement lines. */
export default function FinanceAccountPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useCapabilities();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("ledger");
  const [dialog, setDialog] = useState<MovementDialogKind | "IMPORT" | "LINE" | "EDIT" | null>(null);
  const [matching, setMatching] = useState<BankTransaction | null>(null);

  const account = useQuery({ queryKey: financeApi.financeKeys.account(id), queryFn: () => financeApi.getFinancialAccount(id) });
  const accounts = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts });
  const ledger = useQuery({ queryKey: [...financeApi.financeKeys.account(id), "ledger"], queryFn: () => financeApi.getAccountLedger(id), enabled: tab === "ledger" });
  const movements = useQuery({ queryKey: [...financeApi.financeKeys.account(id), "movements"], queryFn: () => financeApi.listMovements({ financialAccountId: id, pageSize: 100 }), enabled: tab === "movements" });
  const lines = useQuery({ queryKey: [...financeApi.financeKeys.account(id), "statement"], queryFn: () => financeApi.listBankTransactions({ financialAccountId: id, pageSize: 200 }), enabled: tab === "statement" });

  const act = useMutation({
    mutationFn: async ({ movementId, action }: { movementId: string; action: "approve" | "reject" | "reverse" }) => {
      if (action === "approve") await financeApi.approveMovement(movementId);
      else if (action === "reject") await financeApi.rejectMovement(movementId, "Rejected from the account page");
      else await financeApi.reverseMovement(movementId, "Reversed from the account page");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });
      toast.success("Done — the books were updated by a journal");
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't update the movement")),
  });

  if (account.isError) return <EmptyState icon={Landmark} title="Account not found" />;
  const a = account.data;
  const all = accounts.data?.financialAccounts ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={a?.name ?? "Money account"}
        eyebrow={a ? `${financeApi.ACCOUNT_KIND_LABEL[a.kind]}${a.provider ? ` · ${a.provider}` : ""}${a.accountReference ? ` · ${a.accountReference}` : ""}` : undefined}
        descriptionOnPhone
        description={a?.accountTitle ? `${a.accountTitle}${a.branch ? ` · ${a.branch} branch` : ""}` : undefined}
        action={
          <div className="flex flex-wrap gap-2">
            {can("finance.transact") && (
              <>
                <Button size="sm" variant="outline" onClick={() => setDialog("DEPOSIT")}>Deposit</Button>
                <Button size="sm" variant="outline" onClick={() => setDialog("WITHDRAWAL")}>Withdrawal</Button>
                <Button size="sm" onClick={() => setDialog("TRANSFER")}>Transfer</Button>
              </>
            )}
            {can("finance.configure") && a && (
              <Button size="sm" variant="secondary" onClick={() => setDialog("EDIT")} data-testid="edit-account">Edit</Button>
            )}
          </div>
        }
      />

      {a && (
        <div className="grid gap-3 sm:grid-cols-4" data-testid="account-balances">
          {[
            ["Balance", formatPrice(a.currentBalance)],
            ["Opening balance", formatPrice(a.openingBalance)],
            ["Reconciled to", a.lastReconciledThrough ?? "never"],
            ["Approval above", a.approvalThreshold === null ? "no approval step" : formatPrice(a.approvalThreshold)],
          ].map(([label, value]) => (
            <Card key={label} className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">{value}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-full border border-line-subtle p-1" role="tablist">
          {(["ledger", "movements", "statement"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-full px-3 py-1 text-sm", tab === t ? "bg-accent text-accent-fg" : "text-ink-600 hover:text-ink-900")}>
              {t === "ledger" ? "Ledger" : t === "movements" ? "Movements" : "Statement lines"}
            </button>
          ))}
        </div>
        {tab === "statement" && can("finance.transact") && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialog("LINE")}>Add line</Button>
            <Button size="sm" onClick={() => setDialog("IMPORT")} data-testid="open-import">Import CSV</Button>
          </div>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          {tab === "ledger" && (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Journal</TableHeaderCell>
                  <TableHeaderCell>Description</TableHeaderCell>
                  <TableHeaderCell align="right">In</TableHeaderCell>
                  <TableHeaderCell align="right">Out</TableHeaderCell>
                  <TableHeaderCell align="right">Balance</TableHeaderCell>
                </tr>
              </TableHead>
              <tbody>
                {ledger.data?.lines.map((l) => (
                  <TableRow key={`${l.entryId}-${l.debit}-${l.credit}`}>
                    <TableCell>{l.entryDate}</TableCell>
                    <TableCell className="text-ink-500">#{l.number} · {l.kind.toLowerCase()}</TableCell>
                    <TableCell>{l.description}</TableCell>
                    <TableCell align="right" className="tabular-nums">{l.debit ? formatPrice(l.debit) : ""}</TableCell>
                    <TableCell align="right" className="tabular-nums">{l.credit ? formatPrice(l.credit) : ""}</TableCell>
                    <TableCell align="right" className="font-medium tabular-nums">{formatPrice(l.balance)}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
          {tab === "movements" && (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Movement</TableHeaderCell>
                  <TableHeaderCell>Description</TableHeaderCell>
                  <TableHeaderCell align="right">Amount</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell />
                </tr>
              </TableHead>
              <tbody>
                {movements.data?.movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.movementDate}</TableCell>
                    <TableCell className="text-ink-600">
                      {m.kind.toLowerCase().replace("_", " ")} · {m.fromAccount?.name ?? m.counterAccount?.name ?? "—"} → {m.toAccount?.name ?? m.counterAccount?.name ?? "—"}
                    </TableCell>
                    <TableCell>{m.description}{m.reference && <span className="ml-2 text-xs text-ink-500">{m.reference}</span>}</TableCell>
                    <TableCell align="right" className="tabular-nums">{formatPrice(m.amount)}</TableCell>
                    <TableCell><Badge variant={MOVEMENT_BADGE[m.status]}>{m.status.replace("_", " ").toLowerCase()}</Badge></TableCell>
                    <TableCell align="right">
                      {m.status === "PENDING_APPROVAL" && can("finance.post") && (
                        <span className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => act.mutate({ movementId: m.id, action: "reject" })}>{m.receiverAdminId ? "Cancel" : "Reject"}</Button>
                          {m.receiverAdminId ? (
                            <span className="self-center text-xs text-ink-500">Waiting for the receiver</span>
                          ) : (
                            <Button size="sm" onClick={() => act.mutate({ movementId: m.id, action: "approve" })}>Approve</Button>
                          )}
                        </span>
                      )}
                      {m.status === "POSTED" && can("finance.reverse") && (
                        <Button size="sm" variant="ghost" onClick={() => act.mutate({ movementId: m.id, action: "reverse" })}>Reverse</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
          {tab === "statement" && (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Description</TableHeaderCell>
                  <TableHeaderCell align="right">Money in</TableHeaderCell>
                  <TableHeaderCell align="right">Money out</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell />
                </tr>
              </TableHead>
              <tbody>
                {lines.data?.bankTransactions.map((l) => (
                  <TableRow key={l.id} data-testid="statement-line">
                    <TableCell>{l.transactionDate}</TableCell>
                    <TableCell>{l.description}{l.reference && <span className="ml-2 text-xs text-ink-500">{l.reference}</span>}</TableCell>
                    <TableCell align="right" className="tabular-nums">{l.credit ? formatPrice(l.credit) : ""}</TableCell>
                    <TableCell align="right" className="tabular-nums">{l.debit ? formatPrice(l.debit) : ""}</TableCell>
                    <TableCell>
                      <Badge variant={LINE_BADGE[l.status]}>{l.status.replace("_", " ").toLowerCase()}</Badge>
                      {l.status === "PARTIALLY_MATCHED" && <span className="ml-2 text-xs text-ink-500">{formatPrice(l.unmatchedAmount)} open</span>}
                    </TableCell>
                    <TableCell align="right">
                      {can("finance.reconcile") && (
                        <Button size="sm" variant="ghost" onClick={() => setMatching(l)}>{l.status === "RECONCILED" || l.status === "MATCHED" ? "View" : "Match"}</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
        </HScrollShadow>
        {tab === "statement" && lines.data?.bankTransactions.length === 0 && (
          <EmptyState icon={Landmark} title="No statement lines yet" description="Import the CSV statement from your bank, wallet or gateway, or add lines by hand." />
        )}
      </Card>

      {dialog === "EDIT" && a && <AccountDialog account={a} onClose={() => setDialog(null)} />}
      {dialog && dialog !== "IMPORT" && dialog !== "LINE" && dialog !== "EDIT" && <MoneyMovementDialog kind={dialog} accounts={all} accountId={id} onClose={() => setDialog(null)} />}
      {dialog === "IMPORT" && <StatementImportDialog accountId={id} onClose={() => setDialog(null)} />}
      {dialog === "LINE" && <StatementLineDialog accountId={id} onClose={() => setDialog(null)} />}
      {matching && <MatchDialog line={lines.data?.bankTransactions.find((l) => l.id === matching.id) ?? matching} accounts={all} onClose={() => setMatching(null)} />}
    </div>
  );
}
