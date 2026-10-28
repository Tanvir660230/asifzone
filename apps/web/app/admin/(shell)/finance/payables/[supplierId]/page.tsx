"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { SupplierPaymentModal } from "@/components/admin/payables/payment-modal";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as purchasingApi from "@/lib/api/purchasing";
import type { SupplierAccount } from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";
import { listFinancialAccounts } from "@/lib/api/finance";
import { PermissionState } from "@/components/admin/permission-state";

type Source = { kind: "payment"; id: string; label: string; left: number } | { kind: "credit"; id: string; label: string; left: number };

/** One supplier's account (docs/FINANCE_PHASE_4F.md): open bills with what is settled, advances and credit notes not yet
 * set against a bill, and the statement — every posting on the payables account for this supplier, so it always agrees
 * with the books. */
export default function SupplierAccountPage() {
  const { supplierId } = useParams<{ supplierId: string }>();
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("ap.view");
  const q = useQuery({ queryKey: purchasingApi.supplierAccountKey(supplierId), queryFn: () => purchasingApi.getSupplierAccount(supplierId), enabled: allowed });
  const [paying, setPaying] = useState(false);
  const [allocating, setAllocating] = useState<Source | null>(null);
  const [releasing, setReleasing] = useState<SupplierAccount["allocations"][number] | null>(null);
  const [refunding, setRefunding] = useState<Source | null>(null);
  const release = useMutation({
    mutationFn: (reason: string) => purchasingApi.releaseAllocation(releasing!.id, reason),
    onSuccess: () => { toast.success(`${releasing?.bill.number} reopened by ${formatPrice(releasing?.amount ?? 0)}`); setReleasing(null); refresh(); },
    onError: (err) => toast.error(getErrorMessage(err, "The allocation couldn't be released")),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: purchasingApi.purchasingKeys.all });

  if (ready && !allowed) return <PermissionState icon={Wallet} page="Payables" />;
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <Alert variant="danger" title="This supplier's account couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>;
  const a = q.data;
  // What they were owed when the books started has no bill; it was due that day.
  const openingDue = a.openingDue && a.openingDue.outstanding > 0 ? a.openingDue : null;
  const overdue = a.openBills.filter((b) => b.overdue).reduce((s, b) => s + b.outstanding, 0) + (openingDue && openingDue.date < a.asOf ? openingDue.outstanding : 0);
  const sources: Source[] = [
    ...a.advances.map((x) => ({ kind: "payment" as const, id: x.paymentMovementId, label: `Payment ${x.date}${x.reference ? ` · ${x.reference}` : ""}`, left: x.unallocated })),
    ...a.unappliedCredits.map((x) => ({ kind: "credit" as const, id: x.creditNoteId, label: `${x.number} · ${x.supplierRef}`, left: x.unallocated })),
  ];

  return (
    <div className="space-y-6">
      <BackLink href="/admin/finance/payables" label="Payables" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-ink-900">{a.supplier.displayName}</h1>
          <p className="text-sm text-ink-600">{a.supplier.code} · pays in {a.supplier.paymentTermsDays} days · as of {a.asOf}</p>
        </div>
        {can("ap.manage") && <Button size="sm" onClick={() => setPaying(true)} data-testid="pay-supplier">Pay supplier</Button>}
      </div>

      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={a.balance < 0 ? "The supplier owes you" : "You owe"} value={formatPrice(Math.abs(a.balance))} />
        <Stat label="Overdue" value={formatPrice(overdue)} tone={overdue > 0 ? "warning" : undefined} />
        <Stat label="Open bills" value={String(a.openBills.length + (openingDue ? 1 : 0))} />
        <Stat label="Advances and credits" value={formatPrice(sources.reduce((s, x) => s + x.left, 0))} />
      </dl>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-ink-900">Open bills</h2>
        {a.openBills.length || openingDue ? (
          <Card className="divide-y divide-line p-0 text-sm" data-testid="open-bills">
            {openingDue && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" data-testid="opening-due">
                <span className="min-w-0"><span className="text-ink-900">Owed when the books started</span> <span className="text-ink-600">· {openingDue.date}</span>
                  <span className="block text-xs text-ink-500">Payments not set against a bill pay this first.</span></span>
                <span className="text-right tabular-nums"><span className="font-medium text-ink-900">{formatPrice(openingDue.outstanding)}</span><span className="block text-xs text-ink-500">of {formatPrice(openingDue.amount)}{openingDue.paid ? ` · ${formatPrice(openingDue.paid)} paid` : ""}</span></span>
              </div>
            )}
            {a.openBills.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0"><span className="font-mono text-ink-900">{b.number}</span> <span className="text-ink-600">· {b.supplierRef} · due <span className={b.overdue ? "text-danger-700" : undefined}>{b.dueDate}{b.overdue ? " (overdue)" : ""}</span></span>
                  {b.awaitingApproval > 0 && <span className="block text-xs text-warning-700">{formatPrice(b.awaitingApproval)} in a payment awaiting approval</span>}</span>
                <span className="text-right tabular-nums"><span className="font-medium text-ink-900">{formatPrice(b.outstanding)}</span><span className="block text-xs text-ink-500">of {formatPrice(b.total)}{b.settled ? ` · ${formatPrice(b.settled)} settled` : ""}</span></span>
              </div>
            ))}
          </Card>
        ) : (
          <p className="text-sm text-ink-600">Nothing owed on bills.</p>
        )}
      </section>

      {sources.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-ink-900">Advances and credits not yet set against a bill</h2>
          <Card className="divide-y divide-line p-0 text-sm">
            {sources.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span>{s.kind === "payment" ? "Advance" : "Credit note"} · {s.label}</span>
                <span className="flex items-center gap-3"><span className="tabular-nums">{formatPrice(s.left)}</span>{can("ap.manage") && a.openBills.some((b) => b.allocatable > 0) && <Button size="sm" variant="outline" onClick={() => setAllocating(s)}>Set against a bill</Button>}{can("ap.manage") && <Button size="sm" variant="ghost" onClick={() => setRefunding(s)} data-testid="record-refund">Refund received</Button>}</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {a.allocations.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-ink-900">Set against bills</h2>
          <p className="text-sm text-ink-600">Which payments and credit notes settle which bill. Releasing one reopens the bill by its amount and frees the payment or credit to set against another bill — no money moves.</p>
          <Card className="divide-y divide-line p-0 text-sm" data-testid="allocations">
            {a.allocations.map((x) => (
              <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" data-testid="allocation-row">
                <span className="min-w-0"><span className="font-mono text-ink-900">{x.bill.number}</span> <span className="text-ink-600">· {x.bill.supplierRef} ← {x.sourceLabel}</span></span>
                <span className="flex items-center gap-3"><span className="tabular-nums">{formatPrice(x.amount)}</span>{can("ap.manage") && <Button size="sm" variant="ghost" onClick={() => setReleasing(x)} data-testid="release-allocation">Release</Button>}</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-ink-900">Statement</h2>
        {a.statement.length ? (
          <Card className="overflow-hidden p-0">
            <HScrollShadow>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell>Entry</TableHeaderCell>
                    <TableHeaderCell align="right">Billed</TableHeaderCell>
                    <TableHeaderCell align="right">Paid / credited</TableHeaderCell>
                    <TableHeaderCell align="right">Balance</TableHeaderCell>
                  </tr>
                </TableHead>
                <tbody>
                  {a.statement.map((l) => (
                    <TableRow key={l.id} data-testid="statement-row">
                      <TableCell className="whitespace-nowrap tabular-nums">{l.date}</TableCell>
                      <TableCell className="min-w-56">{l.description}{l.reference ? <span className="block text-xs text-ink-500">{l.reference}</span> : null}</TableCell>
                      <TableCell align="right" className="tabular-nums">{l.owedMore ? formatPrice(l.owedMore) : "—"}</TableCell>
                      <TableCell align="right" className="tabular-nums">{l.owedLess ? formatPrice(l.owedLess) : "—"}</TableCell>
                      <TableCell align="right" className="font-medium tabular-nums">{formatPrice(l.balance)}</TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </HScrollShadow>
          </Card>
        ) : (
          <EmptyState icon={Wallet} title="No activity yet" description="Bills, credit notes and payments for this supplier show here." />
        )}
      </section>

      {paying && <SupplierPaymentModal account={a} onClose={() => setPaying(false)} onDone={() => { setPaying(false); refresh(); }} />}
      {releasing && <ReasonModal title={`Release ${formatPrice(releasing.amount)} from ${releasing.bill.number}`} hint={`${releasing.bill.number} owes this amount again; ${releasing.source === "PAYMENT" ? "the payment" : "the credit note"} can be set against another bill.`} loading={release.isPending} onClose={() => setReleasing(null)} onConfirm={(reason) => release.mutate(reason)} />}
      {refunding && <RefundModal supplierId={a.supplier.id} source={refunding} onClose={() => setRefunding(null)} onDone={() => { setRefunding(null); refresh(); }} />}
      {allocating && <AllocateModal account={a} source={allocating} onClose={() => setAllocating(null)} onDone={() => { setAllocating(null); refresh(); }} />}
    </div>
  );
}

/** Money the supplier paid back from an advance or a credit: into cash, a bank or a wallet, never more than is left. */
function RefundModal({ supplierId, source, onClose, onDone }: { supplierId: string; source: Source; onClose: () => void; onDone: () => void }) {
  const money = useQuery({ queryKey: ["finance", "financial-accounts"], queryFn: listFinancialAccounts });
  const accounts = (money.data?.financialAccounts ?? []).filter((x) => x.isActive && ["CASH", "BANK", "MOBILE_WALLET"].includes(x.kind));
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState(String(source.left));
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `rf-${Date.now()}`));
  const value = Number(amount);
  const valid = Boolean(to) && value > 0 && value <= source.left;
  const save = useMutation({
    mutationFn: () => purchasingApi.refundFromSupplier({ supplierId, toFinancialAccountId: to, amount: value, movementDate: date || undefined, reference: reference.trim() || null, ...(source.kind === "payment" ? { paymentMovementId: source.id } : { creditNoteId: source.id }) }, key),
    onSuccess: (r) => { toast.success(r.refund.status === "POSTED" ? `${formatPrice(value)} refund recorded` : "Refund recorded — awaiting approval"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The refund couldn't be recorded")),
  });
  return (
    <Modal open onClose={onClose} title="Refund received from the supplier" description={`From ${source.kind === "payment" ? "the advance" : "the credit note"} ${source.label} — ${formatPrice(source.left)} left.`} widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="confirm-refund">Record refund</Button></>}>
      <div className="space-y-3">
        <Field htmlFor="rf-amount" label="Amount" required error={value > source.left ? `At most ${formatPrice(source.left)}` : undefined}><Input id="rf-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field htmlFor="rf-to" label="Received into" required>
          <Select id="rf-to" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose…</option>
            {accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <Field htmlFor="rf-date" label="Date" hint="Defaults to today"><Input id="rf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="rf-ref" label="Reference"><Input id="rf-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></Field>
      </div>
    </Modal>
  );
}

function AllocateModal({ account, source, onClose, onDone }: { account: SupplierAccount; source: Source; onClose: () => void; onDone: () => void }) {
  const bills = account.openBills.filter((b) => b.allocatable > 0);
  const [billId, setBillId] = useState(bills[0]?.id ?? "");
  const bill = bills.find((b) => b.id === billId);
  const max = Math.min(source.left, bill?.allocatable ?? 0);
  const [amount, setAmount] = useState(String(max));
  const value = Number(amount);
  const valid = Boolean(bill) && value > 0 && Math.round(value * 100) <= Math.round(max * 100);
  const save = useMutation({
    mutationFn: () => purchasingApi.allocateToBill({ invoiceId: billId, amount: value, ...(source.kind === "payment" ? { paymentMovementId: source.id } : { creditNoteId: source.id }) }),
    onSuccess: () => { toast.success(`${formatPrice(value)} set against ${bill!.number}`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "That couldn't be allocated")),
  });
  return (
    <Modal open onClose={onClose} title="Set against a bill" description={`${source.kind === "payment" ? "Advance" : "Credit note"} · ${source.label} — ${formatPrice(source.left)} left`} widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>Allocate</Button></>}>
      <div className="space-y-4">
        <Field htmlFor="alloc-bill" label="Bill">
          <Select id="alloc-bill" value={billId} onChange={(e) => { setBillId(e.target.value); const b = bills.find((x) => x.id === e.target.value); setAmount(String(Math.min(source.left, b?.allocatable ?? 0))); }}>
            {bills.map((b) => <option key={b.id} value={b.id}>{b.number} · {b.supplierRef} · {formatPrice(b.allocatable)} open</option>)}
          </Select>
        </Field>
        <Field htmlFor="alloc-amount" label="Amount" error={amount && !valid ? `Between 0 and ${formatPrice(max)}` : undefined}><Input id="alloc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <Card className="p-4">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd className={tone === "warning" ? "text-lg font-semibold tabular-nums text-warning-700" : "text-lg font-semibold tabular-nums text-ink-900"}>{value}</dd>
    </Card>
  );
}
