"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Crown, Handshake, Plus, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { Partner, PartnerActivityItem, PartnerRole, PartnerShares, PaymentMethod } from "@/lib/api/finance";
import { formatBookDate, formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";

const today = () => new Date().toLocaleDateString("en-CA");
const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" }, { value: "BKASH", label: "bKash" }, { value: "NAGAD", label: "Nagad" }, { value: "BANK", label: "Bank" }, { value: "OTHER", label: "Other" },
];
const ROLE_LABEL: Record<PartnerRole, string> = { OWNER: "Owner", WORKING: "Working partner", INVESTOR: "Investor partner" };
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const KIND_LABEL: Record<PartnerActivityItem["kind"], string> = { PUT_IN: "Put in", CAPITAL_BACK: "Capital returned", PROFIT_SHARE: "Profit share", CREDITED: "Credited", TAKEN_OUT: "Taken out", PAID: "Paid" };
const firstName = (name: string) => name.split(" ")[0] ?? name;
/** A partner role, not the admin's role: the owner keeps what is left, everyone else shares. */
const isOwnerRole = (r: PartnerRole) => r === "OWNER";

/** The owner and the partners (docs/FINANCE_EQUITY.md): what the owner put in and took out, and each working partner's
 * monthly share of the profit — earned, paid and owed — with every movement in date order. Owner-only. */
export default function EquityPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("finance.sensitive");
  const overview = useQuery({ queryKey: financeApi.equityKeys.overview(), queryFn: () => financeApi.getEquity(), enabled: allowed });
  const shares = useQuery({ queryKey: financeApi.partnerKeys.shares(), queryFn: financeApi.getProfitShares, enabled: allowed });
  const [editing, setEditing] = useState<Partner | "new" | "owner" | null>(null);
  const [showEquity, setShowEquity] = useState(false);
  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Handshake} title="Owner & partners aren't available to your role" description="What the owner and partners put in, take out and earn is visible only to the owner." />
      </div>
    );
  }
  const d = overview.data;
  const owner = d?.partners.find((p) => isOwnerRole(p.role)) ?? null;
  const others = d?.partners.filter((p) => !isOwnerRole(p.role)) ?? [];
  const shareOf = (id: string) => shares.data?.partners.find((s) => s.partnerId === id) ?? null;

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Owner & partners"
        description="What the owner has put in and taken out, and each partner's share of the profit — earned, paid and still owed."
        action={can("finance.configure") && d && <Button size="sm" variant="outline" onClick={() => setEditing("new")} data-testid="new-partner"><Plus className="h-4 w-4" /> Add partner</Button>}
      />
      {(overview.isLoading || shares.isLoading) && <div className="space-y-3"><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></div>}
      {overview.isError && <Alert variant="danger" title="Couldn't load the owner and partners" action={<Button size="sm" variant="outline" onClick={() => overview.refetch()}>Retry</Button>}>{getErrorMessage(overview.error, "")}</Alert>}
      {shares.data && !shares.data.booksStarted && (
        <Alert variant="warning" title="The books haven't started">Profit — and so each partner&apos;s share — is known only from the books&apos; opening date. Set it in <Link href="/admin/finance/opening" className="font-medium underline underline-offset-2">Start the books</Link>.</Alert>
      )}
      {d && (
        <>
          {owner ? <OwnerSection owner={owner} canAct={can("finance.transact")} onEdit={() => setEditing(owner)} /> : (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold tracking-tight text-fg">Who owns the business?</h2>
                <p className="text-sm text-fg-muted">Add the owner to see everything they have put in and taken out, in one place.</p>
              </div>
              {can("finance.configure") && <Button size="sm" onClick={() => setEditing("owner")} data-testid="add-owner"><Crown className="h-4 w-4" /> Add the owner</Button>}
            </Card>
          )}

          {others.map((p) => <PartnerSection key={p.id} partner={p} shares={shareOf(p.id)} canAct={can("finance.transact")} onEdit={() => setEditing(p)} />)}
          {others.length === 0 && owner && (
            <p className="text-sm text-fg-muted">No partners yet. A working partner who shares the profit is added with <span className="font-medium text-fg">Add partner</span>.</p>
          )}

          <Card className="p-0">
            <button type="button" onClick={() => setShowEquity((v) => !v)} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left" aria-expanded={showEquity}>
              <span><span className="block text-[15px] font-semibold text-fg">Equity on the balance sheet</span><span className="text-sm text-fg-muted">{formatPrice(d.equity.total)} as of {formatBookDate(d.asOf)}</span></span>
              <ChevronDown className={cn("h-4 w-4 text-fg-muted transition-transform", showEquity && "rotate-180")} />
            </button>
            {showEquity && (
              <div className="divide-y divide-line-subtle border-t border-line-subtle text-sm">
                {d.equity.lines.map((l, i) => (
                  <div key={l.accountId ?? `line-${i}`} className="flex justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0 text-fg-muted"><span className="font-mono text-xs text-fg-subtle">{l.code}</span> {l.name}</span>
                    <span className="shrink-0 tabular-nums text-fg">{l.amount === null ? "restricted" : formatPrice(l.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
      {editing && <PartnerModal partner={editing === "new" || editing === "owner" ? null : editing} asOwner={editing === "owner"} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ── the owner ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function OwnerSection({ owner, canAct, onEdit }: { owner: Partner; canAct: boolean; onEdit: () => void }) {
  const activity = useQuery({ queryKey: financeApi.partnerKeys.activity(owner.id), queryFn: () => financeApi.getPartnerActivity(owner.id) });
  const payouts = useQuery({ queryKey: financeApi.partnerKeys.payouts(), queryFn: financeApi.getOwnerPayouts });
  const [money, setMoney] = useState<"INVEST" | "WITHDRAW" | null>(null);
  const qc = useQueryClient();
  const open = (payouts.data?.payouts ?? []).filter((p) => !p.taken);
  const take = useMutation({
    mutationFn: (ids: string[]) => financeApi.markPayoutsTaken(ids),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(`${r.taken.length} payout${r.taken.length === 1 ? "" : "s"} recorded as taken by ${owner.name}`); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't record the payouts")),
  });
  const t = activity.data?.totals;
  return (
    <Card className="overflow-hidden p-0" data-testid="owner-card">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"><Crown className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-[17px] font-semibold tracking-tight text-fg">{owner.name}</p>
              <p className="text-sm text-fg-muted">Owner since {formatBookDate(owner.joinedOn)}{owner.phone ? ` · ${owner.phone}` : ""}{owner.email ? ` · ${owner.email}` : ""}</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
        </div>
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          <Figure label="Put in" value={t?.putIn} tone="in" loading={activity.isLoading} hint="Money and costs paid from his own pocket" />
          <Figure label="Taken out" value={t?.takenOut} loading={activity.isLoading} hint="Payouts kept and money withdrawn" />
          <Figure label="Net invested" value={t ? t.net : undefined} loading={activity.isLoading} strong hint="Put in − taken out" />
        </dl>
        {canAct && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setMoney("INVEST")} data-testid="owner-invest"><ArrowDownLeft className="h-4 w-4" /> Money put in</Button>
            <Button size="sm" variant="outline" onClick={() => setMoney("WITHDRAW")} data-testid="owner-withdraw"><ArrowUpRight className="h-4 w-4" /> Money taken out</Button>
          </div>
        )}
      </div>

      {open.length > 0 && (
        <div className="space-y-3 border-t border-line-subtle bg-surface-muted px-5 py-4 sm:px-6" data-testid="owner-payouts">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-fg">Payouts not yet marked as taken</p>
              <p className="text-sm text-fg-muted">Steadfast and EPS money that went to {firstName(owner.name)}. Each becomes a withdrawal on the payout&apos;s date.</p>
            </div>
            {canAct && <Button size="sm" variant="outline" loading={take.isPending} onClick={() => take.mutate(open.map((p) => p.id))}>All taken by {firstName(owner.name)}</Button>}
          </div>
          <ul className="divide-y divide-line-subtle text-sm">
            {open.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0"><span className="font-medium text-fg">{p.reference.replace(/^steadfast:/, "Steadfast ")}</span><span className="block text-xs text-fg-muted">{formatBookDate(p.date)} · paid into {p.paidInto.name}</span></span>
                <span className="flex shrink-0 items-center gap-2"><span className="tabular-nums">{formatPrice(p.amount)}</span>{canAct && <Button size="sm" variant="ghost" onClick={() => take.mutate([p.id])}>Taken</Button>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Timeline items={activity.data?.items ?? []} loading={activity.isLoading} empty="Nothing put in or taken out yet." />
      {money && <OwnerMoneyModal kind={money} ownerName={owner.name} onClose={() => setMoney(null)} />}
    </Card>
  );
}

function Figure({ label, value, tone, strong, loading, hint }: { label: string; value: number | undefined; tone?: "in"; strong?: boolean; loading?: boolean; hint?: string }) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-line-subtle p-3 sm:p-4", strong && "bg-surface-muted")}>
      <dt className="text-xs font-medium text-fg-muted sm:text-[13px]">{label}</dt>
      <dd className={cn("mt-1 truncate text-[16px] font-semibold tabular-nums tracking-tight sm:text-[22px]", tone === "in" ? "text-success-700" : "text-fg")}>
        {loading || value === undefined ? <Skeleton className="h-7 w-28" /> : `${value < 0 ? "−" : ""}${formatPrice(Math.abs(value))}`}
      </dd>
      {hint && <dd className="mt-0.5 hidden text-xs text-fg-subtle sm:block">{hint}</dd>}
    </div>
  );
}

function Timeline({ items, loading, empty }: { items: PartnerActivityItem[]; loading: boolean; empty: string }) {
  const [all, setAll] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, PartnerActivityItem[]>();
    for (const i of all ? items : items.slice(0, 12)) m.set(i.date.slice(0, 7), [...(m.get(i.date.slice(0, 7)) ?? []), i]);
    return [...m.entries()];
  }, [items, all]);
  return (
    <div className="border-t border-line-subtle px-5 py-4 sm:px-6">
      <p className="mb-2 text-[15px] font-semibold text-fg">History</p>
      {loading ? <Skeleton className="h-24 w-full" /> : items.length === 0 ? <p className="text-sm text-fg-muted">{empty}</p> : (
        <div className="space-y-4">
          {groups.map(([ym, rows]) => (
            <div key={ym}>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{monthLabel(ym)}</p>
              <ul className="divide-y divide-line-subtle">
                {rows.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    <span className="flex min-w-0 items-start gap-2.5">
                      <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", i.amount >= 0 ? "bg-success-50 text-success-700" : "bg-surface-muted text-fg-muted")}>
                        {i.amount >= 0 ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0"><span className="block text-fg">{i.description}</span><span className="text-xs text-fg-muted">{formatBookDate(i.date)} · {KIND_LABEL[i.kind]}</span></span>
                    </span>
                    <span className={cn("shrink-0 tabular-nums font-medium", i.amount >= 0 ? "text-success-700" : "text-fg")}>{i.amount >= 0 ? "+" : "−"}{formatPrice(Math.abs(i.amount))}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {items.length > 12 && <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? "Show less" : `Show all ${items.length}`}</Button>}
        </div>
      )}
    </div>
  );
}

// ── a working partner ─────────────────────────────────────────────────────────────────────────────────────────────────

function PartnerSection({ partner, shares, canAct, onEdit }: { partner: Partner; shares: PartnerShares | null; canAct: boolean; onEdit: () => void }) {
  const activity = useQuery({ queryKey: financeApi.partnerKeys.activity(partner.id), queryFn: () => financeApi.getPartnerActivity(partner.id) });
  const qc = useQueryClient();
  const [paying, setPaying] = useState(false);
  const run = useMutation({
    mutationFn: () => financeApi.runProfitShares(),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(r.shared.length ? `Shared ${r.shared.length} month${r.shared.length === 1 ? "" : "s"}` : "Nothing to share yet"); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't share the profit")),
  });
  const s = shares;
  const name = firstName(partner.name);
  return (
    <Card className="overflow-hidden p-0" data-testid="partner-card">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-muted"><Handshake className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-[17px] font-semibold tracking-tight text-fg">{partner.name}</p>
              <p className="text-sm text-fg-muted">{ROLE_LABEL[partner.role]} since {formatBookDate(partner.joinedOn)}{partner.phone ? ` · ${partner.phone}` : ""}{partner.email ? ` · ${partner.email}` : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {partner.profitSharePct !== null && <Badge variant={partner.shareConfirmed ? "success" : "warning"}>{partner.profitSharePct}% of monthly profit</Badge>}
            <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
          </div>
        </div>
        {partner.profitSharePct !== null && (
          <p className="text-sm text-fg-muted">Shares {partner.profitSharePct}% of each month&apos;s net profit, from {formatBookDate(partner.shareFrom ?? partner.joinedOn)}. A loss month shares nothing and the next month&apos;s whole profit is shared — {name} puts in no capital and bears no loss.</p>
        )}
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          <Figure label="Owed now" value={s?.totals.owed} strong loading={!s} hint={s && s.totals.owed > 0 ? "Pay at the month's end" : "Nothing waiting"} />
          <Figure label="Earned so far" value={s?.totals.earned} tone="in" loading={!s} />
          <Figure label="Paid so far" value={s?.totals.paid} loading={!s} />
        </dl>
        {s?.runningMonth && (
          <div className="flex items-start gap-3 rounded-xl bg-surface-muted p-4 text-sm">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p className="text-fg-muted">
              <span className="font-medium text-fg">{monthLabel(s.runningMonth.period)} so far:</span> profit {s.runningMonth.profitSoFar < 0 ? `−${formatPrice(-s.runningMonth.profitSoFar)}` : formatPrice(s.runningMonth.profitSoFar)} → {name}&apos;s share{" "}
              <span className="font-medium tabular-nums text-fg">{formatPrice(s.runningMonth.shareSoFar)}</span>. It is fixed when the month ends.
            </p>
          </div>
        )}
        {canAct && (
          <div className="flex flex-wrap gap-2">
            {s && s.waitingMonths.length > 0 && (
              <Button size="sm" loading={run.isPending} onClick={() => run.mutate()} data-testid="run-shares">Share {s.waitingMonths.length === 1 ? monthLabel(s.waitingMonths[0]!) : `${s.waitingMonths.length} finished months`}</Button>
            )}
            <Button size="sm" variant={s && s.waitingMonths.length ? "outline" : "primary"} disabled={!s || s.totals.owed <= 0} onClick={() => setPaying(true)} data-testid="pay-partner">Pay {name}</Button>
          </div>
        )}
      </div>

      {s && s.shares.length > 0 && (
        <div className="border-t border-line-subtle px-5 py-4 sm:px-6">
          <p className="mb-2 text-[15px] font-semibold text-fg">Month by month</p>
          <ul className="divide-y divide-line-subtle text-sm" data-testid="profit-share-months">
            {s.shares.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block font-medium text-fg">{monthLabel(m.period)}</span>
                  <span className="text-xs text-fg-muted">
                    {m.netProfit < 0 ? `Loss ${formatPrice(-m.netProfit)} — nothing shared` : `Profit ${formatPrice(m.netProfit)} × ${m.sharePct}% = ${formatPrice(m.monthShare)}`}
                    {m.corrections.map((c) => ` · ${c.kind === "CARRIED" ? "carried" : `${monthLabel(c.period)} changed`} ${c.amount >= 0 ? "+" : "−"}${formatPrice(Math.abs(c.amount))}`).join("")}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums text-fg">{formatPrice(m.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Timeline items={activity.data?.items ?? []} loading={activity.isLoading} empty="No shares or payments yet." />
      {paying && s && <PayModal partner={partner} owed={s.totals.owed} onClose={() => setPaying(false)} />}
    </Card>
  );
}

// ── modals ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function useMoneyAccounts() {
  const q = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts });
  return (q.data?.financialAccounts ?? []).filter((a) => a.isActive && ["CASH", "BANK", "MOBILE_WALLET"].includes(a.kind));
}

function PayModal({ partner, owed, onClose }: { partner: Partner; owed: number; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useMoneyAccounts();
  const [amount, setAmount] = useState(String(owed));
  const [from, setFrom] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("BKASH");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const n = Number(amount);
  const body = { fromFinancialAccountId: from, amount: n, paymentDate: date, method, note: note.trim() || null };
  const valid = Boolean(from) && n > 0 && n <= owed && Boolean(date) && date <= today();
  const save = useMutation({
    mutationFn: () => financeApi.payPartner(partner.id, body, idempotencyKeyFor(`partner-pay-${partner.id}`, body)),
    onSuccess: (r) => { settleIdempotencyKey(`partner-pay-${partner.id}`); void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(r.movement.status === "POSTED" ? `Paid ${formatPrice(n)} to ${partner.name}` : "Payment waits for approval"); onClose(); },
    onError: (e) => toast.error(getErrorMessage(e, "The payment couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={`Pay ${partner.name}`} description={`Owed now: ${formatPrice(owed)}.`} widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-pay">Pay {n > 0 ? formatPrice(n) : ""}</Button></>}>
      <div className="space-y-4">
        <Field htmlFor="pp-amount" label="Amount" required error={n > owed ? `At most ${formatPrice(owed)}` : undefined}><Input id="pp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <div className="space-y-1.5"><p className="text-sm font-medium text-fg">How</p><SegmentedControl aria-label="Payment method" value={method} onChange={setMethod} options={METHODS} /></div>
        <Field htmlFor="pp-from" label="Paid from" required>
          <Select id="pp-from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </Field>
        <Field htmlFor="pp-date" label="Paid on" required><Input id="pp-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="pp-note" label="Note" hint="Transaction ID, who handed it over…"><Input id="pp-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      </div>
    </Modal>
  );
}

function OwnerMoneyModal({ kind, ownerName, onClose }: { kind: "INVEST" | "WITHDRAW"; ownerName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useMoneyAccounts();
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("BKASH");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const n = Number(amount);
  const body = { kind, financialAccountId: account, amount: n, date, method, note: note.trim() || null };
  const valid = Boolean(account) && n > 0 && Boolean(date) && date <= today();
  const save = useMutation({
    mutationFn: () => financeApi.ownerMoney(body, idempotencyKeyFor(`owner-money-${kind}`, body)),
    onSuccess: (r) => { settleIdempotencyKey(`owner-money-${kind}`); void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(r.movement.status === "POSTED" ? "Saved" : "Saved — waits for approval"); onClose(); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't save")),
  });
  const into = kind === "INVEST";
  return (
    <Modal open onClose={onClose} title={into ? `Money put in by ${ownerName}` : `Money taken out by ${ownerName}`}
      description={into ? "Cash given to the business. A cost paid from his own pocket is recorded in Expenses as “paid by the owner”." : "Money taken from the business for himself."} widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-owner-money">Save</Button></>}>
      <div className="space-y-4">
        <Field htmlFor="om-amount" label="Amount" required><Input id="om-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <div className="space-y-1.5"><p className="text-sm font-medium text-fg">How</p><SegmentedControl aria-label="Method" value={method} onChange={setMethod} options={METHODS} /></div>
        <Field htmlFor="om-acc" label={into ? "Into" : "From"} required>
          <Select id="om-acc" value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </Field>
        <Field htmlFor="om-date" label="Date" required><Input id="om-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="om-note" label="Note"><Input id="om-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      </div>
    </Modal>
  );
}

function PartnerModal({ partner, asOwner, onClose }: { partner: Partner | null; asOwner: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: partner?.name ?? "", phone: partner?.phone ?? "", email: partner?.email ?? "", joinedOn: partner?.joinedOn ?? "", leftOn: partner?.leftOn ?? "",
    role: (partner?.role ?? (asOwner ? "OWNER" : "WORKING")) as PartnerRole,
    profitSharePct: partner?.profitSharePct == null ? "" : String(partner.profitSharePct), shareFrom: partner?.shareFrom ?? "", notes: partner?.notes ?? "",
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const pct = form.profitSharePct === "" ? null : Number(form.profitSharePct);
  const sharing = !isOwnerRole(form.role);
  const valid = form.name.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(form.joinedOn) && (!form.leftOn || form.leftOn >= form.joinedOn) && (pct === null || (pct > 0 && pct <= 100));
  const save = useMutation({
    mutationFn: () => financeApi.savePartner(partner?.id ?? null, {
      name: form.name.trim(), phone: form.phone || null, email: form.email || null, joinedOn: form.joinedOn, leftOn: form.leftOn || null, notes: form.notes || null,
      ...(partner ? {} : { role: form.role }),
      ...(sharing ? { profitSharePct: pct, shareFrom: form.shareFrom || form.joinedOn, lossRule: "ZERO_IN_LOSS_MONTHS", shareConfirmedNote: pct ? `Confirmed by the owner in the admin, ${today()}` : null } : {}),
    }),
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(partner ? `${p.name} saved` : `${p.name} added`); onClose(); },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't save")),
  });
  return (
    <Modal open onClose={onClose} title={partner ? `Edit ${partner.name}` : isOwnerRole(form.role) ? "Add the owner" : "Add partner"} widthClassName="max-w-lg"
      description={isOwnerRole(form.role) ? "The owner keeps what is left after the partners' shares. What he puts in and takes out is listed on his card." : "A working partner shares the monthly profit for their work and puts in no capital."}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="save-partner">Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {!partner && !asOwner && (
          <Field htmlFor="pt-role" label="Who" className="sm:col-span-2">
            <Select id="pt-role" value={form.role} onChange={set("role")}><option value="WORKING">Working partner — shares profit, no capital</option><option value="INVESTOR">Investor partner — puts in capital</option></Select>
          </Field>
        )}
        <Field htmlFor="pt-name" label="Name" required className="sm:col-span-2"><Input id="pt-name" value={form.name} onChange={set("name")} maxLength={120} /></Field>
        <Field htmlFor="pt-phone" label="Phone"><Input id="pt-phone" value={form.phone} onChange={set("phone")} maxLength={30} inputMode="tel" /></Field>
        <Field htmlFor="pt-email" label="Email"><Input id="pt-email" type="email" value={form.email} onChange={set("email")} maxLength={160} /></Field>
        <Field htmlFor="pt-joined" label={isOwnerRole(form.role) ? "Owner since" : "Partner since"} required><Input id="pt-joined" type="date" value={form.joinedOn} onChange={set("joinedOn")} /></Field>
        <Field htmlFor="pt-left" label="Left on"><Input id="pt-left" type="date" value={form.leftOn} onChange={set("leftOn")} /></Field>
        {sharing && (
          <>
            <Field htmlFor="pt-pct" label="Share of monthly profit (%)" hint="Nothing in a loss month"><Input id="pt-pct" inputMode="decimal" value={form.profitSharePct} onChange={set("profitSharePct")} placeholder="20" /></Field>
            <Field htmlFor="pt-from" label="Shares from" hint="Default: partner since"><Input id="pt-from" type="date" value={form.shareFrom} onChange={set("shareFrom")} /></Field>
          </>
        )}
        <Field htmlFor="pt-notes" label="Notes" className="sm:col-span-2"><Textarea id="pt-notes" value={form.notes} onChange={set("notes")} rows={2} maxLength={1000} /></Field>
      </div>
    </Modal>
  );
}
