"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Lock } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { ChartAccount, LedgerAccountType } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";

const TYPE_LABEL: Record<LedgerAccountType, string> = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", REVENUE: "Revenue", COGS: "Cost of goods sold", EXPENSE: "Operating expenses", OTHER_INCOME: "Other income", OTHER_EXPENSE: "Other expenses" };
const TYPES = Object.keys(TYPE_LABEL) as LedgerAccountType[];

/** The general ledger (docs/FINANCE_STATEMENTS.md): every account with its balance from posted journals, and each
 * account's ledger with a running balance. Ownership, partner and payroll accounts are visible to the owner only. */
export default function LedgerPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("finance.view");
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart, enabled: allowed });
  const [q, setQ] = useState("");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [open, setOpen] = useState<ChartAccount | null>(null);
  // ?account=<id> (e.g. from Partners & equity) opens that account once
  const linkedId = useSearchParams().get("account");
  const [linkDismissed, setLinkDismissed] = useState(false);
  const linked = linkedId && !linkDismissed ? chart.data?.accounts.find((a) => a.id === linkedId && !a.restricted) ?? null : null;
  const shown = open ?? linked;
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (chart.data?.accounts ?? []).filter((a) => (!term || a.code.includes(term) || a.name.toLowerCase().includes(term)) && (!hideEmpty || !a.isPostable || a.restricted || (a.balance ?? 0) !== 0));
  }, [chart.data, q, hideEmpty]);

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={BookOpen} title="The ledger isn't available to your role" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Ledger" description="Every account and its balance from posted journals. Open an account to see each posting." />
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search code or name" wrapperClassName="w-full sm:w-72" />
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <Checkbox checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide accounts with no balance
        </label>
      </div>
      {chart.isLoading && <Skeleton className="h-64 w-full" />}
      {chart.isError && <Alert variant="danger" title="The chart of accounts couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => chart.refetch()}>Retry</Button>}>{getErrorMessage(chart.error, "")}</Alert>}
      {chart.data && (
        <div className="space-y-4">
          {TYPES.map((type) => {
            const rows = filtered.filter((a) => a.type === type);
            if (!rows.length) return null;
            const total = rows.filter((a) => a.isPostable && a.balance !== null).reduce((s, a) => s + Math.round((a.balance ?? 0) * 100), 0) / 100;
            return (
              <Card key={type} className="overflow-hidden p-0">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <h2 className="text-base font-semibold text-ink-900">{TYPE_LABEL[type]}</h2>
                  <span className="text-sm font-medium tabular-nums text-ink-900">{formatPrice(total)}</span>
                </div>
                <ul className="divide-y divide-line text-sm">
                  {rows.map((a) => (
                    <li key={a.id}>
                      {a.isPostable ? (
                        <button type="button" onClick={() => !a.restricted && setOpen(a)} disabled={a.restricted} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-muted disabled:cursor-default disabled:hover:bg-transparent" data-testid="ledger-account">
                          <span className="min-w-0"><span className="font-mono text-xs text-ink-500">{a.code}</span> <span className="text-ink-900">{a.name}</span>{!a.isActive && <span className="text-xs text-ink-500"> · inactive</span>}</span>
                          <span className="flex items-center gap-1 tabular-nums text-ink-900">{a.restricted ? <><Lock aria-hidden className="h-3.5 w-3.5 text-ink-500" /><span className="text-ink-500">owner only</span></> : formatPrice(a.balance ?? 0)}</span>
                        </button>
                      ) : (
                        <div className="bg-surface-muted px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-600"><span className="font-mono">{a.code}</span> {a.name}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
          {!filtered.length && <EmptyState icon={BookOpen} title="No accounts match" description="Try another search, or show accounts with no balance." />}
        </div>
      )}
      {shown && <AccountLedgerDrawer account={shown} onClose={() => { setOpen(null); setLinkDismissed(true); }} />}
    </div>
  );
}

function AccountLedgerDrawer({ account, onClose }: { account: ChartAccount; onClose: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = { from: from || undefined, to: to || undefined };
  const q = useQuery({ queryKey: financeApi.ledgerKeys.ledger(account.id, params), queryFn: () => financeApi.getLedger(account.id, params), enabled: !(from && to && from > to) });
  return (
    <Drawer open onClose={onClose} title={`${account.code} ${account.name}`} widthClassName="max-w-3xl">
      <div className="space-y-4 p-4 sm:p-6">
        <p className="text-sm text-ink-600">{TYPE_LABEL[account.type]} · normal balance {account.normalBalance.toLowerCase()}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field htmlFor="lg-from" label="From"><Input id="lg-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field htmlFor="lg-to" label="To" error={from && to && from > to ? "Before From" : undefined}><Input id="lg-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {q.isLoading && <Skeleton className="h-40 w-full" />}
        {q.isError && <Alert variant="danger" title="The ledger couldn't be loaded">{getErrorMessage(q.error, "")}</Alert>}
        {q.data && (
          <>
            <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="text-ink-600">Opening {formatPrice(q.data.openingBalance)}</span><span className="font-semibold text-ink-900">Closing {formatPrice(q.data.closingBalance)}</span></div>
            {q.data.truncated && <Alert variant="info" title="Showing the first 5,000 postings">Narrow the dates to see the rest.</Alert>}
            {q.data.lines.length ? (
              <Card className="overflow-hidden p-0">
                <HScrollShadow>
                  <Table>
                    <TableHead><tr><TableHeaderCell>Date</TableHeaderCell><TableHeaderCell>Entry</TableHeaderCell><TableHeaderCell align="right">Debit</TableHeaderCell><TableHeaderCell align="right">Credit</TableHeaderCell><TableHeaderCell align="right">Balance</TableHeaderCell></tr></TableHead>
                    <tbody>
                      {q.data.lines.map((l) => (
                        <TableRow key={`${l.entryId}-${l.lineNo}`} data-testid="ledger-line">
                          <TableCell className="whitespace-nowrap tabular-nums">{l.entryDate}</TableCell>
                          <TableCell className="min-w-56">#{l.number} {l.description}{l.memo ? <span className="block text-xs text-ink-500">{l.memo}</span> : null}</TableCell>
                          <TableCell align="right" className="tabular-nums">{l.debit ? formatPrice(l.debit) : "—"}</TableCell>
                          <TableCell align="right" className="tabular-nums">{l.credit ? formatPrice(l.credit) : "—"}</TableCell>
                          <TableCell align="right" className="font-medium tabular-nums">{formatPrice(l.balance)}</TableCell>
                        </TableRow>
                      ))}
                    </tbody>
                  </Table>
                </HScrollShadow>
              </Card>
            ) : (
              <p className="text-sm text-ink-600">No postings in this period.</p>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
