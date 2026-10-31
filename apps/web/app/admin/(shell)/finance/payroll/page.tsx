"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Plus, Printer, Users, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { useCapabilities } from "@/hooks/use-capability";
import { useCreateParam } from "@/hooks/use-create-param";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { Employee, PayComponent, PayComponentKind, PayRun, Payslip } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";
import { PermissionState } from "@/components/admin/permission-state";

type View = "runs" | "employees" | "components";
const KIND_LABEL: Record<PayComponentKind, string> = { EARNING: "Earning", DEDUCTION: "Deduction", EMPLOYER_CONTRIBUTION: "Employer contribution" };
const KIND_HINT: Record<PayComponentKind, string> = { EARNING: "Paid to the employee", DEDUCTION: "Withheld from pay, owed until paid over", EMPLOYER_CONTRIBUTION: "Your cost on top of pay, owed until paid over" };
const RUN_STATUS: Record<PayRun["status"], { variant: "neutral" | "success" | "warning"; label: string }> = { DRAFT: { variant: "warning", label: "Draft" }, POSTED: { variant: "success", label: "Posted" }, REVERSED: { variant: "neutral", label: "Reversed" } };
const PAY_STATUS: Record<Payslip["payment"]["status"], { variant: "neutral" | "success" | "warning"; label: string }> = { UNPAID: { variant: "neutral", label: "Unpaid" }, AWAITING_APPROVAL: { variant: "warning", label: "Awaiting approval" }, PAID: { variant: "success", label: "Paid" } };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`);
const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function usePayingAccounts() {
  const money = useQuery({ queryKey: ["finance", "financial-accounts"], queryFn: financeApi.listFinancialAccounts });
  return (money.data?.financialAccounts ?? []).filter((a) => a.isActive && ["CASH", "BANK", "MOBILE_WALLET"].includes(a.kind));
}

/** Payroll (docs/FINANCE_PAYROLL.md): the owner's own pay structure — components, employees, monthly pay runs posted as one
 * journal, salaries paid through money accounts and deductions remitted. No statutory rule is built in. */
export default function PayrollPage() {
  const { can, ready } = useCapabilities();
  const params = useSearchParams();
  const [view, setView] = useState<View>("runs");
  if (ready && !can("finance.sensitive")) {
    return (
      <div>
        <ModuleTabs />
        <PermissionState icon={Users} page="Payroll" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Payroll" description="Pay runs for each month, the people paid and the pay components you define." />
      <SegmentedControl aria-label="View" options={[{ value: "runs" as const, label: "Pay runs" }, { value: "employees" as const, label: "Employees" }, { value: "components" as const, label: "Pay components" }]} value={view} onChange={setView} />
      {view === "runs" && <Runs initialRun={params.get("run")} onSetup={setView} />}
      {view === "employees" && <Employees />}
      {view === "components" && <Components />}
    </div>
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

function LoadError({ what, error, retry }: { what: string; error: unknown; retry: () => void }) {
  return <Alert variant="danger" title={`${what} couldn't be loaded`} action={<Button size="sm" variant="outline" onClick={retry}>Retry</Button>}>{getErrorMessage(error, "")}</Alert>;
}

// ── pay runs ────────────────────────────────────────────────────────────────────────────────────────────────────────

function Runs({ initialRun, onSetup }: { initialRun: string | null; onSetup: (v: View) => void }) {
  const { can } = useCapabilities();
  const q = useQuery({ queryKey: financeApi.payrollKeys.overview(), queryFn: financeApi.getPayroll });
  const employees = useQuery({ queryKey: financeApi.payrollKeys.employees(), queryFn: financeApi.listEmployees });
  const [openRun, setOpenRun] = useState<string | null>(initialRun);
  const [starting, setStarting] = useState(false);
  useCreateParam("pay-run", () => setStarting(true));
  const [remitting, setRemitting] = useState<{ id: string; code: string; name: string; owed: number } | null>(null);
  if (q.isLoading || employees.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <LoadError what="Payroll" error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const staff = employees.data?.employees ?? [];
  if (!staff.some((e) => e.payItems.length)) {
    return (
      <EmptyState variant="bordered" icon={Users} title="Set up payroll first" testId="payroll-setup"
        description="Define your pay components (basic salary, allowances, any deductions) and add employees with their pay. Nothing about tax or provident fund is assumed — you decide every component."
        action={<div className="flex flex-wrap justify-center gap-2"><Button size="sm" variant="outline" onClick={() => onSetup("components")}>Pay components</Button><Button size="sm" onClick={() => onSetup("employees")}>Employees</Button></div>} />
    );
  }
  const owed = d.withheld.reduce((s, w) => s + w.owed, 0);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Next month to run" value={d.nextRunMonth ? monthLabel(d.nextRunMonth) : "Up to date"} />
        <Stat label="Salaries posted, unpaid" value={formatPrice(d.unpaidNet)} />
        <Stat label="Deductions withheld, not remitted" value={formatPrice(owed)} />
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink-900">Pay runs</h2>
        <Button size="sm" onClick={() => setStarting(true)} data-testid="new-pay-run"><Plus className="h-4 w-4" /> Start a pay run</Button>
      </div>
      {d.runs.length ? (
        <Card className="overflow-hidden p-0">
          <HScrollShadow>
            <Table>
              <TableHead><tr><TableHeaderCell>Run</TableHeaderCell><TableHeaderCell>Month</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell align="right">Gross</TableHeaderCell><TableHeaderCell align="right">Net pay</TableHeaderCell><TableHeaderCell align="right">Unpaid</TableHeaderCell></tr></TableHead>
              <tbody>
                {d.runs.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenRun(r.id)} data-testid="pay-run-row">
                    <TableCell><button type="button" className="font-mono text-xs text-ink-700 underline-offset-2 hover:underline" onClick={() => setOpenRun(r.id)}>{r.number}</button></TableCell>
                    <TableCell className="whitespace-nowrap">{monthLabel(r.periodKey)}</TableCell>
                    <TableCell><Badge variant={RUN_STATUS[r.status].variant}>{RUN_STATUS[r.status].label}</Badge></TableCell>
                    <TableCell align="right" className="tabular-nums">{formatPrice(r.gross)}</TableCell>
                    <TableCell align="right" className="tabular-nums">{formatPrice(r.net)}</TableCell>
                    <TableCell align="right" className="tabular-nums">{r.status === "POSTED" && r.unpaid.amount ? formatPrice(r.unpaid.amount) : "—"}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </HScrollShadow>
        </Card>
      ) : (
        <EmptyState icon={Wallet} title="No pay runs yet" description="Start the first month's pay run: payslips are drafted from each employee's pay." />
      )}

      {d.withheld.length > 0 && (
        <Card className="space-y-3 p-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Withheld and owed</h2>
            <p className="text-sm text-ink-600">Deductions and employer contributions held until you pay them over.</p>
          </div>
          <ul className="divide-y divide-line text-sm">
            {d.withheld.map((w) => (
              <li key={w.account.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="min-w-0"><span className="font-mono text-xs text-ink-500">{w.account.code}</span> {w.account.name}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums text-ink-900">{formatPrice(w.owed)}</span>
                  {w.owed > 0 && can("finance.transact") && <Button size="sm" variant="outline" onClick={() => setRemitting({ ...w.account, owed: w.owed })} data-testid="remit">Pay over</Button>}
                </span>
              </li>
            ))}
          </ul>
          {d.remittances.length > 0 && (
            <ul className="space-y-1 border-t border-line pt-2 text-sm">
              {d.remittances.slice(0, 8).map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2">
                  <span className="text-ink-700"><span className="tabular-nums">{r.date}</span> · {r.account.name}{r.periodKey ? ` · ${r.periodKey}` : ""}</span>
                  <span className={r.status === "POSTED" ? "tabular-nums text-ink-900" : "tabular-nums text-ink-500"}>{formatPrice(r.amount)}{r.status !== "POSTED" && ` (${r.status.toLowerCase().replace("_", " ")})`}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {starting && <NewRunModal suggested={d.nextRunMonth ?? d.asOf.slice(0, 7)} onClose={() => setStarting(false)} onDone={(id) => { setStarting(false); setOpenRun(id); }} />}
      {openRun && <RunDrawer id={openRun} employees={staff} onClose={() => setOpenRun(null)} />}
      {remitting && <RemitModal account={remitting} onClose={() => setRemitting(null)} />}
    </div>
  );
}

function NewRunModal({ suggested, onClose, onDone }: { suggested: string; onClose: () => void; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(suggested);
  const [payDate, setPayDate] = useState("");
  const save = useMutation({
    mutationFn: () => financeApi.createPayRun({ periodKey: month, payDate: payDate || null }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(`${r.number} drafted — ${r.payslips.length} payslip${r.payslips.length === 1 ? "" : "s"}`); onDone(r.id); },
    onError: (err) => toast.error(getErrorMessage(err, "The pay run couldn't be started")),
  });
  return (
    <Modal open onClose={onClose} title="Start a pay run" description="Payslips are drafted from each employee's pay; joiners and leavers are prorated by days. You can edit them before posting." widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!/^\d{4}-\d{2}$/.test(month)} onClick={() => save.mutate()} data-testid="confirm-pay-run">Draft payslips</Button></>}>
      <div className="space-y-3">
        <Field htmlFor="pr-month" label="Month" required><Input id="pr-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field htmlFor="pr-date" label="Pay date" hint="Defaults to the last day of the month"><Input id="pr-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function RunDrawer({ id, employees, onClose }: { id: string; employees: Employee[]; onClose: () => void }) {
  const { can } = useCapabilities();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: financeApi.payrollKeys.run(id), queryFn: () => financeApi.getPayRun(id) });
  const [editing, setEditing] = useState<Payslip | null>(null);
  const [paying, setPaying] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [adding, setAdding] = useState("");
  const refresh = (r?: PayRun) => {
    if (r) qc.setQueryData(financeApi.payrollKeys.run(id), r);
    void qc.invalidateQueries({ queryKey: ["finance"] });
  };
  const act = useMutation({
    mutationFn: async (a: { kind: "post" } | { kind: "delete" } | { kind: "presence"; employeeId: string; present: boolean } | { kind: "reverse"; reason: string }) => {
      if (a.kind === "post") return financeApi.postPayRun(id);
      if (a.kind === "reverse") return financeApi.reversePayRun(id, a.reason);
      if (a.kind === "presence") return financeApi.setPayslipPresence(id, a.employeeId, a.present);
      await financeApi.deletePayRun(id);
      return null;
    },
    onSuccess: (r, a) => {
      if (a.kind === "delete") { toast.success("Draft pay run deleted"); refresh(); onClose(); return; }
      refresh(r ?? undefined);
      setAdding("");
      if (a.kind === "post") toast.success(`${r?.number} posted`);
      if (a.kind === "reverse") { setReversing(false); toast.success(`${r?.number} reversed`); }
    },
    onError: (err) => toast.error(getErrorMessage(err, "That didn't work")),
  });
  const r = q.data;
  // employed in the run's month (ISO dates compare as strings) and not on it yet
  const employedIn = (e: Employee, key: string) => e.joinDate.slice(0, 7) <= key && (!e.leaveDate || e.leaveDate.slice(0, 7) >= key);
  const missing = r ? employees.filter((e) => e.payItems.length && employedIn(e, r.periodKey) && !r.payslips.some((p) => p.employee.id === e.id)) : [];
  const anyPaid = r?.payslips.some((p) => p.payment.status !== "UNPAID") ?? false;
  return (
    <Drawer open onClose={onClose} title={r ? `${r.number} · ${monthLabel(r.periodKey)}` : "Pay run"} widthClassName="max-w-2xl">
      <div className="space-y-4 p-4 sm:p-6">
        {q.isLoading && <Skeleton className="h-64 w-full" />}
        {q.isError && <LoadError what="The pay run" error={q.error} retry={() => q.refetch()} />}
        {r && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
              <Badge variant={RUN_STATUS[r.status].variant}>{RUN_STATUS[r.status].label}</Badge>
              <span>Pay date {r.payDate}</span>
              {r.reversalReason && <span>· reversed: {r.reversalReason}</span>}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {([["Gross", r.gross], ["Deductions", r.deductions], ["Net pay", r.net], ["Employer cost", r.employerCost]] as const).map(([label, v]) => (
                <div key={label}><dt className="text-xs text-ink-500">{label}</dt><dd className="font-medium tabular-nums text-ink-900">{formatPrice(v)}</dd></div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2">
              {r.status === "DRAFT" && can("finance.post") && <Button size="sm" loading={act.isPending && act.variables?.kind === "post"} disabled={!r.payslips.length} onClick={() => act.mutate({ kind: "post" })} data-testid="post-pay-run">Post pay run</Button>}
              {r.status === "DRAFT" && <Button size="sm" variant="ghost" loading={act.isPending && act.variables?.kind === "delete"} onClick={() => act.mutate({ kind: "delete" })}>Delete draft</Button>}
              {r.status === "POSTED" && r.unpaid.count > 0 && can("finance.transact") && <Button size="sm" onClick={() => setPaying(true)} data-testid="pay-salaries">Pay {formatPrice(r.unpaid.amount)}</Button>}
              {r.status === "POSTED" && !anyPaid && can("finance.reverse") && <Button size="sm" variant="ghost" onClick={() => setReversing(true)}>Reverse</Button>}
              {r.payslips.length > 0 && <Link href={`/admin/finance/payroll/runs/${r.id}/payslips`} className={buttonVariants({ variant: "ghost", size: "sm" })} data-testid="print-run"><Printer className="h-4 w-4" /> Payslips</Link>}
            </div>
            {r.status === "DRAFT" && <p className="text-sm text-ink-600">Posting books the month&apos;s salary cost and what is owed in one journal dated the last day of {monthLabel(r.periodKey)}. Payslips can&apos;t change after that — reverse the run instead.</p>}

            <ul className="space-y-2">
              {r.payslips.map((p) => (
                <li key={p.id} className="rounded-xl border border-line p-3" data-testid="payslip">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900"><span className="font-mono text-xs text-ink-500">{p.employee.number}</span> {p.employee.name}</p>
                      <p className="text-xs text-ink-500">{p.employee.designation ?? "—"} · {p.daysPayable === p.daysInPeriod ? "full month" : `${p.daysPayable} of ${p.daysInPeriod} days`}{p.employee.payoutDetails ? ` · ${p.employee.payoutDetails}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.status === "POSTED" ? <Badge variant={PAY_STATUS[p.payment.status].variant}>{PAY_STATUS[p.payment.status].label}</Badge> : null}
                      <Link href={`/admin/finance/payroll/runs/${r.id}/payslips?slip=${p.id}`} className="text-ink-500 hover:text-ink-900" aria-label={`Print ${p.employee.name}'s payslip`}><Printer className="h-4 w-4" /></Link>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-sm">
                    {p.lines.filter((l) => l.kind !== "EMPLOYER_CONTRIBUTION").map((l) => (
                      <li key={l.componentId} className="flex justify-between gap-2">
                        <span className="text-ink-600">{l.name}</span>
                        <span className="tabular-nums text-ink-800">{l.kind === "DEDUCTION" ? "−" : ""}{formatPrice(l.amount)}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-2 border-t border-line pt-1 font-medium"><span>Net pay</span><span className="tabular-nums">{formatPrice(p.net)}</span></li>
                    {p.lines.filter((l) => l.kind === "EMPLOYER_CONTRIBUTION").map((l) => (
                      <li key={l.componentId} className="flex justify-between gap-2 text-xs text-ink-500">
                        <span>{l.name} — your cost on top</span>
                        <span className="tabular-nums">{formatPrice(l.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  {r.status === "DRAFT" && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(p)} data-testid="edit-payslip">Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ kind: "presence", employeeId: p.employee.id, present: false })}>Remove</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {!r.payslips.length && <EmptyState icon={Users} title="No payslips" description="Nobody with a pay structure was employed this month." />}
            {r.status === "DRAFT" && missing.length > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Field htmlFor="add-emp" label="Add an employee" className="flex-1">
                  <Select id="add-emp" value={adding} onChange={(e) => setAdding(e.target.value)}>
                    <option value="">Choose…</option>
                    {missing.map((e) => <option key={e.id} value={e.id}>{e.number} {e.name}</option>)}
                  </Select>
                </Field>
                <Button size="sm" variant="outline" disabled={!adding} onClick={() => act.mutate({ kind: "presence", employeeId: adding, present: true })}>Add payslip</Button>
              </div>
            )}
          </>
        )}
      </div>
      {editing && r && <PayslipModal run={r} slip={editing} onClose={() => setEditing(null)} onDone={(next) => { setEditing(null); refresh(next); }} />}
      {paying && r && <PayModal run={r} onClose={() => setPaying(false)} onDone={(next) => { setPaying(false); refresh(next); }} />}
      {reversing && r && <ReasonModal title={`Reverse ${r.number}`} hint="Its journal is reversed; the month can then be run again." loading={act.isPending} onClose={() => setReversing(false)} onConfirm={(reason) => act.mutate({ kind: "reverse", reason })} />}
    </Drawer>
  );
}

function PayslipModal({ run, slip, onClose, onDone }: { run: PayRun; slip: Payslip; onClose: () => void; onDone: (r: PayRun) => void }) {
  const components = useQuery({ queryKey: financeApi.payrollKeys.components(), queryFn: financeApi.listPayComponents });
  const [days, setDays] = useState(String(slip.daysPayable));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(slip.lines.map((l) => [l.componentId, String(l.amount)])));
  const [dirty, setDirty] = useState(false);
  const [extra, setExtra] = useState("");
  const all = components.data?.components ?? [];
  const shown = all.filter((c) => c.id in values);
  const addable = all.filter((c) => c.isActive && !(c.id in values));
  const daysNum = Number(days);
  const validDays = Number.isInteger(daysNum) && daysNum >= 0 && daysNum <= slip.daysInPeriod;
  const save = useMutation({
    mutationFn: () => financeApi.updatePayslip(run.id, slip.id, dirty
      ? { daysPayable: daysNum, lines: Object.entries(values).map(([componentId, v]) => ({ componentId, amount: Number(v) || 0 })) }
      : { daysPayable: daysNum }),
    onSuccess: (r) => { toast.success(`${slip.employee.name}'s payslip updated`); onDone(r); },
    onError: (err) => toast.error(getErrorMessage(err, "The payslip couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={`${slip.employee.name} — ${monthLabel(run.periodKey)}`} widthClassName="max-w-lg"
      description={dirty ? "Saving keeps these amounts as entered." : "Changing only the days recalculates the payslip from the employee's pay."}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!validDays} onClick={() => save.mutate()} data-testid="save-payslip">Save</Button></>}>
      <div className="space-y-4">
        <Field htmlFor="ps-days" label={`Days paid (of ${slip.daysInPeriod})`} error={validDays ? undefined : `0–${slip.daysInPeriod}`}><Input id="ps-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        {components.isLoading ? <Skeleton className="h-32 w-full" /> : (
          <div className="space-y-2">
            {shown.map((c) => (
              <Field key={c.id} htmlFor={`ps-${c.id}`} label={`${c.name} · ${KIND_LABEL[c.kind].toLowerCase()}`}>
                <Input id={`ps-${c.id}`} inputMode="decimal" value={values[c.id]} onChange={(e) => { setDirty(true); setValues({ ...values, [c.id]: e.target.value }); }} />
              </Field>
            ))}
            {addable.length > 0 && (
              <div className="flex items-end gap-2">
                <Field htmlFor="ps-extra" label="Add a line (bonus, overtime, recovery)" className="flex-1">
                  <Select id="ps-extra" value={extra} onChange={(e) => setExtra(e.target.value)}>
                    <option value="">Choose…</option>
                    {addable.map((c) => <option key={c.id} value={c.id}>{c.name} ({KIND_LABEL[c.kind].toLowerCase()})</option>)}
                  </Select>
                </Field>
                <Button size="sm" variant="outline" disabled={!extra} onClick={() => { setDirty(true); setValues({ ...values, [extra]: "0" }); setExtra(""); }}>Add</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PayModal({ run, onClose, onDone }: { run: PayRun; onClose: () => void; onDone: (r: PayRun) => void }) {
  const accounts = usePayingAccounts();
  const [from, setFrom] = useState("");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [key] = useState(newKey);
  const save = useMutation({
    mutationFn: () => financeApi.payPayslips(run.id, { fromFinancialAccountId: from, paymentDate: date || undefined, reference: reference || null }, key),
    onSuccess: (r) => { toast.success(`Salaries for ${monthLabel(run.periodKey)} paid`); onDone(r.run); },
    onError: (err) => toast.error(getErrorMessage(err, "The salaries couldn't be paid")),
  });
  return (
    <Modal open onClose={onClose} title={`Pay ${formatPrice(run.unpaid.amount)}`} description={`The net pay of ${run.unpaid.count} unpaid payslip${run.unpaid.count === 1 ? "" : "s"}, in one money movement. Large payments may wait for approval.`} widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!from} onClick={() => save.mutate()} data-testid="confirm-pay">Pay salaries</Button></>}>
      <div className="space-y-3">
        <Field htmlFor="pay-from" label="Pay from" required>
          <Select id="pay-from" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field htmlFor="pay-date" label="Payment date" hint="Defaults to today"><Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="pay-ref" label="Reference"><Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></Field>
      </div>
    </Modal>
  );
}

function RemitModal({ account, onClose }: { account: { id: string; code: string; name: string; owed: number }; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = usePayingAccounts();
  const [amount, setAmount] = useState(String(account.owed));
  const [from, setFrom] = useState("");
  const [month, setMonth] = useState("");
  const [reference, setReference] = useState("");
  const [key] = useState(newKey);
  const value = Number(amount);
  const valid = Boolean(from) && value > 0 && value <= account.owed;
  const save = useMutation({
    mutationFn: () => financeApi.remitPayroll({ liabilityAccountId: account.id, amount: value, fromFinancialAccountId: from, periodKey: month || null, reference: reference || null }, key),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(`${formatPrice(value)} paid over`); onClose(); },
    onError: (err) => toast.error(getErrorMessage(err, "The remittance couldn't be recorded")),
  });
  return (
    <Modal open onClose={onClose} title={`Pay over ${account.name}`} description={`${formatPrice(account.owed)} is owed (${account.code}).`} widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="confirm-remit">Pay over</Button></>}>
      <div className="space-y-3">
        <Field htmlFor="rm-amount" label="Amount" required error={value > account.owed ? `At most ${formatPrice(account.owed)}` : undefined}><Input id="rm-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field htmlFor="rm-from" label="Pay from" required>
          <Select id="rm-from" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field htmlFor="rm-month" label="For the month"><Input id="rm-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field htmlFor="rm-ref" label="Reference" hint="Challan or receipt number"><Input id="rm-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></Field>
      </div>
    </Modal>
  );
}

// ── employees ───────────────────────────────────────────────────────────────────────────────────────────────────────

function Employees() {
  const q = useQuery({ queryKey: financeApi.payrollKeys.employees(), queryFn: financeApi.listEmployees });
  const components = useQuery({ queryKey: financeApi.payrollKeys.components(), queryFn: financeApi.listPayComponents });
  const [editing, setEditing] = useState<Employee | "new" | null>(null);
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <LoadError what="Employees" error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const noComponents = !components.isLoading && !(components.data?.components.length);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="On the payroll" value={String(d.totals.active)} />
        <Stat label="Monthly gross" value={formatPrice(d.totals.monthlyGross)} hint={`${formatPrice(d.totals.monthlyNet)} net`} />
        <Stat label="Employer cost on top" value={formatPrice(d.totals.monthlyEmployerCost)} />
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink-900">Employees</h2>
        <Button size="sm" onClick={() => setEditing("new")} disabled={noComponents} data-testid="new-employee"><Plus className="h-4 w-4" /> Add employee</Button>
      </div>
      {noComponents && <Alert variant="info" title="Define pay components first">An employee&apos;s pay is made of your components (basic salary, allowances, deductions).</Alert>}
      {d.employees.length ? (
        <Card className="overflow-hidden p-0">
          <HScrollShadow>
            <Table>
              <TableHead><tr><TableHeaderCell>Employee</TableHeaderCell><TableHeaderCell>Joined</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell align="right">Monthly gross</TableHeaderCell><TableHeaderCell align="right">Net</TableHeaderCell><TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell></tr></TableHead>
              <tbody>
                {d.employees.map((e) => (
                  <TableRow key={e.id} data-testid="employee-row">
                    <TableCell><p className="font-medium text-ink-900"><span className="font-mono text-xs text-ink-500">{e.number}</span> {e.name}</p><p className="text-xs text-ink-500">{[e.designation, e.department].filter(Boolean).join(" · ") || "—"}</p></TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{e.joinDate}</TableCell>
                    <TableCell><Badge variant={e.status === "ACTIVE" ? "success" : "neutral"}>{e.status === "ACTIVE" ? "Active" : `Left ${e.leaveDate}`}</Badge></TableCell>
                    <TableCell align="right" className="tabular-nums">{formatPrice(e.standard.gross)}</TableCell>
                    <TableCell align="right" className="tabular-nums">{formatPrice(e.standard.net)}</TableCell>
                    <TableCell align="right"><Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Edit</Button></TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </HScrollShadow>
        </Card>
      ) : (
        <EmptyState icon={Users} title="No employees" description="Add the people you pay a salary to, with their pay." />
      )}
      {editing && <EmployeeModal employee={editing === "new" ? null : editing} components={components.data?.components ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EmployeeModal({ employee, components, onClose }: { employee: Employee | null; components: PayComponent[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: employee?.name ?? "", designation: employee?.designation ?? "", department: employee?.department ?? "", phone: employee?.phone ?? "",
    payoutDetails: employee?.payoutDetails ?? "", joinDate: employee?.joinDate ?? "", leaveDate: employee?.leaveDate ?? "",
  });
  const usable = components.filter((c) => c.isActive || employee?.payItems.some((i) => i.componentId === c.id));
  const [items, setItems] = useState<Record<string, { on: boolean; value: string }>>(() =>
    Object.fromEntries(usable.map((c) => {
      const item = employee?.payItems.find((i) => i.componentId === c.id);
      return [c.id, { on: Boolean(item), value: item ? String(c.calculation === "FIXED" ? item.amount ?? "" : item.ratePct ?? "") : "" }];
    })));
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const fixedMissing = usable.some((c) => items[c.id]?.on && c.calculation === "FIXED" && !(Number(items[c.id]!.value) >= 0 && items[c.id]!.value !== ""));
  const valid = form.name.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(form.joinDate) && (!form.leaveDate || form.leaveDate >= form.joinDate) && !fixedMissing;
  const save = useMutation({
    mutationFn: () => financeApi.saveEmployee(employee?.id ?? null, {
      ...form, name: form.name.trim(), leaveDate: form.leaveDate || null,
      payItems: usable.filter((c) => items[c.id]?.on).map((c) => (c.calculation === "FIXED" ? { componentId: c.id, amount: Number(items[c.id]!.value) } : { componentId: c.id, ratePct: items[c.id]!.value === "" ? null : Number(items[c.id]!.value) })),
    }),
    onSuccess: (e) => { void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(`${e.name} saved`); onClose(); },
    onError: (err) => toast.error(getErrorMessage(err, "The employee couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={employee ? `Edit ${employee.name}` : "Add employee"} description="A payslip already drafted keeps its figures; the next pay run uses this pay." widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="save-employee">Save</Button></>}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="em-name" label="Name" required><Input id="em-name" value={form.name} onChange={set("name")} maxLength={120} /></Field>
          <Field htmlFor="em-des" label="Designation"><Input id="em-des" value={form.designation} onChange={set("designation")} maxLength={80} /></Field>
          <Field htmlFor="em-dep" label="Department"><Input id="em-dep" value={form.department} onChange={set("department")} maxLength={80} /></Field>
          <Field htmlFor="em-phone" label="Phone"><Input id="em-phone" value={form.phone} onChange={set("phone")} maxLength={30} /></Field>
          <Field htmlFor="em-join" label="Joined" required><Input id="em-join" type="date" value={form.joinDate} onChange={set("joinDate")} /></Field>
          <Field htmlFor="em-leave" label="Left" hint="Leave empty while employed"><Input id="em-leave" type="date" value={form.leaveDate} onChange={set("leaveDate")} /></Field>
          <Field htmlFor="em-payout" label="Paid to" hint="Bank account or bKash number" className="sm:col-span-2"><Input id="em-payout" value={form.payoutDetails} onChange={set("payoutDetails")} maxLength={200} /></Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-900">Pay each month</legend>
          {usable.map((c) => {
            const it = items[c.id] ?? { on: false, value: "" };
            return (
              <div key={c.id} className="flex flex-col gap-2 rounded-xl border border-line p-3 sm:flex-row sm:items-center">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <Checkbox checked={it.on} onChange={(e) => setItems({ ...items, [c.id]: { ...it, on: e.target.checked } })} />
                  <span className="min-w-0"><span className="font-medium text-ink-900">{c.name}</span> <span className="text-ink-500">· {KIND_LABEL[c.kind].toLowerCase()}{c.calculation === "PERCENT_OF_BASIC" ? ` · ${c.ratePct}% of basic` : ""}</span></span>
                </label>
                {it.on && (
                  <Input aria-label={c.calculation === "FIXED" ? `${c.name} amount` : `${c.name} rate (%)`} className="sm:w-40" inputMode="decimal"
                    placeholder={c.calculation === "FIXED" ? "Amount" : `${c.ratePct}% (default)`} value={it.value} onChange={(e) => setItems({ ...items, [c.id]: { ...it, value: e.target.value } })} />
                )}
              </div>
            );
          })}
          {!usable.length && <p className="text-sm text-ink-600">No pay components yet.</p>}
        </fieldset>
      </div>
    </Modal>
  );
}

// ── components ──────────────────────────────────────────────────────────────────────────────────────────────────────

function Components() {
  const q = useQuery({ queryKey: financeApi.payrollKeys.components(), queryFn: financeApi.listPayComponents });
  const [editing, setEditing] = useState<PayComponent | "new" | null>(null);
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <LoadError what="Pay components" error={q.error} retry={() => q.refetch()} />;
  const list = q.data.components;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-600">Your pay is made of these. Tax, provident fund and bonus rules aren&apos;t assumed — add each as a component with the amount or percentage you decide.</p>
        <Button size="sm" onClick={() => setEditing("new")} data-testid="new-component"><Plus className="h-4 w-4" /> Add component</Button>
      </div>
      {list.length ? (
        <Card className="divide-y divide-line p-0">
          {list.map((c) => (
            <div key={c.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="component-row">
              <div className="min-w-0">
                <p className="font-medium text-ink-900">{c.name} {c.isBasic && <Badge variant="info">Basic</Badge>} {!c.isActive && <Badge variant="neutral">Inactive</Badge>}</p>
                <p className="text-sm text-ink-600">
                  {KIND_LABEL[c.kind]} · {c.calculation === "FIXED" ? "fixed amount" : `${c.ratePct}% of basic`}
                  {c.expenseAccount && ` · cost ${c.expenseAccount.code}`}{c.liabilityAccount && (c.liabilityAccount.type === "ASSET" ? ` · recovers ${c.liabilityAccount.code}` : ` · owed on ${c.liabilityAccount.code}`)}
                </p>
              </div>
              <Button size="sm" variant="ghost" className="self-start sm:self-auto" onClick={() => setEditing(c)}>Edit</Button>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState icon={Wallet} title="No pay components" description="Start with the basic salary, then any allowances, deductions or employer contributions you pay." />
      )}
      {editing && <ComponentModal component={editing === "new" ? null : editing} hasBasic={list.some((c) => c.isBasic && c.id !== (editing === "new" ? "" : editing.id))} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ComponentModal({ component, hasBasic, onClose }: { component: PayComponent | null; hasBasic: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart });
  const [form, setForm] = useState({
    name: component?.name ?? "", kind: component?.kind ?? ("EARNING" as PayComponentKind), calculation: component?.calculation ?? "FIXED",
    isBasic: component?.isBasic ?? !hasBasic, ratePct: component?.ratePct === null || component?.ratePct === undefined ? "" : String(component.ratePct),
    expenseAccountId: component?.expenseAccount?.id ?? "", liabilityAccountId: component?.liabilityAccount?.id ?? "", isActive: component?.isActive ?? true,
  });
  const accounts = useMemo(() => (chart.data?.accounts ?? []).filter((a) => a.isPostable && a.isActive), [chart.data]);
  const expenseOptions = accounts.filter((a) => ["EXPENSE", "COGS", "OTHER_EXPENSE"].includes(a.type));
  const money = useQuery({ queryKey: ["finance", "financial-accounts"], queryFn: financeApi.listFinancialAccounts });
  const moneyLedgers = new Set((money.data?.financialAccounts ?? []).map((f) => f.ledgerAccount.id));
  // a deduction may also recover a receivable (1520 Employee advances); money accounts never — they move through Treasury
  const receivablesGroup = (chart.data?.accounts ?? []).find((a) => a.code === "1500")?.id;
  const liabilityOptions = accounts.filter((a) => (a.type === "LIABILITY" || (form.kind === "DEDUCTION" && a.type === "ASSET" && a.parentId === receivablesGroup)) && !moneyLedgers.has(a.id));
  const percent = form.calculation === "PERCENT_OF_BASIC";
  const basicAllowed = form.kind === "EARNING" && !percent && !hasBasic;
  const valid = form.name.trim().length >= 2 && (!percent || (form.ratePct !== "" && Number(form.ratePct) >= 0 && Number(form.ratePct) <= 100));
  const save = useMutation({
    mutationFn: () => financeApi.savePayComponent(component?.id ?? null, {
      name: form.name.trim(), kind: form.kind, calculation: form.calculation, isBasic: basicAllowed ? form.isBasic : false, ratePct: percent ? Number(form.ratePct) : null,
      expenseAccountId: form.kind === "DEDUCTION" ? null : form.expenseAccountId || null, liabilityAccountId: form.kind === "EARNING" ? null : form.liabilityAccountId || null, isActive: form.isActive,
    }),
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(`${c.name} saved`); onClose(); },
    onError: (err) => toast.error(getErrorMessage(err, "The component couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={component ? `Edit ${component.name}` : "Add pay component"} widthClassName="max-w-lg"
      description="Accounts left on default use Salaries & wages (6200), Employer payroll contributions (6210) and Payroll deductions payable (2420)."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="save-component">Save</Button></>}>
      <div className="space-y-3">
        <Field htmlFor="pc-name" label="Name" required><Input id="pc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} placeholder="House rent allowance" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="pc-kind" label="Kind" hint={KIND_HINT[form.kind]}>
            <Select id="pc-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as PayComponentKind })}>
              <option value="EARNING">Earning</option>
              <option value="DEDUCTION">Deduction</option>
              <option value="EMPLOYER_CONTRIBUTION">Employer contribution</option>
            </Select>
          </Field>
          <Field htmlFor="pc-calc" label="Amount">
            <Select id="pc-calc" value={form.calculation} onChange={(e) => setForm({ ...form, calculation: e.target.value as PayComponent["calculation"] })}>
              <option value="FIXED">Fixed per employee</option>
              <option value="PERCENT_OF_BASIC">Percentage of basic</option>
            </Select>
          </Field>
        </div>
        {percent && <Field htmlFor="pc-rate" label="Rate (%)" required hint="Each employee can have their own rate"><Input id="pc-rate" inputMode="decimal" value={form.ratePct} onChange={(e) => setForm({ ...form, ratePct: e.target.value })} /></Field>}
        {basicAllowed && <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.isBasic} onChange={(e) => setForm({ ...form, isBasic: e.target.checked })} /> This is the basic salary (percentages are of this)</label>}
        {form.kind !== "DEDUCTION" && (
          <Field htmlFor="pc-exp" label="Cost account">
            <Select id="pc-exp" value={form.expenseAccountId} onChange={(e) => setForm({ ...form, expenseAccountId: e.target.value })}>
              <option value="">Default</option>
              {expenseOptions.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </Select>
          </Field>
        )}
        {form.kind !== "EARNING" && (
          <Field htmlFor="pc-lia" label={form.kind === "DEDUCTION" ? "Withheld to / recovers" : "Owed on account"} hint={form.kind === "DEDUCTION" ? "A liability waits until paid over; an asset such as Employee advances is recovered" : "Where it waits until paid over"}>
            <Select id="pc-lia" value={form.liabilityAccountId} onChange={(e) => setForm({ ...form, liabilityAccountId: e.target.value })}>
              <option value="">Default</option>
              {liabilityOptions.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </Select>
          </Field>
        )}
        {component && <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active (new pay runs use it)</label>}
      </div>
    </Modal>
  );
}
