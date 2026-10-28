"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { Corrections, MonthlySharing, StatementModal } from "@/components/admin/finance/partner-sharing";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { Partner, PartnerActivityItem, PartnerRole, PartnerShares, PaymentMethod } from "@/lib/api/finance";
import { formatBookDate, formatPrice } from "@/lib/format";
import { idempotencyKeyFor, partnerPaymentScope, settleIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { PermissionState } from "@/components/admin/permission-state";

const today = () => new Date().toLocaleDateString("en-CA");
const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" }, { value: "BKASH", label: "bKash" }, { value: "NAGAD", label: "Nagad" }, { value: "BANK", label: "Bank" }, { value: "OTHER", label: "Other" },
];
const ROLE_LABEL: Record<PartnerRole, string> = { OWNER: "Owner", WORKING: "Working partner", INVESTOR: "Investor partner" };
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const KIND_LABEL: Record<PartnerActivityItem["kind"], string> = {
  PUT_IN: "Put in", PUT_IN_REVERSED: "Put in, reversed", CAPITAL_BACK: "Capital returned", CAPITAL_BACK_REVERSED: "Capital return reversed",
  PROFIT_SHARE: "Profit share", SHARE_REVERSED: "Profit share reversed", SHARE_CORRECTED: "Profit share correction", CREDITED: "Credited", TAKEN_OUT: "Taken out", PAID: "Paid",
  PAYMENT_REVERSED: "Payment reversed", RECEIVED: "Received from partner", RECEIVED_REVERSED: "Receipt reversed", OTHER: "Other entry",
};
const firstName = (name: string) => name.split(" ")[0] ?? name;
/** A partner role, not the admin's role: the owner keeps what is left, everyone else shares. */
const isOwnerRole = (r: PartnerRole) => r === "OWNER";
const isWorkingRole = (r: PartnerRole) => r === "WORKING";
const isInvestorRole = (r: PartnerRole) => r === "INVESTOR";

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
        <PermissionState icon={Handshake} page="Owner & partners" />
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
      {shares.isError && <Alert variant="danger" title="Couldn't load what each partner is owed" action={<Button size="sm" variant="outline" onClick={() => shares.refetch()}>Retry</Button>}>{getErrorMessage(shares.error, "")}</Alert>}
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
          {others.some((p) => p.profitSharePct !== null) && <MonthlySharing />}
          {others.length > 0 && <Corrections partnerNames={new Map(others.map((p) => [p.id, p.name]))} />}

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
  return (
    <Card className="overflow-hidden p-0" data-testid="owner-card">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"><Crown className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-[17px] font-semibold tracking-tight text-fg">{owner.name}</p>
              <p className="text-sm text-fg-muted">Owner since {formatBookDate(owner.joinedOn)}{owner.phone ? ` · ${owner.phone}` : ""}{owner.email ? ` · ${owner.email}` : ""}</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
        </div>
        {/* The same two figures as the Finance home, side by side and never added up: capital is what the owner has in
            the business, drawings what has been taken out for themselves (partner-statement.service ownerSummary). */}
        <Figures cols={2}>
          <Figure label="Net capital" value={owner.balances.capital} hint="Owner capital: money and costs paid in, less any returned" />
          <Figure label="Drawings" value={-owner.balances.current} hint="Payouts kept and money taken out" />
        </Figures>
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

      <Timeline items={activity.data?.items ?? []} loading={activity.isLoading} empty="Nothing put in or taken out yet." name={owner.name} />
      {money && <OwnerMoneyModal kind={money} ownerName={owner.name} onClose={() => setMoney(null)} />}
    </Card>
  );
}

/** Figures as one grouped panel: side by side from `sm`, a label/value list on a phone so no amount is cut short. */
function Figures({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <dl className={cn("grid overflow-hidden rounded-xl border border-line-subtle max-sm:divide-y max-sm:divide-line-subtle sm:divide-x sm:divide-line-subtle", cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}>{children}</dl>;
}

function Figure({ label, value, tone, strong, loading, hint }: { label: string; value: number | undefined; tone?: "in"; strong?: boolean; loading?: boolean; hint?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-3 px-4 py-3 sm:block sm:p-4", strong && "bg-surface-muted")}>
      <dt className="text-sm font-medium text-fg-muted sm:text-[13px]">{label}</dt>
      <dd className={cn("text-[17px] font-semibold tabular-nums tracking-tight sm:mt-1 sm:text-[22px]", tone === "in" ? "text-success-700" : "text-fg")}>
        {loading || value === undefined ? <Skeleton className="h-6 w-24 sm:h-7 sm:w-28" /> : `${value < 0 ? "−" : ""}${formatPrice(Math.abs(value))}`}
      </dd>
      {hint && <dd className="mt-0.5 hidden text-xs text-fg-subtle sm:block">{hint}</dd>}
    </div>
  );
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A history line repeats what its card already says ("Deposit: Money put in by <name> — VPS", "Printer, paid by <name>
 * (owner's list …; exact day not recorded)"). Show what differs, and say plainly when the day is approximate. */
function tidyLine(text: string, name: string): { text: string; approxDay: boolean } {
  const approxDay = /exact day not recorded/i.test(text);
  const who = escapeRegExp(name);
  const t = text
    .replace(/^(Deposit|Withdrawal):\s*Money (put in|taken out) by [^—]+—\s*/i, "")
    .replace(/\s*\(owner's list[^)]*\)/i, "")
    .replace(new RegExp(`,?\\s+(paid|bought) by ${who}\\b`, "i"), "")
    .trim();
  return { text: t ? t.charAt(0).toUpperCase() + t.slice(1) : text, approxDay };
}

function Timeline({ items, loading, empty, name }: { items: PartnerActivityItem[]; loading: boolean; empty: string; name: string }) {
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
                {rows.map((i) => {
                  const line = tidyLine(i.description, name);
                  return (
                    <li key={i.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                      <span className="flex min-w-0 items-start gap-2.5">
                        <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", i.amount >= 0 ? "bg-success-50 text-success-700" : "bg-surface-muted text-fg-muted")}>
                          {i.amount >= 0 ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-fg" title={i.description}>{line.text}</span>
                          <span className="text-xs text-fg-muted">{KIND_LABEL[i.kind]} · {line.approxDay ? `${monthLabel(i.date.slice(0, 7))}, day not recorded` : formatBookDate(i.date)}</span>
                        </span>
                      </span>
                      <span className={cn("shrink-0 tabular-nums font-medium", i.amount >= 0 ? "text-success-700" : "text-fg")}>{i.amount >= 0 ? "+" : "−"}{formatPrice(Math.abs(i.amount))}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {items.length > 12 && <Button size="sm" variant="ghost" className="-ml-3" onClick={() => setAll((v) => !v)}>{all ? "Show less" : `Show all ${items.length}`}</Button>}
        </div>
      )}
    </div>
  );
}

// ── a working partner ─────────────────────────────────────────────────────────────────────────────────────────────────

function PartnerSection({ partner, shares, canAct, onEdit }: { partner: Partner; shares: PartnerShares | null; canAct: boolean; onEdit: () => void }) {
  const activity = useQuery({ queryKey: financeApi.partnerKeys.activity(partner.id), queryFn: () => financeApi.getPartnerActivity(partner.id) });
  const [paying, setPaying] = useState(false);
  const [capital, setCapital] = useState<"CONTRIBUTE" | "RETURN" | null>(null);
  const [statement, setStatement] = useState(false);
  const s = shares;
  const b = s?.balances;
  const name = firstName(partner.name);
  return (
    <Card className="overflow-hidden p-0" data-testid="partner-card">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-muted"><Handshake className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[17px] font-semibold tracking-tight text-fg">
                {partner.name}
                {partner.profitSharePct !== null && <Badge variant={partner.shareConfirmed ? "success" : "warning"}>{partner.profitSharePct}% of monthly profit</Badge>}
                {s?.status === "LEFT" && <Badge variant="neutral">Left {partner.leftOn ? formatBookDate(partner.leftOn) : ""}</Badge>}
                {s?.status === "NO_CURRENT_SHARE" && <Badge variant="neutral">No profit share now</Badge>}
                {partner.ownershipPct !== null && <Badge variant="neutral">Owns {partner.ownershipPct}%</Badge>}
              </p>
              <p className="text-sm text-fg-muted">{ROLE_LABEL[partner.role]} since {formatBookDate(partner.joinedOn)}{partner.phone ? ` · ${partner.phone}` : ""}{partner.email ? ` · ${partner.email}` : ""}</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
        </div>
        {partner.profitSharePct !== null && (
          <p className="text-sm text-fg-muted">
            Shares {partner.profitSharePct}% of each month&apos;s net profit, from {formatBookDate(partner.shareFrom ?? partner.joinedOn)}. A loss month shares nothing.
            {isWorkingRole(partner.role) ? ` ${name} puts in no capital and bears no loss.` : ""}
          </p>
        )}
        {/* One source (the ledger, partner-statement.service): owed − waiting for approval = can be paid now. */}
        <Figures>
          {b && b.paidInAdvance > 0
            ? <Figure label="Paid in advance" value={b.paidInAdvance} strong hint="More than earned so far; later shares make it up" />
            : <Figure label="Can be paid now" value={b?.availableToPay} strong loading={!b}
                hint={b ? (b.pendingCommitments > 0 ? `Owed ${formatPrice(b.postedPayable)} − ${formatPrice(b.pendingCommitments)} waiting for approval` : b.postedPayable > 0 ? "Everything owed" : "Nothing owed now") : undefined} />}
          <Figure label="Earned" value={b?.finalizedEarnings} tone="in" loading={!b} hint="Shares that are in the books" />
          <Figure label="Paid" value={b?.paymentsCompleted} loading={!b} hint={`What ${name} has received, less any reversed`} />
        </Figures>
        {b && b.unclassified !== 0 && (
          <Alert variant="warning" title="An entry needs a look">{formatPrice(Math.abs(b.unclassified))} on {name}&apos;s account came from a journal that isn&apos;t a share or a payment. It&apos;s in the history below.</Alert>
        )}
        {s?.runningMonth && (
          <div className="flex items-start gap-3 rounded-xl bg-surface-muted p-4 text-sm">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p className="text-fg-muted">
              <span className="font-medium text-fg">{monthLabel(s.runningMonth.period)} so far:</span> profit {s.runningMonth.profitSoFar < 0 ? `−${formatPrice(-s.runningMonth.profitSoFar)}` : formatPrice(s.runningMonth.profitSoFar)} → {name}&apos;s share{" "}
              <span className="font-medium tabular-nums text-fg">{formatPrice(s.runningMonth.shareSoFar)}</span>. It is fixed when the month ends.
            </p>
          </div>
        )}
        {s && (
          <div className="flex flex-wrap gap-2">
            {canAct && (s.balances.availableToPay > 0
              ? <Button size="sm" onClick={() => setPaying(true)} data-testid="pay-partner">Pay {name} {formatPrice(s.balances.availableToPay)}</Button>
              : <Button size="sm" variant="outline" onClick={() => setPaying(true)} data-testid="pay-partner-advance">Pay {name} in advance</Button>)}
            <Button size="sm" variant="ghost" onClick={() => setStatement(true)} data-testid="partner-statement">Statement</Button>
          </div>
        )}
      </div>

      {/* Capital is not profit: what the partner put in and took back, on their capital account — its own figures. */}
      {b && (isInvestorRole(partner.role) || b.capital.contributed !== 0 || b.capital.returned !== 0) && (
        <div className="space-y-3 border-t border-line-subtle px-5 py-4 sm:px-6" data-testid="partner-capital">
          <p className="text-[15px] font-semibold text-fg">Capital</p>
          <Figures>
            <Figure label="Put in" value={b.capital.contributed} />
            <Figure label="Returned" value={b.capital.returned} />
            <Figure label="Net capital" value={b.capital.net} strong />
          </Figures>
          {canAct && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setCapital("CONTRIBUTE")} data-testid="capital-in"><ArrowDownLeft className="h-4 w-4" /> Capital put in</Button>
              {b.capital.net > 0 && <Button size="sm" variant="outline" onClick={() => setCapital("RETURN")} data-testid="capital-back"><ArrowUpRight className="h-4 w-4" /> Capital returned</Button>}
            </div>
          )}
        </div>
      )}
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
      <Timeline items={activity.data?.items ?? []} loading={activity.isLoading} empty="No shares or payments yet." name={partner.name} />
      {/* What can be paid now; a negative figure means already paid that much in advance. */}
      {paying && s && <PayModal partner={partner} owed={s.balances.paidInAdvance > 0 ? -s.balances.paidInAdvance : s.balances.availableToPay} onClose={() => setPaying(false)} />}
      {capital && b && <PartnerCapitalModal kind={capital} partner={partner} net={b.capital.net} onClose={() => setCapital(null)} />}
      {statement && <StatementModal partnerId={partner.id} name={partner.name} onClose={() => setStatement(false)} />}
    </Card>
  );
}

/** Capital in (to the partner's capital account) or back (at most what is in it — the API checks it again). */
function PartnerCapitalModal({ kind, partner, net, onClose }: { kind: "CONTRIBUTE" | "RETURN"; partner: Partner; net: number; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useMoneyAccounts();
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("BANK");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const n = Number(amount);
  const back = kind === "RETURN";
  const body = { kind, financialAccountId: account, amount: n, date, method, note: note.trim() || null };
  const valid = Boolean(account) && n > 0 && (!back || n <= net) && Boolean(date) && date <= today();
  const scope = `partner-capital-${partner.id}-${kind}`;
  const save = useMutation({
    mutationFn: () => financeApi.partnerCapital(partner.id, body, idempotencyKeyFor(scope, body)),
    onSuccess: (r) => { settleIdempotencyKey(scope); void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(r.movement.status === "POSTED" ? "Saved" : "Saved — waits for approval"); onClose(); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't save")),
  });
  return (
    <Modal open onClose={onClose} title={back ? `Capital returned to ${partner.name}` : `Capital put in by ${partner.name}`}
      description={back ? `At most ${formatPrice(net)} — the capital ${partner.name} has in the business.` : "Money the partner puts into the business as capital — not a profit share."} widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-capital">Save</Button></>}>
      <div className="space-y-4">
        <Field htmlFor="pc-amount" label="Amount" required error={back && n > net ? `At most ${formatPrice(net)}` : undefined}><Input id="pc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <div className="space-y-1.5"><p className="text-sm font-medium text-fg">How</p><SegmentedControl aria-label="Method" value={method} onChange={setMethod} options={METHODS} /></div>
        <Field htmlFor="pc-acc" label={back ? "From" : "Into"} required>
          <Select id="pc-acc" value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </Field>
        <Field htmlFor="pc-date" label="Date" required><Input id="pc-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="pc-note" label="Note"><Input id="pc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      </div>
    </Modal>
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
  const [amount, setAmount] = useState(owed > 0 ? String(owed) : "");
  const [from, setFrom] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("BKASH");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [advanceReason, setAdvanceReason] = useState("");
  const n = Number(amount);
  // More than is owed is paid as an advance — on purpose, with a reason; later shares make it up (nothing is taken back).
  const owedNow = Math.max(0, owed);
  const advance = n > owedNow;
  const body = { fromFinancialAccountId: from, amount: n, paymentDate: date, method, note: note.trim() || null, ...(advance ? { advanceReason: advanceReason.trim() } : {}) };
  const valid = Boolean(from) && n > 0 && (!advance || advanceReason.trim().length >= 3) && Boolean(date) && date <= today();
  const save = useMutation({
    mutationFn: () => financeApi.payPartner(partner.id, body, idempotencyKeyFor(partnerPaymentScope(partner.id), body)),
    onSuccess: (r) => { settleIdempotencyKey(partnerPaymentScope(partner.id)); void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(r.movement.status === "POSTED" ? `Paid ${formatPrice(n)} to ${partner.name}` : "Payment waits for approval"); onClose(); },
    onError: (e) => toast.error(getErrorMessage(e, "The payment couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={`Pay ${partner.name}`} description={owed < 0 ? `Already paid ${formatPrice(-owed)} in advance.` : `Owed now: ${formatPrice(owedNow)}.`} widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-pay">Pay {n > 0 ? formatPrice(n) : ""}</Button></>}>
      <div className="space-y-4">
        <Field htmlFor="pp-amount" label="Amount" required><Input id="pp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {advance && n > 0 && (
          <Field htmlFor="pp-advance" label="Reason for the advance" required
            hint={`${formatPrice(n - owedNow)} is more than ${partner.name} is owed, so it is paid in advance. Their next shares make it up; nothing is taken back.`}>
            <Input id="pp-advance" value={advanceReason} onChange={(e) => setAdvanceReason(e.target.value)} maxLength={300} placeholder="e.g. Eid advance, agreed" data-testid="pay-advance-reason" />
          </Field>
        )}
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
            <Field htmlFor="pt-pct" label="Share of monthly profit (%)" hint={partner ? "A change applies from the first month not shared yet — shared months keep their rate. Nothing in a loss month." : "Nothing in a loss month"}><Input id="pt-pct" inputMode="decimal" value={form.profitSharePct} onChange={set("profitSharePct")} placeholder="20" /></Field>
            <Field htmlFor="pt-from" label="Shares from" hint="Default: partner since"><Input id="pt-from" type="date" value={form.shareFrom} onChange={set("shareFrom")} /></Field>
          </>
        )}
        <Field htmlFor="pt-notes" label="Notes" className="sm:col-span-2"><Textarea id="pt-notes" value={form.notes} onChange={set("notes")} rows={2} maxLength={1000} /></Field>
      </div>
    </Modal>
  );
}
