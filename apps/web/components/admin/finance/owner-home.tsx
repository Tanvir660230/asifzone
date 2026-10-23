"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/lib/api-client";
import * as booksApi from "@/lib/api/finance-books";
import type { OwnerHome as Home, OwnerMonth } from "@/lib/api/finance-books";
import { formatPrice as formatExact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { QuickAdd, type QuickAddKind } from "./quick-add";

const monthName = (key: string, opts: Intl.DateTimeFormatOptions = { month: "long" }) => new Date(`${key}-01T00:00:00`).toLocaleDateString("en-GB", opts);
const lastMonths = (today: string, n: number) => {
  const out: string[] = [];
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00`);
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
};
/** Whole taka on this page — the detail pages show the paisa. */
const formatPrice = (v: number) => formatExact(Math.round(v));
const signed = (v: number) => (v < 0 ? `−${formatPrice(-v)}` : formatPrice(v));

/**
 * The owner's home (docs/FINANCE_OWNER_HOME.md): how the month went, where the money is, who is owed what and what
 * needs doing — one call, plain words, every figure linking to the page behind it. Everyday entries start from Add.
 */
export function OwnerHome() {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState<{ kind?: QuickAddKind; partnerId?: string } | null>(null);
  const q = useQuery({ queryKey: booksApi.ownerHomeKey(month), queryFn: () => booksApi.getOwnerHome(month) });
  const d = q.data;

  return (
    <div className="space-y-6" data-testid="owner-home">
      <div className="flex items-center justify-between gap-3">
        <Select aria-label="Month" className="min-w-0 flex-1 sm:w-auto sm:flex-none" value={month ?? d?.month.month ?? ""} onChange={(e) => setMonth(e.target.value)} disabled={!d}>
          {(d ? lastMonths(d.today, 6) : []).map((m, i) => <option key={m} value={m}>{i === 0 ? `This month (${monthName(m)})` : monthName(m, { month: "long", year: "numeric" })}</option>)}
        </Select>
        <Button className="shrink-0" onClick={() => setAdding({})} data-testid="owner-add"><Plus className="h-4 w-4" /> Add</Button>
      </div>

      {q.isError && <Alert variant="danger" title="Couldn't load your numbers" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "Try again in a moment.")}</Alert>}

      {!d && !q.isError && <HomeSkeleton />}

      {d && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <MonthStory month={d.month} last={d.lastMonth} current={!month || month === d.today.slice(0, 7)} />
            <Todo items={d.todo} onPay={(partnerId) => setAdding({ kind: "PAY_PARTNER", partnerId })} />
          </div>
          <div className="space-y-6">
            <Money money={d.money} />
            {d.people && <People people={d.people} onAdd={setAdding} />}
          </div>
        </div>
      )}

      {adding && d && <QuickAdd home={d} initial={adding.kind} partnerId={adding.partnerId} onClose={() => setAdding(null)} />}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Skeleton className="h-80 w-full rounded-2xl" />
      <div className="space-y-6"><Skeleton className="h-56 w-full rounded-2xl" /><Skeleton className="h-40 w-full rounded-2xl" /></div>
    </div>
  );
}

// ── how the month went ────────────────────────────────────────────────────────────────────────────────────────────────

/** Where each taka of sales went. The one bold thing on the page. */
const SHARES: Array<{ key: keyof Pick<OwnerMonth, "goods" | "delivery" | "ads" | "other">; label: string; hint: string; color: string; href: string }> = [
  { key: "goods", label: "Goods", hint: "what the items sold cost you", color: "bg-ink-700", href: "/admin/finance/profit" },
  { key: "delivery", label: "Delivery", hint: "Steadfast charges", color: "bg-ink-500", href: "/admin/finance/courier" },
  { key: "ads", label: "Ads", hint: "Facebook & Instagram", color: "bg-ink-400", href: "/admin/finance/ads" },
  { key: "other", label: "Other costs", hint: "packaging, hosting, fees", color: "bg-ink-300", href: "/admin/finance/expenses" },
];

function MonthStory({ month, last, current }: { month: OwnerMonth; last: OwnerMonth; current: boolean }) {
  const loss = month.profit < 0;
  const base = month.sales > 0 ? month.sales : 0;
  const per100 = (v: number) => (base ? Math.round((Math.max(0, v) / base) * 100) : 0);
  const profitPer100 = base ? Math.round((month.profit / base) * 100) : 0;
  const label = current ? `${monthName(month.month)} so far` : monthName(month.month, { month: "long", year: "numeric" });

  return (
    <Card className="overflow-hidden p-0" data-testid="owner-month">
      <div className="space-y-1 p-5 sm:p-7">
        <p className="text-sm text-fg-muted">{label}</p>
        <p className={cn("text-[2rem] font-semibold leading-tight tracking-tight tabular-nums sm:text-[2.75rem]", loss ? "text-danger-600" : "text-fg")}>
          {loss ? `${formatPrice(-month.profit)} loss` : `${formatPrice(month.profit)} profit`}
        </p>
        <p className="text-[15px] text-fg-muted">
          from <span className="font-medium text-fg tabular-nums">{formatPrice(month.sales)}</span> in sales.{" "}
          {last.sales > 0 && <>Last month: <span className="tabular-nums">{formatPrice(Math.abs(last.profit))}</span> {last.profit < 0 ? "loss" : "profit"}.</>}
        </p>
      </div>

      {base > 0 ? (
        <div className="space-y-4 border-t border-line-subtle bg-surface-muted/60 p-5 sm:p-7">
          <p className="text-sm font-medium text-fg">Every {formatPrice(100)} you sold</p>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
            {SHARES.map((s) => <span key={s.key} className={s.color} style={{ width: `${per100(month[s.key])}%` }} />)}
            {!loss && <span className="bg-success-500" style={{ width: `${Math.max(0, profitPer100)}%` }} />}
          </div>
          <ul className="divide-y divide-line-subtle">
            {SHARES.map((s) => (
              <li key={s.key}>
                <Link href={s.href} className="flex items-center gap-3 py-2.5 text-sm hover:text-accent">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", s.color)} aria-hidden="true" />
                  <span className="min-w-0 flex-1"><span className="block text-fg">{s.label}</span><span className="hidden text-xs text-fg-muted sm:block">{s.hint}</span></span>
                  <span className="w-10 text-right tabular-nums text-fg-muted">{formatPrice(per100(month[s.key]))}</span>
                  <span className="w-24 text-right tabular-nums text-fg">{formatPrice(month[s.key])}</span>
                </Link>
              </li>
            ))}
            <li className="flex items-center gap-3 py-2.5 text-sm font-medium">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", loss ? "bg-danger-500" : "bg-success-500")} aria-hidden="true" />
              <span className="flex-1 text-fg">{loss ? "Lost" : "You keep"}</span>
              <span className={cn("w-10 text-right tabular-nums", loss ? "text-danger-600" : "text-success-700")}>{loss ? `−${formatPrice(-profitPer100)}` : formatPrice(profitPer100)}</span>
              <span className={cn("w-24 text-right tabular-nums", loss ? "text-danger-600" : "text-success-700")}>{signed(month.profit)}</span>
            </li>
          </ul>
          {loss && <p className="text-xs text-fg-muted">Costs were more than sales this month — usually ads or one-time setup costs. A working partner gets nothing for a loss month.</p>}
        </div>
      ) : (
        <p className="border-t border-line-subtle px-5 py-6 text-sm text-fg-muted sm:px-7">No sales delivered in this month yet. Profit appears as orders are delivered.</p>
      )}
    </Card>
  );
}

// ── what needs the owner ──────────────────────────────────────────────────────────────────────────────────────────────

function todoText(t: Home["todo"][number]): string {
  switch (t.kind) {
    case "BOOKS_NOT_STARTED": return "Start your books so profit can be worked out";
    case "PAYOUT_WAITING": return `${t.count} Steadfast payout${t.count === 1 ? "" : "s"} waiting for a look (${formatPrice(t.amount ?? 0)})`;
    case "PAY_PARTNER": return `Pay ${t.name} ${formatPrice(t.amount ?? 0)}`;
    case "RENEW_SOON": return `Renew ${t.name} before ${new Date(`${t.date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
    case "EXPIRED": return `${t.name} has run out — renew it`;
    case "APPROVE_MONEY": return `${t.count} money movement${t.count === 1 ? "" : "s"} waiting for your approval`;
  }
}

function Todo({ items, onPay }: { items: Home["todo"]; onPay: (partnerId: string) => void }) {
  if (!items.length) {
    return (
      <p className="flex items-start gap-2 px-1 text-sm text-fg-muted" data-testid="owner-todo-empty">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" /> Nothing needs you right now. Sales, Steadfast payouts and partner shares are kept up to date automatically.
      </p>
    );
  }
  return (
    <Card className="p-0" data-testid="owner-todo">
      <p className="px-5 pt-4 text-sm font-medium text-fg sm:px-6">Needs you</p>
      <ul className="divide-y divide-line-subtle">
        {items.map((t, i) => (
          <li key={`${t.kind}-${i}`}>
            {t.kind === "PAY_PARTNER" ? (
              <button type="button" onClick={() => onPay(t.partnerId ?? "")} className="flex w-full items-center gap-3 px-5 py-3.5 text-left text-sm hover:bg-surface-muted sm:px-6">
                <span className="h-2 w-2 shrink-0 rounded-full bg-warning-500" aria-hidden="true" />
                <span className="flex-1 text-fg">{todoText(t)}</span>
                <span className="font-medium text-accent">Pay</span>
              </button>
            ) : (
              <Link href={t.href} className="flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-surface-muted sm:px-6">
                <span className="h-2 w-2 shrink-0 rounded-full bg-warning-500" aria-hidden="true" />
                <span className="flex-1 text-fg">{todoText(t)}</span>
                <ChevronRight className="h-4 w-4 text-fg-muted" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── where the money is ────────────────────────────────────────────────────────────────────────────────────────────────

function Money({ money }: { money: Home["money"] }) {
  const rows = [
    { label: "Steadfast will pay you", value: money.owedToUs.courier, href: "/admin/finance/courier" },
    { label: "Payment gateways will pay you", value: money.owedToUs.gateways, href: "/admin/finance/settlements" },
    { label: "Customers still owe", value: money.owedToUs.customers, href: "/admin/finance/sales" },
    { label: "Goods in stock, at cost", value: money.inBusiness.stock, href: "/admin/stock" },
    { label: "Paid in advance", hint: "hosting, domain, setup", value: money.inBusiness.prepaid, href: "/admin/finance/prepaid" },
    { label: "Cash, bank and bKash", value: money.withUs.total, href: "/admin/finance/accounts" },
  ].filter((r) => Math.abs(r.value) >= 1 || r.label.startsWith("Cash"));
  const total = rows.reduce((s, r) => s + r.value, 0);
  const owes = money.weOwe.suppliers + money.weOwe.owner + money.weOwe.loans;
  return (
    <Card className="p-0" data-testid="owner-money">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-5 sm:px-6">
        <p className="text-sm font-medium text-fg">Where your money is</p>
        <p className="text-lg font-semibold tabular-nums text-fg">{formatPrice(total)}</p>
      </div>
      <ul className="mt-2 divide-y divide-line-subtle">
        {rows.map((r) => (
          <li key={r.label}>
            <Link href={r.href} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-surface-muted sm:px-6">
              <span className="flex-1 text-fg">{r.label}{r.hint && <span className="block text-xs text-fg-muted">{r.hint}</span>}</span>
              <span className="tabular-nums text-fg">{formatPrice(r.value)}</span>
              <ChevronRight className="h-4 w-4 text-fg-muted" />
            </Link>
          </li>
        ))}
      </ul>
      {owes >= 1 && <p className="border-t border-line-subtle px-5 py-3 text-sm text-fg-muted sm:px-6">You owe <span className="tabular-nums text-fg">{formatPrice(owes)}</span> to suppliers, the owner or lenders.</p>}
    </Card>
  );
}

// ── owner and partners ────────────────────────────────────────────────────────────────────────────────────────────────

function People({ people, onAdd }: { people: NonNullable<Home["people"]>; onAdd: (a: { kind?: QuickAddKind; partnerId?: string }) => void }) {
  const o = people.owner;
  return (
    <Card className="p-0" data-testid="owner-people">
      <p className="px-5 pt-5 text-sm font-medium text-fg sm:px-6">Owner &amp; partners</p>
      {o && (
        <Link href="/admin/finance/equity" className="block px-5 py-4 hover:bg-surface-muted sm:px-6">
          <p className="text-[15px] font-medium text-fg">{o.name}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-xs text-fg-muted">Net capital</dt><dd className="font-medium tabular-nums text-fg">{signed(o.netCapital)}</dd></div>
            <div><dt className="text-xs text-fg-muted">Drawings</dt><dd className="font-medium tabular-nums text-fg">{signed(o.drawings)}</dd></div>
          </dl>
        </Link>
      )}
      <ul className="divide-y divide-line-subtle border-t border-line-subtle">
        {people.partners.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-5 py-4 sm:px-6">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-fg">
                {p.name}{" "}
                <span className="text-sm font-normal text-fg-muted">{p.status === "LEFT" ? "left" : p.sharePct !== null ? `${p.sharePct}% of profit` : "no profit share now"}</span>
              </p>
              <p className="text-sm text-fg-muted">
                {p.available > 0 ? <>Can be paid now <span className="tabular-nums text-fg">{formatPrice(p.available)}</span></>
                  : p.paidInAdvance > 0 ? <>Paid <span className="tabular-nums text-fg">{formatPrice(p.paidInAdvance)}</span> in advance</>
                  : "Nothing to pay now"}
                {p.pending > 0 && <>. <span className="tabular-nums text-fg">{formatPrice(p.pending)}</span> waiting for approval</>}
                {p.runningMonth && <>. This month so far <span className="tabular-nums text-fg">{formatPrice(p.runningMonth.shareSoFar)}</span> (estimate)</>}
              </p>
            </div>
            {p.available > 0 && <Button size="sm" onClick={() => onAdd({ kind: "PAY_PARTNER", partnerId: p.id })}>Pay</Button>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
