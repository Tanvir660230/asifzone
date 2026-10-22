"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, CircleCheck, ClipboardCheck, MessageSquareText, Plus, Scale, Split, Trash2, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/tabs";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as booksApi from "@/lib/api/finance-books";
import type { AwaitingExpense, EntryVerification, VerificationItem } from "@/lib/api/finance-books";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type View = "summary" | "check" | "allocate" | "renewals" | "sms" | "settings";
const VIEWS: Array<{ value: View; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "check", label: "To check" },
  { value: "allocate", label: "Split costs" },
  { value: "renewals", label: "Renewals" },
  { value: "sms", label: "SMS" },
  { value: "settings", label: "Settings" },
];
const VERIFY: Record<EntryVerification, { label: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  CONFIRMED: { label: "confirmed", variant: "success" }, ESTIMATED: { label: "estimate", variant: "warning" }, NEEDS_CHECK: { label: "to check", variant: "warning" }, DISPUTED: { label: "disputed", variant: "danger" },
};
const RECORD: Record<string, string> = {
  Expense: "Expense", PrepaidCost: "Prepaid cost", FixedAsset: "Asset", OpeningBalanceLine: "Opening balance", OpeningInventoryItem: "Opening stock", LandedCost: "Landed cost", TreasuryMovement: "Money movement", AdSpendDay: "Ad spend",
};

/** Finance Center (docs/FINANCE_CENTER.md): what the owner put in, which figures are still estimates, costs to split,
 * subscriptions to renew and the SMS balance — each figure links to the records behind it. */
export default function FinanceCenterPage() {
  const { can, ready } = useCapabilities();
  const params = useSearchParams();
  const initial = (VIEWS.find((v) => v.value === params.get("view"))?.value ?? "summary") as View;
  const [view, setView] = useState<View>(initial);
  if (ready && !can("finance.view")) return <div><ModuleTabs /><EmptyState icon={Scale} title="The owner's summary isn't available to your role" /></div>;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Owner's summary" description="What you have put into the business, which figures are still estimates, costs waiting to be split, renewals and the SMS balance." />
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <SegmentedControl aria-label="View" options={VIEWS} value={view} onChange={setView} />
      </div>
      {view === "summary" && <Summary onView={setView} />}
      {view === "check" && <ToCheck initialStatus={(params.get("status") as EntryVerification | null) ?? undefined} canSet={can("finance.post")} />}
      {view === "allocate" && <Allocate canSplit={can("finance.post")} />}
      {view === "renewals" && <Renewals />}
      {view === "sms" && <Sms canRecord={can("finance.transact")} />}
      {view === "settings" && (
        <div className="space-y-6">
          <Autopilot canEdit={can("finance.sensitive")} />
          <Settings canEdit={can("finance.configure")} />
        </div>
      )}
    </div>
  );
}

function LoadError({ what, error, retry }: { what: string; error: unknown; retry: () => void }) {
  return <Alert variant="danger" title={`${what} couldn't be loaded`} action={<Button size="sm" variant="outline" onClick={retry}>Retry</Button>}>{getErrorMessage(error, "")}</Alert>;
}

// ── summary ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function Summary({ onView }: { onView: (v: View) => void }) {
  const q = useQuery({ queryKey: booksApi.centerKeys.summary(), queryFn: booksApi.getCenterSummary });
  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.isError) return <LoadError what="The summary" error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const v = d.verification;
  const unsure = (v.ESTIMATED?.count ?? 0) + (v.NEEDS_CHECK?.count ?? 0) + (v.DISPUTED?.count ?? 0);
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Owner">
        <StatTile label="You have put in (net)" value={formatPrice(Math.round(d.owner.netInvested))} icon={<Wallet />} tone="accent" href="/admin/finance/equity" />
        <StatTile label="Paid from your pocket, not repaid" value={formatPrice(Math.round(d.owner.ownerPaidNotRepaid))} icon={<Wallet />} href="/admin/finance/expenses" />
        <StatTile label="Taken out" value={formatPrice(Math.round(d.owner.drawings))} icon={<Wallet />} href="/admin/finance/equity" />
        <StatTile label="Figures not yet confirmed" value={String(unsure)} icon={<ClipboardCheck />} tone={unsure ? "warning" : "default"} onClick={() => onView("check")} />
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card className="p-5" data-testid="put-in-breakdown">
          <h2 className="text-[15px] font-semibold tracking-tight text-fg">How “put in” adds up</h2>
          <p className="text-xs text-fg-muted">From the ledger as of {formatBookDate(d.asOf)}.</p>
          <dl className="mt-3 divide-y divide-line-subtle text-sm">
            <SumLine label="Owner capital" value={d.owner.capital} />
            <SumLine label="What the books started with" value={d.owner.openingEquity} />
            <SumLine label="Paid from your pocket" value={d.owner.ownerPaidNotRepaid} />
            <SumLine label="Taken out" value={-d.owner.drawings} />
            <SumLine label="Put in (net)" value={d.owner.netInvested} strong />
          </dl>
        </Card>
        <Card className="overflow-hidden p-0">
          <div className="border-b border-line-subtle px-5 py-4"><h2 className="text-[15px] font-semibold tracking-tight text-fg">Missing or unsure</h2><p className="text-xs text-fg-muted">The books never guess these — each one says what is needed.</p></div>
          {d.missing.length === 0 ? (
            <div className="flex items-center gap-2 px-5 py-6 text-sm text-fg-muted"><CircleCheck className="h-4 w-4 text-success-600" aria-hidden /> Nothing missing — every figure is confirmed.</div>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {d.missing.map((m) => (
                <li key={m.key} data-testid="missing-item">
                  <Link href={m.href} className="group flex items-center gap-3 px-5 py-3.5 transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.03]">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-warning-500" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg">{m.title} <span className="tabular-nums font-normal text-fg-muted">· {m.count}</span></span>
                      <span className="block text-xs text-fg-muted">{m.detail}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-300 transition-transform duration-fast ease-smooth group-hover:translate-x-0.5 group-hover:text-fg-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function SumLine({ label, value: raw, strong }: { label: string; value: number; strong?: boolean }) {
  const value = raw === 0 ? 0 : raw; // −0 reads as "−৳0"
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-2", strong && "font-semibold text-fg")}>
      <dt className={strong ? "text-fg" : "text-fg-muted"}>{label}</dt>
      <dd className="tabular-nums text-fg">{value < 0 ? `−${formatPrice(-value)}` : formatPrice(value)}</dd>
    </div>
  );
}

// ── to check ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function ToCheck({ initialStatus, canSet }: { initialStatus?: EntryVerification; canSet: boolean }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<EntryVerification | "">(initialStatus ?? "");
  const q = useQuery({ queryKey: booksApi.centerKeys.verifications(status || undefined), queryFn: () => booksApi.listVerifications(status || undefined) });
  const [editing, setEditing] = useState<VerificationItem | null>(null);
  return (
    <div className="space-y-4">
      <Field htmlFor="vf-status" label="Show" className="w-56">
        <Select id="vf-status" value={status} onChange={(e) => setStatus(e.target.value as EntryVerification | "")}>
          <option value="">Everything not confirmed</option>
          <option value="NEEDS_CHECK">To check</option>
          <option value="ESTIMATED">Estimates</option>
          <option value="DISPUTED">Disputed</option>
        </Select>
      </Field>
      {q.isLoading && <Skeleton className="h-40 w-full" />}
      {q.isError && <LoadError what="The list" error={q.error} retry={() => q.refetch()} />}
      {q.data && (q.data.items.length === 0 ? (
        <EmptyState icon={CircleCheck} title="Nothing to check" description="Reported and estimated figures appear here until someone confirms them against a receipt, a statement or a count." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHead><tr><TableHeaderCell>Record</TableHeaderCell><TableHeaderCell align="right">Amount</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell /></tr></TableHead>
            <tbody>
              {q.data.items.map((i) => (
                <TableRow key={`${i.entityType}:${i.entityId}`} data-testid="verification-row">
                  <TableCell>
                    <span className="block font-medium text-fg">{i.label}</span>
                    <span className="block text-xs text-fg-muted">{RECORD[i.entityType] ?? i.entityType}{i.date ? ` · ${formatBookDate(i.date)}` : ""}{i.source ? ` · from ${i.source}` : ""}{i.note ? ` · ${i.note}` : ""}</span>
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(i.amount)}</TableCell>
                  <TableCell><Badge variant={VERIFY[i.status].variant}>{VERIFY[i.status].label}</Badge></TableCell>
                  <TableCell align="right">{canSet && <Button size="sm" variant="outline" onClick={() => setEditing(i)}>Update</Button>}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </Card>
      ))}
      {editing && <VerifyModal item={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: ["finance", "center"] }); }} />}
    </div>
  );
}

function VerifyModal({ item, onClose, onDone }: { item: VerificationItem; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<EntryVerification>("CONFIRMED");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => booksApi.setVerification({ entityType: item.entityType, entityId: item.entityId, status, source: source.trim() || null, note: note.trim() || null }),
    onSuccess: () => { toast.success(status === "CONFIRMED" ? "Confirmed" : "Status saved"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The status couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={item.label} description={`${RECORD[item.entityType] ?? item.entityType} · ${formatPrice(item.amount)}. The record itself is not changed — only how sure it is.`} widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={status === "DISPUTED" && !note.trim()} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-verification">Save</Button></>}>
      <div className="grid gap-3">
        <Field htmlFor="vm-status" label="Status">
          <Select id="vm-status" value={status} onChange={(e) => setStatus(e.target.value as EntryVerification)}>
            <option value="CONFIRMED">Confirmed — checked against proof</option>
            <option value="ESTIMATED">Estimate</option>
            <option value="NEEDS_CHECK">To check</option>
            <option value="DISPUTED">Disputed</option>
          </Select>
        </Field>
        <Field htmlFor="vm-source" label="Checked against" hint="Supplier receipt, bank statement, physical count…"><Input id="vm-source" value={source} onChange={(e) => setSource(e.target.value)} maxLength={200} /></Field>
        <Field htmlFor="vm-note" label="Note" required={status === "DISPUTED"}><Input id="vm-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
      </div>
    </Modal>
  );
}

// ── split costs ───────────────────────────────────────────────────────────────────────────────────────────────────────

function Allocate({ canSplit }: { canSplit: boolean }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: booksApi.centerKeys.allocations(), queryFn: booksApi.listAwaitingAllocation });
  const [splitting, setSplitting] = useState<AwaitingExpense | null>(null);
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <LoadError what="Costs to split" error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        A cost that served several things (a van for supplier pickups and deliveries) is paid into <strong className="font-medium text-fg">6990 Expenses awaiting allocation</strong> from <Link href="/admin/finance/expenses" className="text-accent hover:underline">Expenses</Link>, then split here. Splitting moves it — the total never changes.
        {d.remaining > 0 && <> Not yet split: <span className="font-medium tabular-nums text-fg">{formatPrice(d.remaining)}</span>.</>}
      </p>
      {d.expenses.length === 0 ? (
        <EmptyState icon={Split} title="Nothing to split" description="Record a shared cost with the expense account 6990 Expenses awaiting allocation." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {d.expenses.map((e) => (
            <Card key={e.id} className="space-y-3 p-4 sm:p-5" data-testid="awaiting-expense">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{e.description}</p>
                  <p className="text-xs text-fg-muted">{e.number} · {formatBookDate(e.expenseDate)}{e.payee ? ` · ${e.payee}` : ""}{e.paidFrom ? ` · from ${e.paidFrom.name}` : ""}</p>
                </div>
                <Badge variant={e.status === "ALLOCATED" ? "success" : e.status === "PARTLY_ALLOCATED" ? "warning" : "neutral"}>{e.status === "ALLOCATED" ? "split" : e.status === "PARTLY_ALLOCATED" ? "partly split" : "not split"}</Badge>
              </div>
              <p className="text-sm tabular-nums text-fg">{formatPrice(e.allocated)} of {formatPrice(e.amount)} split{e.remaining > 0 ? ` · ${formatPrice(e.remaining)} left` : ""}</p>
              {e.lines.length > 0 && (
                <ul className="space-y-1 text-xs text-fg-muted">
                  {e.lines.map((l) => <li key={l.lineNo} className="flex justify-between gap-2"><span className="min-w-0">{l.account.code} {l.account.name}{l.productName ? ` · ${l.productName}` : ""}{l.note ? ` · ${l.note}` : ""}</span><span className="tabular-nums">{formatPrice(l.amount)}</span></li>)}
                </ul>
              )}
              {canSplit && e.paymentStatus === "POSTED" && <Button size="sm" variant="outline" onClick={() => setSplitting(e)} data-testid="split-expense"><Split className="h-4 w-4" /> {e.lines.length ? "Change split" : "Split"}</Button>}
              {e.paymentStatus !== "POSTED" && <p className="text-xs text-fg-muted">Its payment waits for approval.</p>}
            </Card>
          ))}
        </div>
      )}
      {splitting && <SplitModal expense={splitting} onClose={() => setSplitting(null)} onDone={() => { setSplitting(null); void queryClient.invalidateQueries({ queryKey: ["finance"] }); }} />}
    </div>
  );
}

function SplitModal({ expense, onClose, onDone }: { expense: AwaitingExpense; onClose: () => void; onDone: () => void }) {
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart });
  const accounts = useMemo(() => (chart.data?.accounts ?? []).filter((a) => a.isPostable && a.isActive && !a.restricted && (a.type === "EXPENSE" || a.type === "ASSET") && a.code !== "6990"), [chart.data]);
  const [lines, setLines] = useState(() => (expense.lines.length ? expense.lines.map((l) => ({ accountId: l.account.id, amount: String(l.amount), note: l.note ?? "" })) : [{ accountId: "", amount: "", note: "" }]));
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const over = Math.round(total * 100) > Math.round(expense.amount * 100);
  const valid = !over && lines.every((l) => l.accountId && Number(l.amount) > 0);
  const save = useMutation({
    mutationFn: () => booksApi.setAllocations(expense.id, lines.map((l) => ({ accountId: l.accountId, amount: Number(l.amount), note: l.note.trim() || null }))),
    onSuccess: (r) => { toast.success(r.remaining > 0 ? `Split saved — ${formatPrice(r.remaining)} still to split` : "Fully split"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The split couldn't be saved")),
  });
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <Modal open onClose={onClose} title={`Split ${expense.number}`} description={`${expense.description} · ${formatPrice(expense.amount)}. Split only what you know; the rest stays waiting.`} widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-split">Save split</Button></>}>
      <div className="space-y-3">
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_8rem_auto]">
            <Field htmlFor={`sl-acc-${i}`} label="Belongs to">
              <Select id={`sl-acc-${i}`} value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</Select>
            </Field>
            <Field htmlFor={`sl-amt-${i}`} label="Amount"><Input id={`sl-amt-${i}`} inputMode="decimal" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} /></Field>
            <div className="flex items-end"><Button size="sm" variant="ghost" aria-label="Remove part" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} disabled={lines.length === 1 && !expense.lines.length}><Trash2 className="h-4 w-4" /></Button></div>
            <Field htmlFor={`sl-note-${i}`} label="What for" className="sm:col-span-3"><Input id={`sl-note-${i}`} value={l.note} onChange={(e) => set(i, { note: e.target.value })} maxLength={300} placeholder="Cap pickup from the supplier" /></Field>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { accountId: "", amount: "", note: "" }])}><Plus className="h-4 w-4" /> Part</Button>
          <p className={`text-sm tabular-nums ${over ? "text-danger-600" : "text-fg-muted"}`}>{formatPrice(total)} of {formatPrice(expense.amount)}{over ? " — more than the expense" : ` · ${formatPrice(Math.max(0, expense.amount - total))} stays waiting`}</p>
        </div>
      </div>
    </Modal>
  );
}

// ── renewals ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function Renewals() {
  const q = useQuery({ queryKey: booksApi.centerKeys.renewals(), queryFn: booksApi.listRenewals });
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <LoadError what="Renewals" error={q.error} retry={() => q.refetch()} />;
  const rows = q.data!.renewals.filter((r) => r.status !== "RENEWED");
  const STATUS = { ACTIVE: { label: "active", variant: "success" }, RENEW_SOON: { label: "renew soon", variant: "warning" }, EXPIRED: { label: "ended", variant: "danger" }, RENEWED: { label: "renewed", variant: "neutral" } } as const;
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">Every <Link href="/admin/finance/prepaid" className="text-accent hover:underline">prepaid cost</Link> with an end date — domain, VPS, yearly software. Paying the next period with the same name marks it renewed.</p>
      {rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No subscriptions yet" description="Add the domain and the VPS as prepaid costs with the dates they cover." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHead><tr><TableHeaderCell>Subscription</TableHeaderCell><TableHeaderCell>Ends</TableHeaderCell><TableHeaderCell align="right">Next payment</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></tr></TableHead>
            <tbody>
              {rows.map((r) => (
                <TableRow key={r.id} data-testid="renewal-row">
                  <TableCell><span className="block font-medium text-fg">{r.name}</span><span className="block text-xs text-fg-muted">{r.account.name}{r.payee ? ` · ${r.payee}` : ""} · paid {formatPrice(r.amount)}{r.verification !== "CONFIRMED" ? ` · ${VERIFY[r.verification].label}` : ""}</span></TableCell>
                  <TableCell className="whitespace-nowrap">{formatBookDate(r.serviceEnd)}<span className="block text-xs text-fg-muted">{r.daysToEnd >= 0 ? `in ${r.daysToEnd} days` : `${-r.daysToEnd} days ago`} · reminder {formatBookDate(r.remindOn)}</span></TableCell>
                  <TableCell align="right" className="tabular-nums">{r.renewalAmount === null ? "—" : formatPrice(r.renewalAmount)}</TableCell>
                  <TableCell><Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge></TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ── SMS ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

function Sms({ canRecord }: { canRecord: boolean }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: booksApi.centerKeys.sms(), queryFn: booksApi.getSmsStatus });
  const [reading, setReading] = useState(false);
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <LoadError what="SMS" error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="SMS">
        <StatTile label="Balance" value={d.balance === null ? "Not read yet" : formatPrice(d.balance)} icon={<MessageSquareText />} tone={d.isLow ? "warning" : "accent"} />
        <StatTile label="Used a day (30 days)" value={d.usedPerDay === null ? "—" : formatPrice(d.usedPerDay)} icon={<MessageSquareText />} />
        <StatTile label="Runs out about" value={d.runsOutOn ? formatBookDate(d.runsOutOn) : "—"} icon={<CalendarClock />} tone={d.daysLeft !== null && d.daysLeft < 14 ? "warning" : "default"} />
        <StatTile label="Recharged (all time)" value={formatPrice(d.recharges.reduce((s, r) => s + r.amount, 0))} icon={<Wallet />} href="/admin/finance/expenses" />
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">
          {d.readAt ? `Read ${new Date(d.readAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} (${d.readSource === "PROVIDER" ? "from the SMS provider" : "typed in"}).` : "No reading yet."}
          {!d.provider.read && d.provider.reason ? ` ${d.provider.reason} — type the balance in from the provider's panel.` : ""}
        </p>
        {canRecord && <Button size="sm" variant="outline" onClick={() => setReading(true)} data-testid="record-sms-balance">Enter balance</Button>}
      </div>
      <p className="text-xs text-fg-muted">A recharge is an expense to <strong className="font-medium">6410 SMS</strong> (record it in <Link href="/admin/finance/expenses" className="text-accent hover:underline">Expenses</Link>) — that is the cost in the books. Usage below is worked out from the balance readings and is information only, so nothing is counted twice.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-fg sm:px-5">Used by month</h2>
          {d.monthlyUsage.length === 0 ? <p className="px-4 py-4 text-sm text-fg-muted sm:px-5">Two readings are needed to see usage.</p> : (
            <ul className="divide-y divide-line">{d.monthlyUsage.map((m) => <li key={m.month} className="flex justify-between px-4 py-2 text-sm sm:px-5"><span>{m.month}</span><span className="tabular-nums">{formatPrice(m.used)}</span></li>)}</ul>
          )}
        </Card>
        <Card className="p-0">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-fg sm:px-5">Recharges</h2>
          {d.recharges.length === 0 ? <p className="px-4 py-4 text-sm text-fg-muted sm:px-5">None recorded to 6410 SMS yet.</p> : (
            <ul className="divide-y divide-line">{d.recharges.map((r) => <li key={r.id} className="flex justify-between gap-2 px-4 py-2 text-sm sm:px-5"><span className="min-w-0 truncate">{formatBookDate(r.date)} · {r.description}</span><span className="tabular-nums">{formatPrice(r.amount)}</span></li>)}</ul>
          )}
        </Card>
      </div>
      {reading && <SmsBalanceModal onClose={() => setReading(false)} onDone={() => { setReading(false); void queryClient.invalidateQueries({ queryKey: ["finance"] }); }} />}
    </div>
  );
}

function SmsBalanceModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [balance, setBalance] = useState("");
  const save = useMutation({
    mutationFn: () => booksApi.recordSmsBalance({ balance: Number(balance) }),
    onSuccess: () => { toast.success("Balance saved"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The balance couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title="SMS balance now" description="As the SMS provider's panel shows it." widthClassName="max-w-sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={balance === "" || !(Number(balance) >= 0)} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-sms-balance">Save</Button></>}>
      <Field htmlFor="sms-bal" label="Balance (taka)" required><Input id="sms-bal" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

// ── autopilot ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const SKIPPED: Record<string, string> = {
  OFF: "Off",
  LIVE_PROVIDERS_OFF: "Not on this copy (live connections are off)",
  META_NOT_CONNECTED: "Meta isn't connected",
  BOOKS_NOT_STARTED: "Waits until the books are started",
  NO_ASSETS: "No assets yet",
};

function stepLine(step: booksApi.AutopilotStep, done: (s: booksApi.AutopilotStep) => string) {
  if (step.skipped) return { tone: "muted" as const, text: SKIPPED[step.skipped] ?? step.skipped };
  if (!step.ok) return { tone: "danger" as const, text: step.error ?? "Failed" };
  return { tone: "ok" as const, text: done(step) };
}

/** Owner's books §15: payouts in, the owner's drawings, Meta's spend and partners' shares — twice a day, by itself. */
function Autopilot({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: booksApi.centerKeys.autopilot(), queryFn: booksApi.getAutopilot });
  const accounts = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts });
  const payInto = (accounts.data?.financialAccounts ?? []).filter((a) => ["BANK", "MOBILE_WALLET", "CASH"].includes(a.kind) && a.isActive);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finance"] });
  const update = useMutation({
    mutationFn: booksApi.updateAutopilot,
    onSuccess: () => { toast.success("Autopilot saved"); refresh(); },
    onError: (e) => toast.error(getErrorMessage(e, "Autopilot couldn't be saved")),
  });
  const run = useMutation({
    mutationFn: booksApi.runAutopilot,
    onSuccess: () => { toast.success("Autopilot ran"); refresh(); },
    onError: (e) => toast.error(getErrorMessage(e, "Autopilot couldn't run")),
  });
  if (q.isLoading) return <Skeleton className="h-48 w-full max-w-xl" />;
  if (q.isError) return <LoadError what="Autopilot" error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const busy = update.isPending || !canEdit;
  const last = d.lastRun;
  const lines = last
    ? [
        { label: "Steadfast payouts", ...stepLine(last.payouts, (s) => `${s.imported ?? 0} new, ${s.posted?.length ?? 0} posted${s.waiting?.length ? ` · ${s.waiting.length} waiting for a look` : ""}`) },
        { label: "Owner's withdrawals", ...stepLine(last.ownerDrawings, (s) => (s.taken ? `${s.taken} payout(s), ${formatPrice(s.amount ?? 0)}` : "Nothing new")) },
        { label: "Meta ad spend", ...stepLine(last.adSpend, (s) => `${s.days ?? 0} campaign-day(s) read`) },
        ...(last.depreciation ? [{ label: "Depreciation", ...stepLine(last.depreciation, (s) => (s.months?.length ? s.months.join(", ") : "Nothing new")) }] : []),
        { label: "Partners' shares", ...stepLine(last.profitShares, (s) => (s.shared?.length ? s.shared.map((x) => `${x.partner} ${x.period}: ${formatPrice(x.amount)}`).join(" · ") : "Nothing new")) },
      ]
    : [];
  return (
    <Card className="max-w-xl space-y-5 p-4 sm:p-5" data-testid="autopilot">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-fg">Autopilot</h2>
        <p className="text-sm text-fg-muted">Runs by itself every morning and evening (6:00 and 18:00). Everything it books shows up like any other entry and can be reversed.</p>
      </div>
      <div className="divide-y divide-line-subtle">
        <div className="space-y-2 pb-4">
          <Field htmlFor="ap-account" label="Bring in Steadfast payouts" hint="Posted when every parcel is matched to its order or was booked straight on Steadfast. Anything else waits in Steadfast check.">
            <Select id="ap-account" value={d.payoutAccount?.id ?? ""} disabled={busy} onChange={(e) => update.mutate({ payoutAccountId: e.target.value || null })}>
              <option value="">Off</option>
              {payInto.map((a) => <option key={a.id} value={a.id}>Paid into {a.name}</option>)}
            </Select>
          </Field>
        </div>
        <label className="flex items-start justify-between gap-4 py-4">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium text-fg">The owner keeps the payouts</span>
            <span className="block text-xs text-fg-muted">Each payout into that account is booked as the owner&apos;s withdrawal, on the payout&apos;s own day.</span>
          </span>
          <Switch checked={d.payoutsToOwner} disabled={busy || !d.payoutAccount} onChange={(v) => update.mutate({ payoutsToOwner: v })} aria-label="The owner keeps the payouts" />
        </label>
        <label className="flex items-start justify-between gap-4 py-4">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium text-fg">Share each month&apos;s profit with partners</span>
            <span className="block text-xs text-fg-muted">When a month ends, each partner&apos;s share is booked as owed to them. Pay it from Owner &amp; partners.</span>
          </span>
          <Switch checked={d.profitShares} disabled={busy} onChange={(v) => update.mutate({ profitShares: v })} aria-label="Share each month's profit with partners" />
        </label>
        <div className="flex items-start justify-between gap-4 pt-4">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium text-fg">Meta ad spend</span>
            <span className="block text-xs text-fg-muted">{d.metaConnected ? "Read every run for the last 7 days." : "Connect Meta in Settings › Integrations, or add the spend by hand in Ad spend."}</span>
          </span>
          <Badge variant={d.metaConnected ? "success" : "neutral"}>{d.metaConnected ? "Connected" : "Not connected"}</Badge>
        </div>
      </div>
      <div className="space-y-3 rounded-lg bg-surface-muted p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-fg">{last ? `Last run ${new Date(last.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : "Hasn't run yet"}</p>
          {canEdit && <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate()} data-testid="run-autopilot">Run now</Button>}
        </div>
        {lines.length > 0 && (
          <dl className="space-y-1.5 text-sm">
            {lines.map((l) => (
              <div key={l.label} className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                <dt className="text-fg-muted">{l.label}</dt>
                <dd className={l.tone === "danger" ? "text-danger" : l.tone === "muted" ? "text-fg-muted" : "text-fg"}>{l.text}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </Card>
  );
}

// ── settings ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function Settings({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: booksApi.centerKeys.settings(), queryFn: booksApi.getCenterSettings });
  const [rate, setRate] = useState<string | null>(null);
  const [low, setLow] = useState<string | null>(null);
  const [outside, setOutside] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => booksApi.updateCenterSettings({
      ...(rate !== null ? { defaultUsdRate: rate === "" ? null : Number(rate) } : {}),
      ...(low !== null ? { smsLowBalance: low === "" ? null : Number(low) } : {}),
      ...(outside !== null ? { outsideSaleCostPct: outside === "" ? null : Number(outside) } : {}),
    }),
    onSuccess: () => { toast.success("Settings saved"); setRate(null); setLow(null); setOutside(null); void queryClient.invalidateQueries({ queryKey: ["finance"] }); },
    onError: (e) => toast.error(getErrorMessage(e, "Settings couldn't be saved")),
  });
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <LoadError what="Settings" error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const rateValue = rate ?? (d.defaultUsdRate === null ? "" : String(d.defaultUsdRate));
  const lowValue = low ?? (d.smsLowBalance === null ? "" : String(d.smsLowBalance));
  const outsideValue = outside ?? (d.outsideSaleCostPct === null ? "" : String(d.outsideSaleCostPct));
  const outsideValid = outsideValue === "" || (Number(outsideValue) >= 0 && Number(outsideValue) <= 100);
  const valid = (rateValue === "" || Number(rateValue) > 0) && (lowValue === "" || Number(lowValue) >= 0) && outsideValid;
  return (
    <Card className="max-w-xl space-y-4 p-4 sm:p-5">
      <Field htmlFor="set-rate" label="Default taka per USD" hint="Used when a USD cost has no rate of its own — such figures are marked estimates until the card's rate is entered.">
        <Input id="set-rate" inputMode="decimal" value={rateValue} onChange={(e) => setRate(e.target.value)} disabled={!canEdit} placeholder="122" />
      </Field>
      <Field htmlFor="set-low" label="Warn when the SMS balance is at or below (taka)">
        <Input id="set-low" inputMode="decimal" value={lowValue} onChange={(e) => setLow(e.target.value)} disabled={!canEdit} placeholder="300" />
      </Field>
      <Field
        htmlFor="set-outside"
        label="Cost of goods for sales outside the website (% of cash collected)"
        hint="Parcels booked straight on the courier's panel have no order, so their goods have no recorded cost. Each payout books this share of their cash as an estimated cost. Leave empty to book none."
        error={outsideValid ? undefined : "Enter a percent from 0 to 100"}
      >
        <Input id="set-outside" inputMode="decimal" value={outsideValue} onChange={(e) => setOutside(e.target.value)} disabled={!canEdit} placeholder="45" />
      </Field>
      {canEdit && <Button disabled={!valid || (rate === null && low === null && outside === null)} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-center-settings">Save</Button>}
    </Card>
  );
}
