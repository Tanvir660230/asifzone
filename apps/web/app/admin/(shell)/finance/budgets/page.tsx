"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, TrendingUp } from "lucide-react";
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
import { SegmentedControl } from "@/components/ui/tabs";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { BudgetRow, CashForecast } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";

type View = "forecast" | "budget";
const SOURCE_LABEL: Record<CashForecast["lines"][number]["source"], string> = { CLEARING: "in transit", SUPPLIER_BILL: "supplier bill", COMMITMENT: "recurring cost", LOAN: "loan", PURCHASE_ORDER: "purchase order", PAYROLL: "payroll" };

/** Budgets and cash (docs/FINANCE_BUDGETS.md): what cash will look like over the coming weeks from what is already known,
 * how long it lasts at the recent pace, and how the year is going against plan. */
export default function BudgetsPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("finance.view");
  const [view, setView] = useState<View>("forecast");
  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={TrendingUp} title="Budgets aren't available to your role" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Budgets & cash" description="The cash coming and going over the next weeks, how long it lasts, and the year against plan." />
      <SegmentedControl aria-label="View" options={[{ value: "forecast" as const, label: "Cash forecast" }, { value: "budget" as const, label: "Budget vs actual" }]} value={view} onChange={setView} />
      {view === "forecast" ? <Forecast /> : <Budgets canEdit={can("finance.transact")} />}
    </div>
  );
}

function Forecast() {
  const [weeks, setWeeks] = useState(13);
  const q = useQuery({ queryKey: financeApi.budgetKeys.forecast(weeks), queryFn: () => financeApi.getCashForecast(weeks) });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <Alert variant="danger" title="The forecast couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>;
  const f = q.data;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Cash now" value={formatPrice(f.opening)} hint={`${f.money.length} cash, bank and wallet account${f.money.length === 1 ? "" : "s"}`} />
        <Stat label="Lowest point" value={formatPrice(f.lowest.balance)} hint={f.lowest.week ? `week ${f.lowest.week} (to ${f.lowest.date})` : "today"} tone={f.lowest.balance < 0 ? "danger" : undefined} />
        <Stat label={`In ${f.weeks} weeks`} value={formatPrice(f.closing)} tone={f.closing < 0 ? "danger" : undefined} />
        <Stat label="Runway" value={f.runway.months === null ? "Not falling" : `${f.runway.months} months`} hint={`${f.runway.averageMonthlyChange >= 0 ? "+" : ""}${formatPrice(f.runway.averageMonthlyChange)} a month, ${f.runway.basis}`} />
      </dl>
      {f.lowest.balance < 0 && <Alert variant="warning" title={`Cash runs short in week ${f.lowest.week}`}>Known payments exceed cash by {formatPrice(-f.lowest.balance)}. Expected sales aren&apos;t in this forecast — check what will come in before then.</Alert>}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink-900">Week by week</h2>
        <Select aria-label="Weeks" value={String(weeks)} onChange={(e) => setWeeks(Number(e.target.value))} className="w-36">
          <option value="13">13 weeks</option>
          <option value="26">26 weeks</option>
        </Select>
      </div>
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead><tr><TableHeaderCell>Week</TableHeaderCell><TableHeaderCell align="right">In</TableHeaderCell><TableHeaderCell align="right">Out</TableHeaderCell><TableHeaderCell align="right">Cash at the end</TableHeaderCell></tr></TableHead>
            <tbody>
              {f.byWeek.map((w) => (
                <TableRow key={w.week} data-testid="forecast-week">
                  <TableCell className="whitespace-nowrap tabular-nums">{w.week} · {w.from}</TableCell>
                  <TableCell align="right" className="tabular-nums">{w.inflow ? formatPrice(w.inflow) : "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{w.outflow ? formatPrice(w.outflow) : "—"}</TableCell>
                  <TableCell align="right" className={w.closing < 0 ? "font-medium tabular-nums text-danger-700" : "font-medium tabular-nums"}>{formatPrice(w.closing)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
      </Card>
      <h2 className="text-lg font-semibold text-ink-900">What it is made of</h2>
      {f.lines.length ? (
        <Card className="divide-y divide-line p-0 text-sm">
          {f.lines.map((l, i) => (
            <div key={`${l.ref}-${l.date}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" data-testid="forecast-line">
              <span className="min-w-0"><span className="tabular-nums text-ink-600">{l.date}</span> · {l.label} <Badge variant="neutral">{SOURCE_LABEL[l.source]}</Badge></span>
              <span className={l.amount < 0 ? "tabular-nums text-ink-900" : "tabular-nums text-success-700"}>{l.amount > 0 ? "+" : "−"}{formatPrice(Math.abs(l.amount))}</span>
            </div>
          ))}
        </Card>
      ) : (
        <p className="text-sm text-ink-600">Nothing known is due in this window.</p>
      )}
      <p className="text-xs text-ink-500">Includes money in transit, supplier bills by due date, recurring costs, planned loan instalments and open purchase orders. Expected sales are not forecast.</p>
    </div>
  );
}

function Budgets({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: financeApi.budgetKeys.list(), queryFn: financeApi.listBudgets });
  const [chosen, setChosen] = useState("");
  const id = chosen || list.data?.budgets[0]?.id || "";
  const one = useQuery({ queryKey: financeApi.budgetKeys.one(id), queryFn: () => financeApi.getBudget(id), enabled: Boolean(id) });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BudgetRow | "new" | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: financeApi.budgetKeys.list() });
  if (list.isLoading) return <Skeleton className="h-48 w-full" />;
  if (list.isError) return <Alert variant="danger" title="Budgets couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>}>{getErrorMessage(list.error, "")}</Alert>;
  const d = one.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {list.data!.budgets.length > 0 && (
          <Field htmlFor="budget" label="Budget" className="w-full sm:w-96">
            <Select id="budget" value={id} onChange={(e) => setChosen(e.target.value)}>
              {list.data!.budgets.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.startMonth} – {b.endMonth})</option>)}
            </Select>
          </Field>
        )}
        {canEdit && <Button size="sm" variant="outline" onClick={() => setCreating(true)} data-testid="new-budget"><Plus className="h-4 w-4" /> New budget</Button>}
        {canEdit && d && <Button size="sm" variant="ghost" onClick={() => setEditing("new")}>Plan another account</Button>}
      </div>
      {!list.data!.budgets.length && <EmptyState icon={TrendingUp} title="No budget yet" description="Start from last year's figures or an empty plan, then compare each month with the books." />}
      {one.isLoading && id && <Skeleton className="h-48 w-full" />}
      {d && (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label={`Profit planned to ${d.through}`} value={formatPrice(d.totals.netProfit.budgetYtd)} />
            <Stat label="Actual profit" value={formatPrice(d.totals.netProfit.actualYtd)} />
            <Stat label="Against plan" value={`${d.totals.netProfit.variance >= 0 ? "+" : "−"}${formatPrice(Math.abs(d.totals.netProfit.variance))}`} tone={d.totals.netProfit.variance < 0 ? "danger" : undefined} />
            <Stat label="Planned for the year" value={formatPrice(d.totals.netProfit.budgetYear)} />
          </dl>
          {d.rows.length ? (
            <Card className="overflow-hidden p-0">
              <HScrollShadow>
                <Table>
                  <TableHead><tr><TableHeaderCell>Account</TableHeaderCell><TableHeaderCell align="right">Plan to date</TableHeaderCell><TableHeaderCell align="right">Actual</TableHeaderCell><TableHeaderCell align="right">Variance</TableHeaderCell><TableHeaderCell align="right">Plan for the year</TableHeaderCell><TableHeaderCell /></tr></TableHead>
                  <tbody>
                    {d.rows.map((r) => (
                      <TableRow key={r.account.id} data-testid="budget-row">
                        <TableCell className="min-w-52"><span className="font-mono text-xs text-ink-500">{r.account.code}</span> {r.account.name}</TableCell>
                        <TableCell align="right" className="tabular-nums">{formatPrice(r.budgetYtd)}</TableCell>
                        <TableCell align="right" className="tabular-nums">{formatPrice(r.actualYtd)}</TableCell>
                        <TableCell align="right" className={r.favourable === false ? "whitespace-nowrap tabular-nums text-danger-700" : r.favourable ? "whitespace-nowrap tabular-nums text-success-700" : "tabular-nums"}>
                          {r.variance >= 0 ? "+" : "−"}{formatPrice(Math.abs(r.variance))}{r.variancePct !== null ? <span className="block text-xs">{r.variancePct}%</span> : null}
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">{formatPrice(r.budgetYear)}</TableCell>
                        <TableCell align="right">{canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit plan</Button>}</TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </HScrollShadow>
            </Card>
          ) : (
            <p className="text-sm text-ink-600">Nothing planned or booked in this budget&apos;s months yet — plan an account to begin.</p>
          )}
          <p className="text-xs text-ink-500">Actuals are the income statement&apos;s own figures. Green is better than plan: more income or less cost.</p>
        </>
      )}
      {creating && <CreateBudgetModal onClose={() => setCreating(false)} onDone={(newId) => { setCreating(false); setChosen(newId); refresh(); }} />}
      {editing && d && <PlanModal budget={d} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: financeApi.budgetKeys.one(id) }); }} />}
    </div>
  );
}

function CreateBudgetModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const now = new Date().toISOString().slice(0, 7);
  const [name, setName] = useState("");
  const [start, setStart] = useState(now);
  const [copy, setCopy] = useState(true);
  const [pct, setPct] = useState("0");
  const valid = name.trim().length >= 2 && /^\d{4}-\d{2}$/.test(start);
  const save = useMutation({
    mutationFn: () => financeApi.createBudget({ name: name.trim(), startMonth: start, months: 12, copyFrom: copy ? "LAST_YEAR" : null, adjustPct: Number(pct) || 0 }),
    onSuccess: (b) => { toast.success(`${b.name} created${b.lines ? ` with ${b.lines} planned figures` : ""}`); onDone(b.id); },
    onError: (err) => toast.error(getErrorMessage(err, "The budget couldn't be created")),
  });
  return (
    <Modal open onClose={onClose} title="New budget" description="Twelve months from the month you choose." widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="confirm-budget">Create</Button></>}>
      <div className="space-y-3">
        <Field htmlFor="bg-name" label="Name" required><Input id="bg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="FY 2026-27" maxLength={120} /></Field>
        <Field htmlFor="bg-start" label="First month" required><Input id="bg-start" type="month" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field htmlFor="bg-copy" label="Start from">
          <Select id="bg-copy" value={copy ? "last" : "empty"} onChange={(e) => setCopy(e.target.value === "last")}>
            <option value="last">The same months last year</option>
            <option value="empty">An empty plan</option>
          </Select>
        </Field>
        {copy && <Field htmlFor="bg-pct" label="Change from last year (%)" hint="10 plans everything 10% higher"><Input id="bg-pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

function PlanModal({ budget, row, onClose, onDone }: { budget: financeApi.BudgetVsActual; row: BudgetRow | null; onClose: () => void; onDone: () => void }) {
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart, enabled: !row });
  const plAccounts = useMemo(() => (chart.data?.accounts ?? []).filter((a) => a.isPostable && a.isActive && !a.restricted && ["REVENUE", "COGS", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"].includes(a.type)), [chart.data]);
  const [accountId, setAccountId] = useState(row?.account.id ?? "");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(budget.months.map((m) => [m, String(row?.months.find((x) => x.periodKey === m)?.budget ?? "")])));
  const [annual, setAnnual] = useState("");
  const valid = Boolean(accountId) && budget.months.every((m) => values[m] === "" || Number(values[m]) >= 0);
  const spread = () => {
    const total = Math.round(Number(annual) * 100);
    if (!(total >= 0)) return;
    const each = Math.floor(total / budget.months.length);
    const rest = total - each * budget.months.length;
    setValues(Object.fromEntries(budget.months.map((m, i) => [m, String((each + (i < rest ? 1 : 0)) / 100)])));
  };
  const save = useMutation({
    mutationFn: () => financeApi.setBudgetLines(budget.budget.id, budget.months.map((m) => ({ accountId, periodKey: m, amount: Number(values[m] || 0) }))),
    onSuccess: () => { toast.success("Plan saved"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The plan couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={row ? `${row.account.code} ${row.account.name}` : "Plan an account"} description="Amounts in the account's own direction: income earned, or cost spent." widthClassName="max-w-xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="confirm-plan">Save plan</Button></>}>
      <div className="space-y-4">
        {!row && (
          <Field htmlFor="pl-acc" label="Account" required>
            <Select id="pl-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Choose…</option>
              {plAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="flex items-end gap-2">
          <Field htmlFor="pl-annual" label="For the year" className="flex-1"><Input id="pl-annual" inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} /></Field>
          <Button size="sm" variant="outline" onClick={spread} disabled={!annual}>Spread evenly</Button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {budget.months.map((m) => (
            <Field key={m} htmlFor={`pl-${m}`} label={m}><Input id={`pl-${m}`} inputMode="decimal" value={values[m] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [m]: e.target.value }))} /></Field>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" }) {
  return (
    <Card className="p-4">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd className={tone === "danger" ? "text-lg font-semibold tabular-nums text-danger-700" : "text-lg font-semibold tabular-nums text-ink-900"}>{value}</dd>
      {hint && <dd className="text-xs text-ink-500">{hint}</dd>}
    </Card>
  );
}
