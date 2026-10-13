"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Download, Landmark } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/tabs";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { StatementSection } from "@/lib/api/finance";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatPrice } from "@/lib/format";

type View = "income" | "balance" | "cash" | "trial";
const VIEWS = [
  { value: "income" as const, label: "Income" },
  { value: "balance" as const, label: "Balance sheet" },
  { value: "cash" as const, label: "Cash flow" },
  { value: "trial" as const, label: "Trial balance" },
];
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;

/** Financial statements (docs/FINANCE_STATEMENTS.md), read from posted journals — the same sums as the trial balance, so
 * they always agree with it: income statement (with the prior period), balance sheet, cash flow (indirect) and the trial
 * balance itself. */
export default function StatementsPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("finance.view");
  const [view, setView] = useState<View>("income");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [brandId, setBrandId] = useState("");
  // brands report into the business: with more than one, each statement can be read for one brand (the trial balance is
  // the whole business — it has no brand filter)
  const business = useQuery({ queryKey: ["finance", "business"], queryFn: financeApi.getBusiness, enabled: allowed });
  const brands = (business.data?.brands ?? []).filter((b) => b.isActive);
  const badRange = Boolean(from && to && from > to);
  const brand = brandId || undefined;
  const period = { from: from || undefined, to: to || undefined };
  const income = useQuery({ queryKey: financeApi.ledgerKeys.statement("income", { ...period, brand }), queryFn: () => financeApi.getIncomeStatement({ ...period, brandId: brand }), enabled: allowed && view === "income" && !badRange });
  const balance = useQuery({ queryKey: financeApi.ledgerKeys.statement("balance", { to, brand }), queryFn: () => financeApi.getBalanceSheet({ asOf: to || undefined, brandId: brand }), enabled: allowed && view === "balance" });
  const cash = useQuery({ queryKey: financeApi.ledgerKeys.statement("cash", { ...period, brand }), queryFn: () => financeApi.getCashFlow({ ...period, brandId: brand }), enabled: allowed && view === "cash" && !badRange });
  const trial = useQuery({ queryKey: financeApi.ledgerKeys.trialBalance(period), queryFn: () => financeApi.getTrialBalance(period), enabled: allowed && view === "trial" && !badRange });
  const active = { income, balance, cash, trial }[view];

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Landmark} title="Statements aren't available to your role" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Financial statements" description="Profit, financial position and cash — straight from the posted books." />
      <div className="flex flex-wrap items-end gap-3">
        <SegmentedControl aria-label="Statement" options={VIEWS} value={view} onChange={setView} className="w-full overflow-x-auto sm:w-auto" />
        {view !== "balance" && <Field htmlFor="st-from" label="From" className="w-[calc(50%-6px)] sm:w-40"><Input id="st-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>}
        {brands.length > 1 && view !== "trial" && (
          <Field htmlFor="st-brand" label="Brand" className="w-full sm:w-48">
            <Select id="st-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)} data-testid="statement-brand">
              <option value="">Whole business</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        )}
        <Field htmlFor="st-to" label={view === "balance" ? "As at" : "To"} className="w-[calc(50%-6px)] sm:w-40" error={view !== "balance" && badRange ? "Before From" : undefined}><Input id="st-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {active.isLoading && <Skeleton className="h-64 w-full" />}
      {active.isError && <Alert variant="danger" title="The statement couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => active.refetch()}>Retry</Button>}>{getErrorMessage(active.error, "")}</Alert>}

      {view === "income" && income.data && (
        <>
          <Totals items={[{ label: "Revenue", value: sec(income.data.current.sections, "revenue") }, { label: "Gross profit", value: income.data.current.grossProfit, hint: income.data.current.grossMarginPct === null ? undefined : `${income.data.current.grossMarginPct}% margin` }, { label: "Operating profit", value: income.data.current.operatingProfit }, { label: "Net profit", value: income.data.current.netProfit, strong: true }]} />
          <StatementTable
            title={`${income.data.period.from} to ${income.data.period.to}`}
            compareLabel={`${income.data.prior.from} to ${income.data.prior.to}`}
            sections={income.data.current.sections}
            prior={income.data.priorPeriod.sections}
            subtotals={{ cogs: ["Gross profit", income.data.current.grossProfit, income.data.priorPeriod.grossProfit], expenses: ["Operating profit", income.data.current.operatingProfit, income.data.priorPeriod.operatingProfit], otherExpenses: ["Net profit", income.data.current.netProfit, income.data.priorPeriod.netProfit] }}
            csvName={`income-${income.data.period.from}-${income.data.period.to}.csv`}
          />
        </>
      )}

      {view === "balance" && balance.data && (
        <>
          <Totals items={[{ label: "Assets", value: balance.data.totalAssets }, { label: "Liabilities", value: sec(balance.data.sections, "liabilities") }, { label: "Equity", value: sec(balance.data.sections, "equity") }, { label: "Liabilities + equity", value: balance.data.totalLiabilitiesAndEquity, strong: true }]} />
          <Check ok={balance.data.balanced} okText="Assets equal liabilities plus equity." badText="The sheet doesn't balance — run Books health check → ledger integrity." />
          <StatementTable title={`As at ${balance.data.asOf}`} sections={balance.data.sections} subtotals={{}} csvName={`balance-sheet-${balance.data.asOf}.csv`} />
        </>
      )}

      {view === "cash" && cash.data && (
        <>
          <Totals items={[{ label: "Net profit", value: cash.data.netProfit }, { label: "Cash from operations", value: cash.data.operatingCashFlow }, { label: "Net change in money", value: cash.data.netChange, strong: true }, { label: "Money at the end", value: cash.data.money.closing }]} />
          <Check ok={cash.data.reconciles} okText={`Explains the money accounts exactly: ${formatPrice(cash.data.money.opening)} → ${formatPrice(cash.data.money.closing)}.`} badText="The statement doesn't explain the money accounts' change — run the Books health check." />
          <StatementTable title={`${cash.data.period.from} to ${cash.data.period.to}`} lead={["Net profit", cash.data.netProfit]} sections={cash.data.sections} subtotals={{ operating: ["Cash from operations", cash.data.operatingCashFlow] }} csvName={`cash-flow-${cash.data.period.from}-${cash.data.period.to}.csv`} />
        </>
      )}

      {view === "trial" && trial.data && (
        <>
          <Check ok={trial.data.balanced} okText={`Debits equal credits: ${formatPrice(trial.data.totalDebit)}.`} badText="Debits and credits differ — run Books health check → ledger integrity." />
          <Card className="overflow-hidden p-0">
            <HScrollShadow>
              <Table>
                <TableHead><tr><TableHeaderCell>Account</TableHeaderCell><TableHeaderCell align="right">Opening</TableHeaderCell><TableHeaderCell align="right">Debits</TableHeaderCell><TableHeaderCell align="right">Credits</TableHeaderCell><TableHeaderCell align="right">Closing Dr</TableHeaderCell><TableHeaderCell align="right">Closing Cr</TableHeaderCell></tr></TableHead>
                <tbody>
                  {trial.data.rows.map((r) => (
                    <TableRow key={r.accountId} data-testid="tb-row">
                      <TableCell className="min-w-56"><span className="font-mono text-xs text-ink-500">{r.code}</span> {r.name}</TableCell>
                      <TableCell align="right" className="tabular-nums">{r.opening === null ? "—" : formatPrice(r.opening)}</TableCell>
                      <TableCell align="right" className="tabular-nums">{r.periodDebit === null ? "—" : formatPrice(r.periodDebit)}</TableCell>
                      <TableCell align="right" className="tabular-nums">{r.periodCredit === null ? "—" : formatPrice(r.periodCredit)}</TableCell>
                      <TableCell align="right" className="tabular-nums">{r.closingDebit ? formatPrice(r.closingDebit) : "—"}</TableCell>
                      <TableCell align="right" className="tabular-nums">{r.closingCredit ? formatPrice(r.closingCredit) : "—"}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow><TableCell className="font-semibold">Total</TableCell><TableCell /><TableCell /><TableCell /><TableCell align="right" className="font-semibold tabular-nums">{formatPrice(trial.data.totalDebit)}</TableCell><TableCell align="right" className="font-semibold tabular-nums">{formatPrice(trial.data.totalCredit)}</TableCell></TableRow>
                </tbody>
              </Table>
            </HScrollShadow>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadCsv(`trial-balance-${from || "start"}-${to}.csv`, toCsv([{ key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "opening", label: "Opening" }, { key: "periodDebit", label: "Debits" }, { key: "periodCredit", label: "Credits" }, { key: "closingDebit", label: "Closing debit" }, { key: "closingCredit", label: "Closing credit" }], trial.data!.rows))}><Download className="h-4 w-4" /> CSV</Button>
        </>
      )}
    </div>
  );
}

const sec = (sections: StatementSection[], key: string) => sections.find((s) => s.key === key)?.total ?? 0;

function Totals({ items }: { items: Array<{ label: string; value: number; hint?: string; strong?: boolean }> }) {
  return (
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="statement-totals">
      {items.map((t) => (
        <Card key={t.label} className="p-4">
          <dt className="text-sm text-ink-600">{t.label}</dt>
          <dd className={t.strong ? "text-lg font-semibold tabular-nums text-ink-900" : "text-lg tabular-nums text-ink-900"}>{formatPrice(t.value)}</dd>
          {t.hint && <dd className="text-xs text-ink-500">{t.hint}</dd>}
        </Card>
      ))}
    </dl>
  );
}

function Check({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <p className={ok ? "flex items-center gap-2 text-sm text-success-700" : "flex items-center gap-2 text-sm text-danger-700"} data-testid="statement-check">
      {ok ? <CheckCircle2 aria-hidden className="h-4 w-4" /> : <CircleAlert aria-hidden className="h-4 w-4" />}{ok ? okText : badText}
    </p>
  );
}

/** Sections with their account lines, a subtotal row after the named sections, and the prior period alongside. */
function StatementTable({ title, compareLabel, sections, prior, subtotals, lead, csvName }: { title: string; compareLabel?: string; sections: StatementSection[]; prior?: StatementSection[]; subtotals: Record<string, [string, number, number?]>; lead?: [string, number]; csvName: string }) {
  const priorOf = (key: string, accountId: string | null, name: string) => prior?.find((s) => s.key === key)?.lines.find((l) => (accountId ? l.accountId === accountId : l.name === name))?.amount ?? 0;
  const csvRows = [
    ...(lead ? [{ section: "", account: lead[0], amount: lead[1] }] : []),
    ...sections.flatMap((s) => [...s.lines.map((l) => ({ section: s.label, account: `${l.code} ${l.name}`, amount: l.amount, ...(prior ? { prior: priorOf(s.key, l.accountId, l.name) } : {}) })), { section: s.label, account: `Total ${s.label.toLowerCase()}`, amount: s.total, ...(prior ? { prior: prior.find((p) => p.key === s.key)?.total ?? 0 } : {}) }]),
  ];
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        <Button size="sm" variant="ghost" onClick={() => downloadCsv(csvName, toCsv([{ key: "section", label: "Section" }, { key: "account", label: "Account" }, { key: "amount", label: title }, ...(prior ? [{ key: "prior", label: compareLabel ?? "Prior" }] : [])], csvRows))}><Download className="h-4 w-4" /> CSV</Button>
      </div>
      <HScrollShadow>
        <Table>
          <TableHead><tr><TableHeaderCell>Account</TableHeaderCell><TableHeaderCell align="right">Amount</TableHeaderCell>{prior && <TableHeaderCell align="right">Prior period</TableHeaderCell>}</tr></TableHead>
          <tbody>
            {lead && <TableRow><TableCell className="font-semibold">{lead[0]}</TableCell><TableCell align="right" className="font-semibold tabular-nums">{formatPrice(lead[1])}</TableCell></TableRow>}
            {sections.map((s) => (
              <SectionRows key={s.key} section={s} priorTotal={prior?.find((p) => p.key === s.key)?.total} priorOf={prior ? (l) => priorOf(s.key, l.accountId, l.name) : undefined} subtotal={subtotals[s.key]} />
            ))}
          </tbody>
        </Table>
      </HScrollShadow>
    </Card>
  );
}

function SectionRows({ section, priorTotal, priorOf, subtotal }: { section: StatementSection; priorTotal?: number; priorOf?: (l: StatementSection["lines"][number]) => number; subtotal?: [string, number, number?] }) {
  return (
    <>
      <TableRow><TableCell className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-ink-600">{section.label}</TableCell><TableCell className="bg-surface-muted" />{priorOf && <TableCell className="bg-surface-muted" />}</TableRow>
      {section.lines.length === 0 && <TableRow><TableCell className="text-sm text-ink-500">Nothing in this period</TableCell><TableCell align="right" className="tabular-nums text-ink-500">—</TableCell>{priorOf && <TableCell />}</TableRow>}
      {section.lines.map((l) => (
        <TableRow key={`${l.code}-${l.name}`} data-testid="statement-line">
          <TableCell className="min-w-56"><span className="font-mono text-xs text-ink-500">{l.code}</span> {l.name}</TableCell>
          <TableCell align="right" className="tabular-nums">{formatPrice(l.amount)}</TableCell>
          {priorOf && <TableCell align="right" className="tabular-nums text-ink-600">{formatPrice(priorOf(l))}</TableCell>}
        </TableRow>
      ))}
      <TableRow><TableCell className="font-medium">Total {section.label.toLowerCase()}</TableCell><TableCell align="right" className="font-medium tabular-nums">{formatPrice(section.total)}</TableCell>{priorOf && <TableCell align="right" className="font-medium tabular-nums text-ink-600">{formatPrice(priorTotal ?? 0)}</TableCell>}</TableRow>
      {subtotal && <TableRow><TableCell className="font-semibold text-ink-900">{subtotal[0]}</TableCell><TableCell align="right" className="font-semibold tabular-nums text-ink-900">{formatPrice(subtotal[1])}</TableCell>{priorOf && <TableCell align="right" className="font-semibold tabular-nums text-ink-600">{formatPrice(subtotal[2] ?? 0)}</TableCell>}</TableRow>}
    </>
  );
}
