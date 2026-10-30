"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, CalendarCheck, CheckCircle2, ChevronRight, FileText, HandCoins, Landmark, Plus, Receipt, Smartphone, type LucideIcon } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/lib/api-client";
import { alertKeys, getFinanceAlerts, type FinanceAlert } from "@/lib/api/finance";
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

type Adding = { kind?: QuickAddKind; partnerId?: string };

/**
 * The owner's home (docs/FINANCE_OWNER_HOME.md), in the Money "Liquid Glass" look (owner, 2026-10-31): the month on one
 * titanium card, the everyday entries as round keys (one tap each), the money in Wallet-style cards, then what needs
 * doing and who is owed what. One call, plain words, every figure linking to the page behind it.
 */
export function OwnerHome() {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState<Adding | null>(null);
  const q = useQuery({ queryKey: booksApi.ownerHomeKey(month), queryFn: () => booksApi.getOwnerHome(month) });
  // The same alerts as Home's work queue (shared cache with the sidebar badge): a critical one must never sit behind
  // "Nothing needs you right now".
  const alerts = useQuery({ queryKey: alertKeys.all, queryFn: getFinanceAlerts });
  const critical = alerts.data?.alerts.filter((a) => a.severity === "critical") ?? [];
  const d = q.data;
  const current = !month || (d ? month === d.today.slice(0, 7) : false);
  const stockGain = current ? alerts.data?.alerts.find((a) => a.key === "inventory.gains" && (a.amount ?? 0) > 0) : undefined;

  return (
    <div className="space-y-7" data-testid="owner-home">
      <div className="flex items-center justify-between gap-3">
        <Select aria-label="Month" className="min-w-0 flex-1 sm:w-auto sm:flex-none" value={month ?? d?.month.month ?? ""} onChange={(e) => setMonth(e.target.value)} disabled={!d}>
          {(d ? lastMonths(d.today, 6) : []).map((m, i) => <option key={m} value={m}>{i === 0 ? `This month (${monthName(m)})` : monthName(m, { month: "long", year: "numeric" })}</option>)}
        </Select>
        <Button className="shrink-0 rounded-full" onClick={() => setAdding({})} data-testid="owner-add"><Plus className="h-4 w-4" /> New</Button>
      </div>

      {q.isError && <Alert variant="danger" title="Couldn't load your numbers" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "Try again in a moment.")}</Alert>}

      {!d && !q.isError && <HomeSkeleton />}

      {d && (
        <>
          <MonthCard month={d.month} last={d.lastMonth} current={current} stockGain={stockGain} />
          <ActionKeys hasPartners={Boolean(d.people?.partners.length)} onAdd={setAdding} />
          <div className="grid gap-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="space-y-7">
              <Wallet money={d.money} />
              <Todo items={d.todo} critical={critical} onPay={(partnerId) => setAdding({ kind: "PAY_PARTNER", partnerId })} />
            </div>
            <div className="space-y-7">
              <Money money={d.money} />
              {d.people && (d.people.owner || d.people.partners.length > 0) && <People people={d.people} onAdd={setAdding} />}
            </div>
          </div>
        </>
      )}

      {adding && d && <QuickAdd home={d} initial={adding.kind} partnerId={adding.partnerId} onClose={() => setAdding(null)} />}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-7" aria-busy="true" aria-label="Loading your numbers">
      <Skeleton className="h-64 w-full rounded-3xl" />
      <div className="flex gap-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-14 rounded-full" />)}</div>
      <div className="grid gap-7 lg:grid-cols-2"><Skeleton className="h-40 w-full rounded-2xl" /><Skeleton className="h-40 w-full rounded-2xl" /></div>
    </div>
  );
}

// ── how the month went: the titanium card ───────────────────────────────────────────────────────────────────────────

/** Where each taka of sales went. */
const SHARES: Array<{ key: keyof Pick<OwnerMonth, "goods" | "delivery" | "ads" | "other">; label: string; color: string; href: string }> = [
  { key: "goods", label: "Goods", color: "bg-ink-700", href: "/admin/finance/profit" },
  { key: "delivery", label: "Delivery", color: "bg-ink-500", href: "/admin/finance/courier" },
  { key: "ads", label: "Ads", color: "bg-ink-400", href: "/admin/finance/ads" },
  { key: "other", label: "Other costs", color: "bg-ink-300", href: "/admin/finance/expenses" },
];

function MonthCard({ month, last, current, stockGain }: { month: OwnerMonth; last: OwnerMonth; current: boolean; stockGain?: FinanceAlert }) {
  const loss = month.profit < 0;
  const base = month.sales > 0 ? month.sales : 0;
  const per100 = (v: number) => (base ? Math.round((Math.max(0, v) / base) * 100) : 0);
  const profitPer100 = base ? Math.round((month.profit / base) * 100) : 0;
  const label = current ? `${monthName(month.month)} so far` : monthName(month.month, { month: "long", year: "numeric" });

  return (
    <section className="liquid-pass p-6 sm:p-8" aria-label={`${label}: ${loss ? "loss" : "profit"}`} data-testid="owner-month">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end">
        <div>
          <p className="text-[15px] font-medium text-fg-muted">{label}</p>
          <p className={cn("mt-1 text-[2.5rem] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[3.5rem]", loss ? "text-danger-600" : "text-fg")}>
            {loss ? `−${formatPrice(-month.profit)}` : formatPrice(month.profit)}
          </p>
          <p className="mt-2 text-[15px] text-fg-muted">
            {loss ? "loss" : "profit"} from <span className="font-medium text-fg tabular-nums">{formatPrice(month.sales)}</span> in sales
          </p>
          {last.sales > 0 && (
            <p className="mt-0.5 text-sm text-fg-muted">Last month <span className="tabular-nums">{formatPrice(Math.abs(last.profit))}</span> {last.profit < 0 ? "loss" : "profit"}</p>
          )}
        </div>

        {base > 0 ? (
          <div>
            <p className="text-sm font-medium text-fg">Every {formatPrice(100)} you sold</p>
            <div className="mt-3 flex h-2.5 w-full gap-[3px] overflow-hidden rounded-full" aria-hidden="true">
              {SHARES.map((s) => per100(month[s.key]) > 0 && <span key={s.key} className={cn("rounded-full", s.color)} style={{ width: `${per100(month[s.key])}%` }} />)}
              {!loss && profitPer100 > 0 && <span className="rounded-full bg-success-500" style={{ width: `${profitPer100}%` }} />}
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
              {SHARES.map((s) => (
                <li key={s.key}>
                  <Link href={s.href} className="flex min-h-11 items-center gap-2 rounded-lg text-sm hover:text-accent">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", s.color)} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-fg-muted">{s.label}</span>
                    <span className="tabular-nums text-fg">{formatPrice(per100(month[s.key]))}</span>
                  </Link>
                </li>
              ))}
              <li className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", loss ? "bg-danger-500" : "bg-success-500")} aria-hidden="true" />
                <span className="flex-1 text-fg">{loss ? "Lost" : "You keep"}</span>
                <span className={cn("tabular-nums", loss ? "text-danger-600" : "text-success-700")}>{loss ? `−${formatPrice(-profitPer100)}` : formatPrice(profitPer100)}</span>
              </li>
            </ul>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">No sales delivered in this month yet. Profit appears as orders are delivered.</p>
        )}
      </div>

      {stockGain && (
        <Link href={stockGain.href} className="mt-6 flex items-start gap-2 rounded-2xl bg-warning-50/90 px-4 py-3 text-sm text-warning-700 hover:bg-warning-100" data-testid="owner-month-stock-gain">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            This profit includes <span className="font-medium tabular-nums">{formatPrice(stockGain.amount ?? 0)}</span> of stock added without a purchase or a fill. The real profit is lower until that stock is counted again or its purchase is recorded.
          </span>
        </Link>
      )}
      {loss && <p className="mt-5 text-xs text-fg-muted">Costs were more than sales this month — usually ads or one-time setup costs. A working partner gets nothing for a loss month.</p>}
    </section>
  );
}

// ── one tap for each everyday entry ───────────────────────────────────────────────────────────────────────────────────

function ActionKeys({ hasPartners, onAdd }: { hasPartners: boolean; onAdd: (a: Adding) => void }) {
  const keys: Array<{ label: string; icon: LucideIcon; kind?: QuickAddKind; href?: string; testId: string }> = [
    { label: "Expense", icon: Receipt, kind: "EXPENSE", testId: "key-expense" },
    { label: "Put money in", icon: ArrowDownLeft, kind: "OWNER_IN", testId: "key-owner-in" },
    { label: "Take money out", icon: ArrowUpRight, kind: "OWNER_OUT", testId: "key-owner-out" },
    ...(hasPartners ? [{ label: "Pay partner", icon: HandCoins, kind: "PAY_PARTNER" as const, testId: "key-pay-partner" }] : []),
    { label: "Pay a bill", icon: FileText, href: "/admin/finance/supplier-invoices", testId: "key-bills" },
    { label: "Close month", icon: CalendarCheck, href: "/admin/finance/month-end", testId: "key-month-end" },
  ];
  return (
    <nav aria-label="Quick actions" className="-mx-1 overflow-x-auto pb-1">
      <ul className="flex min-w-max gap-2 px-1 sm:min-w-0 sm:flex-wrap sm:gap-x-6 sm:gap-y-3">
        {keys.map((k) => {
          const inner = (
            <>
              <span className="liquid-key"><k.icon className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden="true" /></span>
              <span className="mt-2 block w-[5.5rem] text-center text-[13px] leading-tight text-fg">{k.label}</span>
            </>
          );
          return (
            <li key={k.label} className="flex justify-center">
              {k.href ? (
                <Link href={k.href} className="group flex flex-col items-center rounded-2xl p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" data-testid={k.testId}>{inner}</Link>
              ) : (
                <button type="button" onClick={() => onAdd({ kind: k.kind })} className="group flex flex-col items-center rounded-2xl p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" data-testid={k.testId}>{inner}</button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ── the money you hold: Wallet cards ──────────────────────────────────────────────────────────────────────────────────

function Wallet({ money }: { money: Home["money"] }) {
  const cards: Array<{ label: string; value: number; icon: LucideIcon; fill: string }> = [
    { label: "Cash", value: money.withUs.cash, icon: Banknote, fill: "var(--pass-cash)" },
    { label: "Bank", value: money.withUs.bank, icon: Landmark, fill: "var(--pass-bank)" },
    { label: "bKash & Nagad", value: money.withUs.wallets, icon: Smartphone, fill: "var(--pass-wallet)" },
  ];
  return (
    <section aria-labelledby="wallet-title">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="wallet-title" className="text-[17px] font-semibold tracking-tight text-fg">Money you hold</h2>
        <p className="text-[17px] font-semibold tabular-nums text-fg">{formatPrice(money.withUs.total)}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <li key={c.label}>
            <Link href="/admin/finance/accounts" className="liquid flex min-h-[104px] flex-col justify-between p-4" style={{ background: c.fill }}>
              <span className="flex items-center gap-2 text-sm text-fg-muted"><c.icon className="h-4 w-4" aria-hidden="true" />{c.label}</span>
              <span className="text-[22px] font-semibold tracking-tight tabular-nums text-fg">{signed(c.value)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
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

function Todo({ items: all, critical, onPay }: { items: Home["todo"]; critical: FinanceAlert[]; onPay: (partnerId: string) => void }) {
  const items = critical.some((a) => a.key === "books.not_started") ? all.filter((t) => t.kind !== "BOOKS_NOT_STARTED") : all;
  if (!items.length && !critical.length) {
    return (
      <p className="liquid flex items-start gap-3 px-5 py-4 text-sm text-fg-muted" data-testid="owner-todo-empty">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-600" aria-hidden="true" />
        <span><span className="block font-medium text-fg">Nothing needs you right now</span>Sales, Steadfast payouts and partner shares are kept up to date automatically.</span>
      </p>
    );
  }
  return (
    <section aria-labelledby="todo-title" data-testid="owner-todo">
      <h2 id="todo-title" className="mb-3 text-[17px] font-semibold tracking-tight text-fg">Needs you</h2>
      <ul className="liquid divide-y divide-line-subtle overflow-hidden">
        {critical.map((a) => (
          <li key={a.key}>
            <Link href={a.href} className="flex min-h-14 items-center gap-3 px-5 py-3 text-sm hover:bg-white/60" data-testid="owner-todo-critical">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-danger-500" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-fg">{a.title}{a.amount ? <> · <span className="tabular-nums">{formatPrice(a.amount)}</span></> : null}</span>
                <span className="block text-xs text-fg-muted">{a.action}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
            </Link>
          </li>
        ))}
        {items.map((t, i) => (
          <li key={`${t.kind}-${i}`}>
            {t.kind === "PAY_PARTNER" ? (
              <div className="flex min-h-14 items-center gap-3 px-5 py-3 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-warning-500" aria-hidden="true" />
                <span className="flex-1 text-fg">{todoText(t)}</span>
                <Button size="sm" className="rounded-full" onClick={() => onPay(t.partnerId ?? "")}>Pay</Button>
              </div>
            ) : (
              <Link href={t.href} className="flex min-h-14 items-center gap-3 px-5 py-3 text-sm hover:bg-white/60">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-warning-500" aria-hidden="true" />
                <span className="flex-1 text-fg">{todoText(t)}</span>
                <ChevronRight className="h-4 w-4 text-fg-muted" aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
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
    <section aria-labelledby="money-title" data-testid="owner-money">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="money-title" className="text-[17px] font-semibold tracking-tight text-fg">Where your money is</h2>
        <p className="text-[17px] font-semibold tabular-nums text-fg">{formatPrice(total)}</p>
      </div>
      <ul className="liquid divide-y divide-line-subtle overflow-hidden">
        {rows.map((r) => (
          <li key={r.label}>
            <Link href={r.href} className="flex min-h-12 items-center gap-3 px-5 py-2.5 text-sm hover:bg-white/60">
              <span className="flex-1 text-fg">{r.label}{r.hint && <span className="block text-xs text-fg-muted">{r.hint}</span>}</span>
              <span className="tabular-nums text-fg">{formatPrice(r.value)}</span>
              <ChevronRight className="h-4 w-4 text-fg-muted" aria-hidden="true" />
            </Link>
          </li>
        ))}
        {owes >= 1 && <li className="px-5 py-3 text-sm text-fg-muted">You owe <span className="tabular-nums text-fg">{formatPrice(owes)}</span> to suppliers, the owner or lenders.</li>}
      </ul>
    </section>
  );
}

// ── owner and partners ────────────────────────────────────────────────────────────────────────────────────────────────

function People({ people, onAdd }: { people: NonNullable<Home["people"]>; onAdd: (a: Adding) => void }) {
  const o = people.owner;
  return (
    <section aria-labelledby="people-title" data-testid="owner-people">
      <h2 id="people-title" className="mb-3 text-[17px] font-semibold tracking-tight text-fg">Owner &amp; partners</h2>
      <div className="liquid overflow-hidden">
        {o && (
          <Link href="/admin/finance/equity" className="block px-5 py-4 hover:bg-white/60">
            <p className="text-[15px] font-medium text-fg">{o.name}</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-xs text-fg-muted">Net capital</dt><dd className="font-medium tabular-nums text-fg">{signed(o.netCapital)}</dd></div>
              <div><dt className="text-xs text-fg-muted">Drawings</dt><dd className="font-medium tabular-nums text-fg">{signed(o.drawings)}</dd></div>
            </dl>
          </Link>
        )}
        <ul className="divide-y divide-line-subtle border-t border-line-subtle">
          {people.partners.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-4">
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
              {p.available > 0 && <Button size="sm" className="rounded-full" onClick={() => onAdd({ kind: "PAY_PARTNER", partnerId: p.id })}>Pay</Button>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
