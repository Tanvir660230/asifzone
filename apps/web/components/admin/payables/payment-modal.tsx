"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as purchasingApi from "@/lib/api/purchasing";
import type { SupplierAccount } from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";

const cents = (v: string) => Math.round(Number(v) * 100);

/** Paying a supplier (docs/FINANCE_PHASE_4F.md): money out of a cash, bank or wallet account, settling the bills ticked.
 * Anything not set against a bill stays on the supplier's account as an advance. Large payments wait for approval in
 * Money accounts, as every money movement does. */
export function SupplierPaymentModal({ account, onClose, onDone }: { account: SupplierAccount; onClose: () => void; onDone: () => void }) {
  const accounts = useQuery({ queryKey: ["finance", "financial-accounts"], queryFn: financeApi.listFinancialAccounts });
  const money = useMemo(() => (accounts.data?.financialAccounts ?? []).filter((a) => a.isActive && ["CASH", "BANK", "MOBILE_WALLET"].includes(a.kind)), [accounts.data]);
  const bills = account.openBills.filter((b) => b.allocatable > 0);
  const [from, setFrom] = useState("");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>(() => Object.fromEntries(bills.map((b) => [b.id, String(b.allocatable)])));
  const [ticked, setTicked] = useState<Record<string, boolean>>(() => Object.fromEntries(bills.map((b) => [b.id, true])));
  const allocated = bills.filter((b) => ticked[b.id]).reduce((s, b) => s + (cents(picked[b.id] ?? "0") || 0), 0);
  const [amount, setAmount] = useState<string>("");
  const amountCents = amount.trim() === "" ? allocated : cents(amount);
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random()}`));
  const lineError = (id: string) => {
    if (!ticked[id]) return null;
    const v = cents(picked[id] ?? "");
    const b = bills.find((x) => x.id === id)!;
    if (!(v > 0)) return "More than zero";
    if (v > Math.round(b.allocatable * 100)) return `At most ${formatPrice(b.allocatable)}`;
    return null;
  };
  const errors = bills.map((b) => lineError(b.id)).filter(Boolean);
  const valid = Boolean(from) && amountCents > 0 && allocated <= amountCents && !errors.length;
  const pay = useMutation({
    mutationFn: () => purchasingApi.paySupplier({
      supplierId: account.supplier.id, fromFinancialAccountId: from, movementDate: date || undefined, amount: amountCents / 100, reference: reference.trim() || null,
      allocations: bills.filter((b) => ticked[b.id]).map((b) => ({ invoiceId: b.id, amount: cents(picked[b.id]!) / 100 })),
    }, key),
    onSuccess: (r) => { toast.success(r.payment.status === "POSTED" ? `Paid ${formatPrice(r.payment.amount)}` : "Payment recorded — it waits for approval in Money accounts"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The payment couldn't be recorded")),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Pay ${account.supplier.displayName}`}
      description="Money leaves the account you choose; the ticked bills are settled by it."
      widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={pay.isPending} disabled={!valid} onClick={() => pay.mutate()} data-testid="confirm-payment">Pay {amountCents > 0 ? formatPrice(amountCents / 100) : ""}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="pay-from" label="Pay from" required>
            <Select id="pay-from" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="payment-from">
              <option value="">Choose…</option>
              {money.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field htmlFor="pay-date" label="Payment date" hint="Today if left empty."><Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field htmlFor="pay-ref" label="Reference" hint="Cheque number, transfer ID…"><Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} /></Field>
          <Field htmlFor="pay-amount" label="Amount" hint={`Empty = the bills ticked (${formatPrice(allocated / 100)}). More is kept as an advance.`} error={amountCents < allocated ? "Less than the bills ticked" : undefined}>
            <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(allocated / 100)} data-testid="payment-amount" />
          </Field>
        </div>
        {accounts.data && money.length === 0 && <Alert variant="warning" title="No cash, bank or wallet account yet">Add one in Finance → Money accounts to pay suppliers from it.</Alert>}
        {accounts.isError && <Alert variant="danger" title="Money accounts couldn't be loaded">{getErrorMessage(accounts.error, "")}</Alert>}
        {bills.length ? (
          <ul className="space-y-2">
            {bills.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3">
                <label className="flex min-w-0 items-start gap-2 text-sm">
                  <Checkbox checked={Boolean(ticked[b.id])} onChange={(e) => setTicked((t) => ({ ...t, [b.id]: e.target.checked }))} aria-label={`Settle ${b.number}`} />
                  <span><span className="font-mono text-ink-900">{b.number}</span> <span className="text-ink-600">· {b.supplierRef} · due <span className={b.overdue ? "text-danger-700" : undefined}>{b.dueDate}</span></span><span className="block text-xs text-ink-500">{formatPrice(b.allocatable)} open of {formatPrice(b.total)}</span></span>
                </label>
                {ticked[b.id] && (
                  <div className="w-36">
                    <Input aria-label={`Amount for ${b.number}`} inputMode="decimal" value={picked[b.id] ?? ""} onChange={(e) => setPicked((p) => ({ ...p, [b.id]: e.target.value }))} />
                    {lineError(b.id) && <p className="mt-1 text-xs text-danger-700">{lineError(b.id)}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-600">No open bills — the whole payment is kept as an advance.</p>
        )}
      </div>
    </Modal>
  );
}
