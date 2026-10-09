"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { FinancialAccount, MovementKind } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";

export type MovementDialogKind = Exclude<MovementKind, "OPENING_FUNDING" | "SUPPLIER_PAYMENT">;

const TITLES: Record<MovementDialogKind, { title: string; description: string }> = {
  DEPOSIT: { title: "Deposit", description: "Money coming into an account from outside it — the owner's capital, a loan, a refund received. Sales arrive from orders, not here." },
  WITHDRAWAL: { title: "Withdrawal", description: "Money leaving an account to something outside it — drawings, a loan repayment, an expense paid in cash." },
  TRANSFER: { title: "Transfer", description: "Money moving between two of your own accounts. It is neither income nor an expense." },
  ADJUSTMENT: { title: "Adjustment", description: "An explicit correction with a reason — a bank charge, interest, a cash count difference. It posts a journal; nothing is overwritten." },
};

/** Ledger accounts a deposit / withdrawal / adjustment may post against: postable, active, not revenue or COGS (orders
 * bring those) and not a money account (that's a transfer). Mirrors the server's rule — the API still decides. */
export function counterAccountsFor(all: financeApi.LedgerAccountSummary[], accounts: FinancialAccount[]) {
  const money = new Set(accounts.map((a) => a.ledgerAccount.id));
  return all.filter((a) => a.isPostable && a.isActive && a.type !== "REVENUE" && a.type !== "COGS" && !money.has(a.id));
}

const today = () => new Date().toISOString().slice(0, 10);

export function MoneyMovementDialog({ kind, accounts, accountId, onClose }: { kind: MovementDialogKind; accounts: FinancialAccount[]; accountId?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const active = accounts.filter((a) => a.isActive);
  const ledger = useQuery({ queryKey: financeApi.financeKeys.ledgerAccounts(), queryFn: financeApi.listLedgerAccounts, enabled: kind !== "TRANSFER" });
  const counters = useMemo(() => counterAccountsFor(ledger.data?.accounts ?? [], accounts), [ledger.data, accounts]);

  const [movementDate, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(kind === "WITHDRAWAL" || kind === "TRANSFER" ? (accountId ?? "") : "");
  const [to, setTo] = useState(kind === "DEPOSIT" ? (accountId ?? "") : "");
  const [account, setAccount] = useState(accountId ?? "");
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const [counter, setCounter] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");

  const body = (() => {
    const base = { movementDate, amount: Number(amount), reference: reference.trim() || null, description: description.trim() };
    switch (kind) {
      case "DEPOSIT":
        return { ...base, toFinancialAccountId: to, counterAccountId: counter };
      case "WITHDRAWAL":
        return { ...base, fromFinancialAccountId: from, counterAccountId: counter };
      case "TRANSFER":
        return { ...base, fromFinancialAccountId: from, toFinancialAccountId: to };
      case "ADJUSTMENT":
        return { ...base, financialAccountId: account, direction, counterAccountId: counter, reason: reason.trim() };
    }
  })();
  const valid =
    Number(amount) > 0 &&
    description.trim().length > 0 &&
    (kind === "TRANSFER" ? Boolean(from && to && from !== to) : Boolean(counter)) &&
    (kind === "DEPOSIT" ? Boolean(to) : kind === "WITHDRAWAL" ? Boolean(from) : kind === "ADJUSTMENT" ? Boolean(account) && reason.trim().length >= 3 : true);

  const scope = `finance-movement:${kind}`;
  const submit = useMutation({
    mutationFn: () => financeApi.requestMovement(kind, body, idempotencyKeyFor(scope, body)),
    onSuccess: ({ movement }) => {
      settleIdempotencyKey(scope);
      void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });
      toast.success(movement.status === "PENDING_APPROVAL" ? `${TITLES[kind].title} of ${formatPrice(movement.amount)} is waiting for approval` : `${TITLES[kind].title} of ${formatPrice(movement.amount)} posted`);
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, "The movement couldn't be recorded")),
  });

  const accountOptions = (exclude?: string) => [
    <option key="" value="">
      Choose an account…
    </option>,
    ...active.filter((a) => a.id !== exclude).map((a) => (
      <option key={a.id} value={a.id}>
        {a.name} — {formatPrice(a.currentBalance)}
      </option>
    )),
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={TITLES[kind].title}
      description={TITLES[kind].description}
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={submit.isPending} onClick={() => submit.mutate()} data-testid="submit-movement">
            Record {TITLES[kind].title.toLowerCase()}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2" data-testid={`movement-dialog-${kind.toLowerCase()}`}>
        {(kind === "WITHDRAWAL" || kind === "TRANSFER") && (
          <Field htmlFor="mv-from" label="From" required>
            <Select id="mv-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              {accountOptions(kind === "TRANSFER" ? to : undefined)}
            </Select>
          </Field>
        )}
        {(kind === "DEPOSIT" || kind === "TRANSFER") && (
          <Field htmlFor="mv-to" label="To" required>
            <Select id="mv-to" value={to} onChange={(e) => setTo(e.target.value)}>
              {accountOptions(kind === "TRANSFER" ? from : undefined)}
            </Select>
          </Field>
        )}
        {kind === "ADJUSTMENT" && (
          <>
            <Field htmlFor="mv-account" label="Account" required>
              <Select id="mv-account" value={account} onChange={(e) => setAccount(e.target.value)}>
                {accountOptions()}
              </Select>
            </Field>
            <Field htmlFor="mv-direction" label="Direction" required>
              <Select id="mv-direction" value={direction} onChange={(e) => setDirection(e.target.value as "IN" | "OUT")}>
                <option value="IN">Money in (increase)</option>
                <option value="OUT">Money out (decrease)</option>
              </Select>
            </Field>
          </>
        )}
        {kind !== "TRANSFER" && (
          <Field htmlFor="mv-counter" label="Other side" required hint="Capital, drawings, a loan, an expense, other income…" className="sm:col-span-2">
            <Select id="mv-counter" value={counter} onChange={(e) => setCounter(e.target.value)}>
              <option value="">{ledger.isLoading ? "Loading accounts…" : "Choose an account…"}</option>
              {counters.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field htmlFor="mv-date" label="Date" required>
          <Input id="mv-date" type="date" value={movementDate} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field htmlFor="mv-amount" label="Amount" required>
          <Input id="mv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field htmlFor="mv-description" label="Description" required className="sm:col-span-2">
          <Input id="mv-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </Field>
        <Field htmlFor="mv-reference" label="Reference" hint="Cheque, slip or transaction number" className="sm:col-span-2">
          <Input id="mv-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
        </Field>
        {kind === "ADJUSTMENT" && (
          <Field htmlFor="mv-reason" label="Reason" required className="sm:col-span-2">
            <Textarea id="mv-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
          </Field>
        )}
      </div>
      {kind === "TRANSFER" && from && to && accounts.find((a) => a.id === from)?.brandId !== accounts.find((a) => a.id === to)?.brandId && (
        <Alert variant="warning" title="Different brands" className="mt-4">
          These accounts belong to different brands; moving money between brands isn&apos;t supported yet.
        </Alert>
      )}
    </Modal>
  );
}
