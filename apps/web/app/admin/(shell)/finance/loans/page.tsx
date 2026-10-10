"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { Loan, LoanRepaymentType } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";

const STATUS: Record<Loan["status"], { variant: "success" | "warning" | "neutral"; label: string }> = {
  ACTIVE: { variant: "success", label: "active" }, AWAITING_APPROVAL: { variant: "warning", label: "awaiting approval" }, REPAID: { variant: "neutral", label: "repaid" }, CANCELLED: { variant: "neutral", label: "cancelled" },
};
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`);

function usePayingAccounts() {
  const money = useQuery({ queryKey: ["finance", "financial-accounts"], queryFn: financeApi.listFinancialAccounts });
  return (money.data?.financialAccounts ?? []).filter((a) => a.isActive && ["CASH", "BANK", "MOBILE_WALLET"].includes(a.kind));
}

/** Loans (docs/FINANCE_LOANS.md): money borrowed, the interest it accrues each month, repayments (interest first, then
 * principal) and the planned instalments. What is owed always comes from the books. */
export default function LoansPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const q = useQuery({ queryKey: financeApi.loanKeys.all(), queryFn: financeApi.listLoans, enabled: allowed });
  const [drawing, setDrawing] = useState(false);
  const [repaying, setRepaying] = useState<Loan | null>(null);
  const [planFor, setPlanFor] = useState<Loan | null>(null);
  const [reversing, setReversing] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finance"] });
  const accrue = useMutation({
    mutationFn: (periodKey: string) => financeApi.runLoanAccrual(periodKey),
    onSuccess: (r) => { refresh(); toast.success(`Interest for ${r.run.periodKey}: ${formatPrice(r.run.total)}`); },
    onError: (err) => toast.error(getErrorMessage(err, "Interest couldn't be accrued")),
  });
  const reverse = useMutation({
    mutationFn: (reason: string) => financeApi.reverseLoanAccrual(reason),
    onSuccess: (r) => { refresh(); setReversing(false); toast.success(`Interest for ${r.periodKey} reversed`); },
    onError: (err) => toast.error(getErrorMessage(err, "The accrual couldn't be reversed")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Landmark} title="Loans aren't available to your role" />
      </div>
    );
  }
  const d = q.data;
  const latest = d?.runs.find((r) => r.status === "POSTED");
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Loans"
        description="Money borrowed: what is still owed, the interest it costs each month and the repayments made."
        action={can("finance.transact") && <Button size="sm" onClick={() => setDrawing(true)} data-testid="new-loan"><Plus className="h-4 w-4" /> Record a loan</Button>}
      />
      {q.isLoading && <Skeleton className="h-48 w-full" />}
      {q.isError && <Alert variant="danger" title="Loans couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>}
      {d && (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Stat label="Principal owed" value={formatPrice(d.totals.outstanding)} hint={`${d.totals.active} active loan${d.totals.active === 1 ? "" : "s"}`} />
            <Stat label="Interest accrued, unpaid" value={formatPrice(d.totals.interestDue)} />
            <Stat label="Interest booked through" value={latest ? latest.periodKey : "—"} hint={d.nextAccrual ? `${d.nextAccrual} is ready` : "Up to date"} />
          </dl>
          {(d.nextAccrual || latest) && (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-ink-600">Interest accrues monthly on each day&apos;s balance (actual/365) and is booked as a cost before it is paid.</p>
              <div className="flex flex-wrap gap-2">
                {latest && can("finance.reverse") && <Button size="sm" variant="ghost" onClick={() => setReversing(true)}>Reverse {latest.periodKey}</Button>}
                {d.nextAccrual && can("finance.post") && <Button size="sm" loading={accrue.isPending} onClick={() => accrue.mutate(d.nextAccrual!)} data-testid="run-accrual">Accrue {d.nextAccrual}</Button>}
              </div>
            </Card>
          )}
          {d.loans.length ? (
            <div className="space-y-3">
              {d.loans.map((l) => (
                <Card key={l.id} className="space-y-3 p-4" data-testid="loan-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900"><span className="font-mono text-xs text-ink-500">{l.number}</span> {l.lender}</p>
                      <p className="text-xs text-ink-500">{formatPrice(l.principal)} at {l.annualRatePct}% over {l.termMonths} months · {l.repaymentType === "ANNUITY" ? "equal instalments" : "equal principal"} · into {l.financialAccount.name} on {l.drawdownDate}</p>
                    </div>
                    <Badge variant={STATUS[l.status].variant}>{STATUS[l.status].label}</Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <Mini label="Principal owed" value={formatPrice(l.outstanding)} />
                    <Mini label="Interest due" value={formatPrice(l.interestDue)} />
                    <Mini label="Repaid" value={formatPrice(l.principalRepaid)} hint={`+ ${formatPrice(l.interestPaid)} interest`} />
                    <Mini label="Next instalment" value={l.nextInstalment ? formatPrice(l.nextInstalment.payment) : "—"} hint={l.nextInstalment?.dueDate} />
                  </dl>
                  {l.overdue.instalments > 0 && (
                    <p className="text-sm text-danger-700" data-testid="loan-overdue">
                      {formatPrice(l.overdue.amount)} overdue against the plan — {l.overdue.instalments} instalment{l.overdue.instalments === 1 ? "" : "s"} since {l.overdue.since}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {l.status === "ACTIVE" && can("finance.transact") && <Button size="sm" onClick={() => setRepaying(l)} data-testid="repay-loan">Record repayment</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setPlanFor(l)}>Planned schedule</Button>
                  </div>
                  {l.repayments.length > 0 && (
                    <ul className="space-y-1 border-t border-line pt-2 text-sm">
                      {l.repayments.map((r) => (
                        <li key={r.id} className="flex flex-wrap justify-between gap-2">
                          <span className="tabular-nums text-ink-700">{r.paymentDate}{r.reference ? ` · ${r.reference}` : ""}</span>
                          <span className={r.status === "POSTED" ? "tabular-nums text-ink-900" : "tabular-nums text-ink-500 line-through"}>{formatPrice(r.interestPart + r.principalPart)} <span className="text-xs text-ink-500">({formatPrice(r.interestPart)} interest)</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState icon={Landmark} title="No loans" description="Record money borrowed from a bank or another lender when it arrives." />
          )}
        </>
      )}
      {drawing && <LoanModal onClose={() => setDrawing(false)} onDone={() => { setDrawing(false); refresh(); }} />}
      {repaying && <RepayModal loan={repaying} onClose={() => setRepaying(null)} onDone={() => { setRepaying(null); refresh(); }} />}
      {planFor && <PlanModal loan={planFor} onClose={() => setPlanFor(null)} />}
      {reversing && latest && <ReasonModal title={`Reverse interest for ${latest.periodKey}`} hint="Its journal is reversed; the month can then be accrued again." loading={reverse.isPending} onClose={() => setReversing(false)} onConfirm={(reason) => reverse.mutate(reason)} />}
    </div>
  );
}

function LoanModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const paying = usePayingAccounts();
  const [lender, setLender] = useState("");
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [term, setTerm] = useState("12");
  const [type, setType] = useState<LoanRepaymentType>("ANNUITY");
  const [drawn, setDrawn] = useState(() => new Date().toISOString().slice(0, 10));
  const [firstDue, setFirstDue] = useState("");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [key] = useState(newKey);
  const valid = lender.trim().length >= 2 && Number(principal) > 0 && Number(rate) >= 0 && rate !== "" && Number(term) >= 1 && Boolean(accountId) && Boolean(firstDue) && firstDue > drawn;
  const save = useMutation({
    mutationFn: () => financeApi.drawLoan({ lender: lender.trim(), principal: Number(principal), annualRatePct: Number(rate), termMonths: Number(term), repaymentType: type, drawdownDate: drawn, firstDueDate: firstDue, financialAccountId: accountId, reference: reference.trim() || null }, key),
    onSuccess: (r) => { toast.success(`${r.loan.number} recorded`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The loan couldn't be recorded")),
  });
  return (
    <Modal open onClose={onClose} title="Record a loan" description="The money arrives in the account you choose; the loan is owed from that day." widthClassName="max-w-lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="confirm-loan">Record</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="ln-lender" label="Lender" required className="sm:col-span-2"><Input id="ln-lender" value={lender} onChange={(e) => setLender(e.target.value)} maxLength={160} /></Field>
        <Field htmlFor="ln-amt" label="Amount borrowed" required><Input id="ln-amt" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} /></Field>
        <Field htmlFor="ln-rate" label="Interest a year (%)" required><Input id="ln-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        <Field htmlFor="ln-term" label="Term (months)" required><Input id="ln-term" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} /></Field>
        <Field htmlFor="ln-type" label="Repayment">
          <Select id="ln-type" value={type} onChange={(e) => setType(e.target.value as LoanRepaymentType)}>
            <option value="ANNUITY">Equal instalments</option>
            <option value="EQUAL_PRINCIPAL">Equal principal</option>
          </Select>
        </Field>
        <Field htmlFor="ln-drawn" label="Received on" required><Input id="ln-drawn" type="date" value={drawn} onChange={(e) => setDrawn(e.target.value)} /></Field>
        <Field htmlFor="ln-first" label="First instalment due" required error={firstDue && firstDue <= drawn ? "After the money arrives" : undefined}><Input id="ln-first" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Field>
        <Field htmlFor="ln-acc" label="Received into" required>
          <Select id="ln-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose…</option>
            {paying.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field htmlFor="ln-ref" label="Loan reference"><Input id="ln-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></Field>
      </div>
    </Modal>
  );
}

function RepayModal({ loan, onClose, onDone }: { loan: Loan; onClose: () => void; onDone: () => void }) {
  const paying = usePayingAccounts();
  const [amount, setAmount] = useState(loan.nextInstalment ? String(loan.nextInstalment.payment) : "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState(loan.financialAccount.id);
  const [reference, setReference] = useState("");
  const [key] = useState(newKey);
  const value = Number(amount);
  const interest = Math.min(value || 0, loan.interestDue);
  const max = Math.round((loan.outstanding + loan.interestDue) * 100) / 100;
  const valid = value > 0 && value <= max && Boolean(accountId);
  const save = useMutation({
    mutationFn: () => financeApi.repayLoan(loan.id, { paymentDate: date, amount: value, fromFinancialAccountId: accountId, reference: reference.trim() || null }, key),
    onSuccess: () => { toast.success("Repayment recorded"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The repayment couldn't be recorded")),
  });
  return (
    <Modal open onClose={onClose} title={`Repay ${loan.number} ${loan.lender}`} description="Accrued interest is paid first, the rest reduces the principal." widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="confirm-repay">Pay {value > 0 ? formatPrice(value) : ""}</Button></>}>
      <div className="space-y-3">
        <Field htmlFor="rp-amt" label="Amount" error={value > max ? `At most ${formatPrice(max)} is owed` : undefined}><Input id="rp-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {value > 0 && value <= max && <p className="text-sm text-ink-700">{formatPrice(interest)} interest · {formatPrice(Math.round((value - interest) * 100) / 100)} principal</p>}
        <Field htmlFor="rp-date" label="Paid on"><Input id="rp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="rp-acc" label="Paid from">
          <Select id="rp-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {paying.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field htmlFor="rp-ref" label="Reference"><Input id="rp-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></Field>
      </div>
    </Modal>
  );
}

function PlanModal({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`${loan.number} planned schedule`} description="The lender's plan for guidance; what is owed comes from the repayments actually made." widthClassName="max-w-2xl" footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      <HScrollShadow>
        <Table>
          <TableHead><tr><TableHeaderCell>#</TableHeaderCell><TableHeaderCell>Due</TableHeaderCell><TableHeaderCell align="right">Payment</TableHeaderCell><TableHeaderCell align="right">Interest</TableHeaderCell><TableHeaderCell align="right">Principal</TableHeaderCell><TableHeaderCell align="right">Left</TableHeaderCell></tr></TableHead>
          <tbody>
            {loan.schedule.map((s) => (
              <TableRow key={s.n}>
                <TableCell className="tabular-nums">{s.n}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{s.dueDate}</TableCell>
                <TableCell align="right" className="tabular-nums">{formatPrice(s.payment)}</TableCell>
                <TableCell align="right" className="tabular-nums">{formatPrice(s.interest)}</TableCell>
                <TableCell align="right" className="tabular-nums">{formatPrice(s.principal)}</TableCell>
                <TableCell align="right" className="tabular-nums">{formatPrice(s.balance)}</TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </HScrollShadow>
    </Modal>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-ink-900">{value}</dd>
      {hint && <dd className="text-xs text-ink-500">{hint}</dd>}
    </Card>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="tabular-nums text-ink-900">{value}</dd>
      {hint && <dd className="text-xs text-ink-500">{hint}</dd>}
    </div>
  );
}
