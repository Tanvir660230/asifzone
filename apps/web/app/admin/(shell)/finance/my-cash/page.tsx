"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Banknote, Calculator, Check, Receipt, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as booksApi from "@/lib/api/finance-books";
import type { Movement } from "@/lib/api/finance";
import { formatBookDate, formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";

const today = () => new Date().toLocaleDateString("en-CA");
const STATUS: Record<Movement["status"], { label: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  POSTED: { label: "done", variant: "success" }, PENDING_APPROVAL: { label: "waiting", variant: "warning" }, REJECTED: { label: "rejected", variant: "danger" }, REVERSED: { label: "reversed", variant: "neutral" },
};

/** Owner's books §2: the cash the signed-in person holds — hand it over, confirm what reached them, count it, pay from it. */
export default function MyCashPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.custody");
  const me = useQuery({ queryKey: booksApi.booksKeys.custody(), queryFn: booksApi.getMyCustody, enabled: allowed });
  const [dialog, setDialog] = useState<null | "handover" | "count" | "expense">(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finance"] });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Banknote} title="Cash isn't part of your role" />
      </div>
    );
  }
  const d = me.data;
  const hasCash = Boolean(d?.accounts.length);
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="My cash"
        description="The cash you hold. Hand it over, confirm what reached you, count it at the end of the day, and pay small costs from it."
        action={hasCash && (
          <div className="flex flex-wrap gap-2" data-phone-row>
            <Button size="sm" onClick={() => setDialog("handover")} data-testid="cash-handover"><ArrowRightLeft className="h-4 w-4" /> Hand over</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("count")} data-testid="cash-count"><Calculator className="h-4 w-4" /> Count cash</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("expense")} data-testid="cash-expense"><Receipt className="h-4 w-4" /> Pay a cost</Button>
          </div>
        )}
      />

      {me.isLoading && <Skeleton className="h-40 w-full" />}
      {me.isError && <Alert variant="danger" title="Your cash couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => me.refetch()}>Retry</Button>}>{getErrorMessage(me.error, "")}</Alert>}

      {d && (
        <>
          {d.incoming.length > 0 && (
            <Card className="space-y-3 border-warning-300 bg-warning-50/40 p-4 sm:p-5" data-testid="incoming-handovers">
              <h2 className="text-[17px] font-semibold tracking-tight text-fg">Waiting for you to confirm</h2>
              <p className="text-sm text-fg-muted">Confirm only once the cash is in your hand — until then it still counts as the sender’s.</p>
              <ul className="divide-y divide-line-subtle">
                {d.incoming.map((m) => <IncomingRow key={m.id} m={m} onDone={refresh} />)}
              </ul>
            </Card>
          )}

          {!hasCash ? (
            <EmptyState icon={Banknote} title="You don't hold a cash box yet" description="The owner gives a cash account to a person in Finance › Money accounts (Held by). Then it shows here." />
          ) : (
            <Card className="p-5 sm:p-6">
              <div className="flex items-baseline justify-between gap-3 border-b border-line-subtle pb-3">
                <h2 className="text-[17px] font-semibold tracking-tight text-fg">With you now</h2>
                <span className="text-xl font-semibold tabular-nums text-fg" data-testid="cash-total">{formatPrice(d.total)}</span>
              </div>
              <ul className="divide-y divide-line-subtle">
                {d.accounts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="text-fg">{a.name}</span>
                    <span className="tabular-nums text-fg">{formatPrice(a.balance)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {d.outgoing.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-fg">You sent, waiting</h2>
              <Card className="divide-y divide-line p-0 text-sm">
                {d.outgoing.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="text-fg">{m.description}</span>
                      <span className="block text-xs text-fg-muted">{formatBookDate(m.movementDate)} · {m.fromAccount?.name ?? "—"} → {m.toAccount?.name ?? m.counterAccount?.name ?? "—"}{m.receiverAdminId ? " · waiting for the receiver" : " · waiting for the owner"}</span>
                    </span>
                    <span className="tabular-nums text-fg">{formatPrice(m.amount)}</span>
                  </div>
                ))}
              </Card>
            </section>
          )}

          {hasCash && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-fg">Your counts</h2>
              {d.counts.length === 0 ? (
                <p className="text-sm text-fg-muted">No counts yet. Count the cash at the end of each day — a shortage or extra is recorded with its reason.</p>
              ) : (
                <Card className="divide-y divide-line p-0 text-sm">
                  {d.counts.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" data-testid="count-row">
                      <span className="min-w-0">
                        <span className="text-fg">{formatBookDate(c.countDate)} · {c.financialAccount.name}</span>
                        <span className="block text-xs text-fg-muted">Counted {formatPrice(c.counted)} · books said {formatPrice(c.expected)}{c.note ? ` · ${c.note}` : ""}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {c.difference === 0 ? <Badge variant="success">matched</Badge> : <Badge variant={c.difference < 0 ? "danger" : "warning"}>{c.difference < 0 ? "short" : "over"} {formatPrice(Math.abs(c.difference))}</Badge>}
                        {c.adjustment && c.adjustment.status !== "POSTED" && <Badge variant={STATUS[c.adjustment.status].variant}>{STATUS[c.adjustment.status].label}</Badge>}
                      </span>
                    </div>
                  ))}
                </Card>
              )}
            </section>
          )}
        </>
      )}

      {d && dialog === "handover" && <HandoverModal me={d} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {d && dialog === "count" && <CountModal me={d} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {d && dialog === "expense" && <ExpenseModal me={d} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
    </div>
  );
}

function IncomingRow({ m, onDone }: { m: Movement; onDone: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const confirm = useMutation({ mutationFn: () => booksApi.confirmHandover(m.id), onSuccess: () => { toast.success(`${formatPrice(m.amount)} received`); onDone(); }, onError: (e) => toast.error(getErrorMessage(e, "Couldn't confirm")) });
  const reject = useMutation({ mutationFn: () => booksApi.rejectHandover(m.id, reason.trim()), onSuccess: () => { toast.success("Handover rejected — nothing moved"); onDone(); }, onError: (e) => toast.error(getErrorMessage(e, "Couldn't reject")) });
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="incoming-row">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{formatPrice(m.amount)} from {m.fromAccount?.name ?? "—"}</span>
        <span className="block text-xs text-fg-muted">{formatBookDate(m.movementDate)} · {m.description}</span>
      </span>
      {rejecting ? (
        <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Input aria-label="Why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why — e.g. never received" className="min-w-0 flex-1 sm:w-56" />
          <Button size="sm" variant="outline" onClick={() => setRejecting(false)}>Back</Button>
          <Button size="sm" variant="destructive" disabled={reason.trim().length < 3} loading={reject.isPending} onClick={() => reject.mutate()}>Reject</Button>
        </span>
      ) : (
        <span className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => setRejecting(true)}><X className="h-4 w-4" /> Not received</Button>
          <Button size="sm" className="flex-1 sm:flex-none" loading={confirm.isPending} onClick={() => confirm.mutate()} data-testid="confirm-handover"><Check className="h-4 w-4" /> I received it</Button>
        </span>
      )}
    </li>
  );
}

function HandoverModal({ me, onClose, onDone }: { me: booksApi.MyCustody; onClose: () => void; onDone: () => void }) {
  const [fromId, setFromId] = useState(me.accounts[0]?.id ?? "");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const to = me.destinations.find((x) => x.id === toId);
  const body = { fromFinancialAccountId: fromId, toFinancialAccountId: toId, amount: Number(amount), movementDate: date, description: description.trim() || "Cash handover" };
  const save = useMutation({
    mutationFn: () => booksApi.requestHandover(body, idempotencyKeyFor("handover", body)),
    onSuccess: (r) => { settleIdempotencyKey("handover"); toast.success(r.movement.status === "POSTED" ? "Handed over" : r.movement.receiverAdminId ? "Sent — it waits for the receiver to confirm" : "Sent — it waits for the owner"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The handover couldn't be recorded")),
  });
  return (
    <Modal open onClose={onClose} title="Hand over cash" description="The money moves when the receiver confirms they have it." widthClassName="max-w-lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!fromId || !toId || !(Number(amount) > 0)} loading={save.isPending} onClick={() => save.mutate()} data-testid="confirm-handover-send">Hand over {Number(amount) > 0 ? formatPrice(Number(amount)) : ""}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="ho-from" label="From">
          <Select id="ho-from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {me.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatPrice(a.balance)})</option>)}
          </Select>
        </Field>
        <Field htmlFor="ho-to" label="To" required hint={to ? (to.custodian ? `${to.custodian.name} confirms receiving it` : "The owner approves it") : undefined}>
          <Select id="ho-to" value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">Choose…</option>
            {me.destinations.map((a) => <option key={a.id} value={a.id}>{a.name}{a.custodian ? ` — ${a.custodian.name}` : ""}</option>)}
          </Select>
        </Field>
        <Field htmlFor="ho-amount" label="Amount" required><Input id="ho-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field htmlFor="ho-date" label="Date"><Input id="ho-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="ho-desc" label="Note" className="sm:col-span-2"><Input id="ho-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Today's COD cash" maxLength={300} /></Field>
      </div>
    </Modal>
  );
}

function CountModal({ me, onClose, onDone }: { me: booksApi.MyCustody; onClose: () => void; onDone: () => void }) {
  const [accountId, setAccountId] = useState(me.accounts[0]?.id ?? "");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const account = me.accounts.find((a) => a.id === accountId);
  const diff = counted === "" || !account ? null : Number(counted) - account.balance;
  const body = { financialAccountId: accountId, countDate: today(), counted: Number(counted), note: note.trim() || null };
  const save = useMutation({
    mutationFn: () => booksApi.recordCashCount(body, idempotencyKeyFor("cash-count", body)),
    onSuccess: (r) => { settleIdempotencyKey("cash-count"); toast.success(r.count.difference === 0 ? "Counted — it matches" : `Counted — ${r.count.difference < 0 ? "short" : "over"} by ${formatPrice(Math.abs(r.count.difference))}`); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The count couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title="Count your cash" description="Count the notes in hand. A difference is recorded with your note and shown to the owner." widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!accountId || counted === "" || !(Number(counted) >= 0) || (diff !== null && diff !== 0 && note.trim().length < 3)} loading={save.isPending} onClick={() => save.mutate()} data-testid="confirm-count">Save count</Button></>}>
      <div className="grid gap-3">
        {me.accounts.length > 1 && (
          <Field htmlFor="cc-acc" label="Cash account">
            <Select id="cc-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{me.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </Field>
        )}
        <Field htmlFor="cc-counted" label="Counted" required><Input id="cc-counted" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus /></Field>
        {account && diff !== null && Number.isFinite(diff) && (
          <p className={diff === 0 ? "text-sm text-success-700" : "text-sm text-warning-700"} data-testid="count-difference">
            {diff === 0 ? `Matches the books (${formatPrice(account.balance)}).` : `${diff < 0 ? "Short" : "Over"} by ${formatPrice(Math.abs(diff))} — the books say ${formatPrice(account.balance)}.`}
          </p>
        )}
        <Field htmlFor="cc-note" label="Note" hint={diff ? "Say what happened — required when it doesn't match" : undefined}><Input id="cc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
      </div>
    </Modal>
  );
}

function ExpenseModal({ me, onClose, onDone }: { me: booksApi.MyCustody; onClose: () => void; onDone: () => void }) {
  const [fromId, setFromId] = useState(me.accounts[0]?.id ?? "");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [payee, setPayee] = useState("");
  const body = { fromFinancialAccountId: fromId, expenseAccountId: accountId, amount: Number(amount), expenseDate: today(), description: description.trim(), payee: payee.trim() || null };
  const save = useMutation({
    mutationFn: () => booksApi.custodyExpense(body, idempotencyKeyFor("custody-expense", body)),
    onSuccess: (r) => { settleIdempotencyKey("custody-expense"); toast.success(r.expense.status === "POSTED" ? `${r.expense.number} paid` : `${r.expense.number} waits for the owner's approval`); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The cost couldn't be recorded")),
  });
  return (
    <Modal open onClose={onClose} title="Pay a cost from your cash" description="Poly bags, a rickshaw, tea for the delivery boy — it waits for the owner's approval." widthClassName="max-w-lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!fromId || !accountId || !(Number(amount) > 0) || !description.trim()} loading={save.isPending} onClick={() => save.mutate()} data-testid="confirm-cash-expense">Record {Number(amount) > 0 ? formatPrice(Number(amount)) : ""}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="ce-acc" label="What for" required className="sm:col-span-2">
          <Select id="ce-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose…</option>
            {me.expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field htmlFor="ce-amount" label="Amount" required><Input id="ce-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {me.accounts.length > 1 ? (
          <Field htmlFor="ce-from" label="Paid from"><Select id="ce-from" value={fromId} onChange={(e) => setFromId(e.target.value)}>{me.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        ) : <div />}
        <Field htmlFor="ce-desc" label="Description" required className="sm:col-span-2"><Input id="ce-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="100 poly bags" /></Field>
        <Field htmlFor="ce-payee" label="Paid to" className="sm:col-span-2"><Input id="ce-payee" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={200} /></Field>
      </div>
    </Modal>
  );
}
