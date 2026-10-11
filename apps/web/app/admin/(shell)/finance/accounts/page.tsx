"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronDown, Landmark, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { AccountDialog } from "@/components/admin/finance/account-dialog";
import { MoneyMovementDialog, type MovementDialogKind } from "@/components/admin/finance/money-movement-dialog";
import { useCapabilities } from "@/hooks/use-capability";
import { useCreateParam } from "@/hooks/use-create-param";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import { formatBookDate, formatPrice } from "@/lib/format";

/** Money accounts (docs/FINANCE_PHASE_2.md §10): cash, banks, wallets and gateways with their ledger balances, the money
 * movements between them, and the movements waiting for approval. */
export default function FinanceAccountsPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const accounts = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts, enabled: allowed });
  const pending = useQuery({ queryKey: [...financeApi.financeKeys.all, "movements", "pending"], queryFn: () => financeApi.listMovements({ status: "PENDING_APPROVAL", pageSize: 50 }), enabled: allowed });
  const [dialog, setDialog] = useState<MovementDialogKind | "ACCOUNT" | null>(null);
  useCreateParam("deposit", () => setDialog("DEPOSIT"));
  useCreateParam("withdrawal", () => setDialog("WITHDRAWAL"));
  useCreateParam("transfer", () => setDialog("TRANSFER"));

  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      await (approve ? financeApi.approveMovement(id) : financeApi.rejectMovement(id, "Rejected from the approvals list"));
    },
    onSuccess: (_r, v) => {
      void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });
      toast.success(v.approve ? "Approved and posted" : "Rejected — nothing moved");
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't decide on the movement")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Landmark} title="Finance is limited to the owner" />
      </div>
    );
  }
  const list = accounts.data?.financialAccounts ?? [];
  const total = list.filter((a) => a.isActive).reduce((s, a) => s + a.currentBalance, 0);

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Money accounts"
        description="Cash, banks, wallets and gateways. Every balance is read from the books; money only moves by a recorded movement."
        action={
          <div className="flex flex-wrap gap-2">
            {can("finance.configure") && (
              <Button variant="outline" size="sm" onClick={() => setDialog("ACCOUNT")}>New account</Button>
            )}
            {can("finance.transact") && <RecordMovementMenu onPick={setDialog} />}
          </div>
        }
      />

      {(pending.data?.movements.length ?? 0) > 0 && (
        <Card className="p-4" data-testid="pending-approvals">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Waiting for approval</h2>
          <ul className="divide-y divide-line-subtle text-sm">
            {pending.data!.movements.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="flex-1 text-ink-800">
                  {m.movementDate} · {m.kind.toLowerCase().replace("_", " ")} · {m.fromAccount?.name ?? m.counterAccount?.name} → {m.toAccount?.name ?? m.counterAccount?.name} · {m.description}
                </span>
                <span className="font-medium tabular-nums">{formatPrice(m.amount)}</span>
                {can("finance.post") && (
                  <span className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: m.id, approve: false })}>Reject</Button>
                    <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ id: m.id, approve: true })}>Approve</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-500">Above an account&apos;s approval amount, the person who asked can&apos;t approve their own movement.</p>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Account</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Reference</TableHeaderCell>
                <TableHeaderCell align="right">Opening</TableHeaderCell>
                <TableHeaderCell align="right">Balance</TableHeaderCell>
                <TableHeaderCell className="whitespace-nowrap">Reconciled to</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {accounts.isLoading && <TableSkeleton rows={4} cols={7} />}
              {list.map((a) => (
                <TableRow key={a.id} data-testid="money-account-row">
                  <TableCell>
                    <Link className="font-medium text-ink-900 hover:underline" href={`/admin/finance/accounts/${a.id}`}>
                      {a.name}
                    </Link>
                    {a.provider && <span className="ml-2 text-xs text-ink-500">{a.provider}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{financeApi.ACCOUNT_KIND_LABEL[a.kind]}</TableCell>
                  <TableCell className="text-ink-500">{a.accountReference ?? (a.accountNumberLast4 ? `••••${a.accountNumberLast4}` : "—")}</TableCell>
                  <TableCell align="right" className="tabular-nums text-ink-500">{formatPrice(a.openingBalance)}</TableCell>
                  <TableCell align="right" className={a.currentBalance < 0 ? "font-semibold tabular-nums text-danger-700" : "font-semibold tabular-nums"}>{formatPrice(a.currentBalance)}</TableCell>
                  <TableCell className="whitespace-nowrap text-ink-500">{a.lastReconciledThrough ? formatBookDate(a.lastReconciledThrough) : "never"}</TableCell>
                  <TableCell>
                    <Badge variant={a.isActive ? "success" : "neutral"}>{a.isActive ? "Active" : "Inactive"}</Badge>
                    {a.pendingMovements > 0 && <Badge variant="warning" className="ml-1">{a.pendingMovements} pending</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
        {accounts.data && list.length === 0 && <EmptyState icon={Landmark} title="No money accounts yet" description="Add your cash box, bank accounts and wallets." />}
        {list.length > 0 && (
          <div className="flex justify-end border-t border-line-subtle px-4 py-3 text-sm">
            <span className="text-ink-500">Total in active accounts</span>
            <span className="ml-3 font-semibold tabular-nums">{formatPrice(total)}</span>
          </div>
        )}
      </Card>

      {dialog === "ACCOUNT" && <AccountDialog onClose={() => setDialog(null)} />}
      {dialog && dialog !== "ACCOUNT" && <MoneyMovementDialog kind={dialog} accounts={list} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** One primary action — "Record movement" — instead of four buttons; the menu names each kind of movement. */
function RecordMovementMenu({ onPick }: { onPick: (kind: MovementDialogKind) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={ref} size="sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} data-testid="record-movement">
        Record movement <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </Button>
      <DropdownMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        items={[
          { label: "Deposit", icon: ArrowDownLeft, onClick: () => onPick("DEPOSIT") },
          { label: "Withdrawal", icon: ArrowUpRight, onClick: () => onPick("WITHDRAWAL") },
          { label: "Transfer", icon: ArrowLeftRight, onClick: () => onPick("TRANSFER") },
          { label: "Adjustment", icon: SlidersHorizontal, onClick: () => onPick("ADJUSTMENT") },
        ]}
      />
    </>
  );
}
