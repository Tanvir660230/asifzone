"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BellRing, CheckCircle2, ChevronRight, Circle, Landmark, Scale, Truck, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/admin/page-header";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { useCapabilities } from "@/hooks/use-capability";
import { useNavAccess } from "@/hooks/use-nav-access";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { FinancialAccount, FinancialAccountKind } from "@/lib/api/finance";
import * as purchasingApi from "@/lib/api/purchasing";
import * as booksApi from "@/lib/api/finance-books";
import type { MoneyMap } from "@/lib/api/finance-books";
import { navChildren, navNode } from "@/lib/admin/navigation";
import { computeTrendPct, formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Money the business holds itself, vs. money a courier or gateway still holds for it (clearing accounts). */
const HELD: FinancialAccountKind[] = ["CASH", "BANK", "MOBILE_WALLET", "OTHER"];
const IN_TRANSIT: FinancialAccountKind[] = ["COURIER", "PAYMENT_GATEWAY"];
const KIND_LABEL: Record<FinancialAccountKind, string> = {
  CASH: "Cash",
  BANK: "Bank",
  MOBILE_WALLET: "Mobile wallet",
  PAYMENT_GATEWAY: "Gateway",
  COURIER: "Courier",
  OTHER: "Other",
  AD_PLATFORM: "Ad account",
};
/** The order the groups appear in the map — the same order as the sidebar. */
const GROUPS = ["finance.money", "finance.selling", "finance.purchasing", "finance.books", "finance.people", "finance.setup"];

const localToday = () => new Date().toLocaleDateString("en-CA");
const sum = (accounts: FinancialAccount[], kinds: FinancialAccountKind[]) => accounts.filter((a) => kinds.includes(a.kind)).reduce((t, a) => t + a.currentBalance, 0);

/**
 * Finance's front door: one page that says where the money is, how this month is going, who owes whom and what needs
 * doing — then a map of every finance page in plain words. Every figure links to the page behind it. Roles that only see
 * payments get the map (their pages), not the books' figures.
 */
export default function FinanceOverviewPage() {
  const { can, ready } = useCapabilities();
  const books = can("finance.view");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Finance"
        description="Where your money is, how this month is going, and who owes whom — every number links to the page behind it."
        action={
          can("finance.transact") && (
            <>
              <Link href="/admin/finance/accounts?new=deposit" className={buttonVariants({ variant: "outline", size: "sm" })}>Money in / out</Link>
              <Link href="/admin/finance/expenses?new=expense" className={buttonVariants({ size: "sm" })} data-testid="overview-record-expense">Record expense</Link>
            </>
          )
        }
      />
      {ready && books && <BooksOverview />}
      {ready && !books && (
        <Alert variant="info" title="You see the payments side of Finance">
          The books — money accounts, profit and suppliers — are visible to the owner. Your pages are listed below.
        </Alert>
      )}
      <FinanceMap />
    </div>
  );
}

function BooksOverview() {
  const { can } = useCapabilities();
  const today = localToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const business = useQuery({ queryKey: financeApi.businessKeys.settings(), queryFn: financeApi.getBusiness });
  const accounts = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts });
  const income = useQuery({ queryKey: financeApi.ledgerKeys.statement("income", { from: monthStart, to: today }), queryFn: () => financeApi.getIncomeStatement({ from: monthStart, to: today }) });
  const alerts = useQuery({ queryKey: financeApi.alertKeys.all, queryFn: financeApi.getFinanceAlerts });
  const payables = useQuery({ queryKey: purchasingApi.payablesKeys.ageing(), queryFn: purchasingApi.payablesAgeing, enabled: can("ap.view") });
  const forecast = useQuery({ queryKey: financeApi.budgetKeys.forecast(13), queryFn: () => financeApi.getCashForecast(13) });
  const map = useQuery({ queryKey: booksApi.booksKeys.moneyMap(), queryFn: () => booksApi.getMoneyMap() });

  const active = (accounts.data?.financialAccounts ?? []).filter((a) => a.isActive);
  const held = sum(active, HELD);
  const inTransit = sum(active, IN_TRANSIT);
  const pl = income.data?.current;
  const priorPl = income.data?.priorPeriod;
  const section = (key: string, p = pl) => p?.sections.find((s) => s.key === key)?.total ?? 0;

  return (
    <>
      {business.data && <SetupSteps business={business.data} accounts={active} />}

      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {accounts.isLoading ? (
          <>
            <StatTileSkeleton />
            <StatTileSkeleton />
          </>
        ) : accounts.isError ? (
          <Alert variant="danger" title="Money accounts couldn't be loaded" className="sm:col-span-2" action={<Button size="sm" variant="outline" onClick={() => accounts.refetch()}>Retry</Button>}>
            {getErrorMessage(accounts.error, "")}
          </Alert>
        ) : (
          <>
            <StatTile label="Money you have now" value={formatPrice(held)} icon={<Wallet />} tone="accent" href="/admin/finance/accounts" />
            <StatTile label="Couriers & gateways owe you" value={formatPrice(inTransit)} icon={<Truck />} href="/admin/finance/settlements" />
          </>
        )}
        {can("ap.view") &&
          (payables.isLoading ? (
            <StatTileSkeleton />
          ) : (
            <StatTile
              label={payables.data && payables.data.totals.overdue > 0 ? `You owe suppliers · ${formatPrice(payables.data.totals.overdue)} overdue` : "You owe suppliers"}
              value={payables.data ? formatPrice(payables.data.totals.balance) : "—"}
              icon={<Scale />}
              tone={payables.data && payables.data.totals.overdue > 0 ? "warning" : "default"}
              href="/admin/finance/payables"
            />
          ))}
        {income.isLoading ? (
          <StatTileSkeleton />
        ) : (
          <StatTile
            label="Profit this month"
            value={pl ? formatPrice(pl.netProfit) : "—"}
            icon={<Landmark />}
            // a % change only means something between two profits — not across a loss
            trendPct={pl && priorPl && pl.netProfit > 0 && priorPl.netProfit > 0 ? computeTrendPct(pl.netProfit, priorPl.netProfit) : null}
            href="/admin/finance/statements"
          />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className="p-5 sm:p-6">
          <SectionTitle title="This month" href="/admin/finance/statements" linkLabel="Full statements" />
          {income.isLoading ? (
            <Skeleton className="h-44 w-full" />
          ) : income.isError || !pl ? (
            <Alert variant="danger" title="Profit and loss couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => income.refetch()}>Retry</Button>}>
              {getErrorMessage(income.error, "")}
            </Alert>
          ) : (
            <dl className="divide-y divide-line-subtle text-sm" data-testid="overview-month">
              <Row label="Sales" value={section("revenue")} prior={section("revenue", priorPl)} />
              <Row label="Cost of the goods sold" value={0 - section("cogs") || 0} prior={0 - section("cogs", priorPl) || 0} />
              <Row label="Gross profit" value={pl.grossProfit} prior={priorPl?.grossProfit} hint={pl.grossMarginPct === null ? undefined : `${pl.grossMarginPct}% of sales`} strong />
              <Row label="Running costs (expenses)" value={0 - section("expenses") || 0} prior={0 - section("expenses", priorPl) || 0} href="/admin/finance/expenses" />
              {(section("otherIncome") !== 0 || section("otherExpenses") !== 0) && <Row label="Other income less other costs" value={section("otherIncome") - section("otherExpenses")} />}
              <Row label="Net profit" value={pl.netProfit} prior={priorPl?.netProfit} strong />
            </dl>
          )}
          <p className="mt-3 text-xs text-fg-subtle">{income.data ? `${formatBookDate(income.data.period.from)} – ${formatBookDate(income.data.period.to)}, compared with the same days last month.` : " "}</p>
        </Card>

        <Card className="p-5 sm:p-6">
          <SectionTitle title="Needs attention" href="/admin/finance/attention" linkLabel="All alerts" />
          {alerts.isLoading ? (
            <Skeleton className="h-44 w-full" />
          ) : alerts.isError || !alerts.data ? (
            <Alert variant="danger" title="Alerts couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => alerts.refetch()}>Retry</Button>}>
              {getErrorMessage(alerts.error, "")}
            </Alert>
          ) : alerts.data.alerts.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg bg-surface-muted p-4 text-sm" data-testid="overview-alerts-empty">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-hidden />
              <p className="text-fg-muted">Nothing is waiting. Every event is posted, nothing is overdue and the checks match.</p>
            </div>
          ) : (
            <ul className="-mx-2 space-y-0.5" data-testid="overview-alerts">
              {alerts.data.alerts.slice(0, 5).map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.04]">
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.severity === "critical" ? "bg-danger-500" : a.severity === "warning" ? "bg-warning-500" : "bg-ink-300")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg">{a.title}</span>
                      <span className="block truncate text-xs text-fg-muted">{a.detail}</span>
                    </span>
                    {a.amount !== null && <span className="shrink-0 text-sm tabular-nums text-fg-muted">{formatPrice(a.amount)}</span>}
                  </Link>
                </li>
              ))}
              {alerts.data.alerts.length > 5 && (
                <li className="px-2 pt-1 text-xs text-fg-subtle">
                  and {alerts.data.alerts.length - 5} more — <Link href="/admin/finance/attention" className="text-accent hover:underline">see all</Link>
                </li>
              )}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <SectionTitle title="Where your money is" href="/admin/finance/accounts" linkLabel="Money accounts" />
        {accounts.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : map.data && active.length > 0 ? (
          <MoneyMapView map={map.data} />
        ) : active.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-muted p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-fg-muted">No money accounts yet. Add your cash box, bank account and bKash / Nagad so every taka has a home.</p>
            {can("finance.configure") && <Link href="/admin/finance/accounts?new=account" className={buttonVariants({ size: "sm", variant: "outline" })}>Add an account</Link>}
          </div>
        ) : (
          <div className="grid gap-x-10 gap-y-5 md:grid-cols-2" data-testid="overview-accounts">
            <AccountList title="With you" total={held} accounts={active.filter((a) => HELD.includes(a.kind))} />
            <AccountList title="On its way — couriers & gateways" total={inTransit} accounts={active.filter((a) => IN_TRANSIT.includes(a.kind))} />
          </div>
        )}
        {forecast.data && active.length > 0 && (
          <p className="mt-4 border-t border-line-subtle pt-4 text-sm text-fg-muted" data-testid="overview-forecast">
            Looking ahead 13 weeks, the lowest point is <span className={cn("font-medium tabular-nums", forecast.data.lowest.balance < 0 ? "text-danger-600" : "text-fg")}>{formatPrice(forecast.data.lowest.balance)}</span> around {formatBookDate(forecast.data.lowest.date)}.{" "}
            <Link href="/admin/finance/budgets" className="text-accent hover:underline">See the cash forecast</Link>
          </p>
        )}
      </Card>
    </>
  );
}

/** First-time setup, in the order the books need it. Hidden once every step is done. */
function SetupSteps({ business, accounts }: { business: financeApi.BusinessSettings; accounts: FinancialAccount[] }) {
  const steps = [
    { done: Boolean(business.business.openingDate), title: "Choose the date your books start", detail: business.business.openingDate ? `Books start on ${formatBookDate(business.business.openingDate)}.` : "Everything before it is summed up as opening balances.", href: "/admin/finance/opening" },
    { done: accounts.some((a) => HELD.includes(a.kind)), title: "Add your cash, bank and wallet accounts", detail: "Each place money is kept — the cash box, the bank, bKash, Nagad.", href: "/admin/finance/accounts" },
    { done: business.openingBalancesStatus === "POSTED", title: "Enter what you had and owed on that date", detail: "Money in each account, stock on hand, supplier dues, loans and capital.", href: "/admin/finance/opening" },
    { done: Boolean(business.inventoryCostingActivatedAt), title: "Confirm the value of your stock", detail: "So every sale's cost and profit is worked out from real costs.", href: "/admin/finance/inventory-cutover" },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;
  const next = steps.findIndex((s) => !s.done);
  return (
    <Card className="p-5 sm:p-6" data-testid="overview-setup">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold tracking-tight text-fg">Finish setting up your books</h2>
        <p className="text-sm text-fg-muted">{steps.length - left} of {steps.length} done</p>
      </div>
      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link
              href={s.href}
              className={cn("-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.04]", i === next && "bg-accent/[0.06] hover:bg-accent/[0.09]")}
            >
              {s.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-600" aria-label="Done" /> : <Circle className={cn("mt-0.5 h-5 w-5 shrink-0", i === next ? "text-accent" : "text-ink-300")} aria-label="To do" />}
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium", s.done ? "text-fg-muted" : "text-fg")}>{i + 1}. {s.title}</span>
                <span className="block text-xs text-fg-muted">{s.detail}</span>
              </span>
              {i === next && <span className="mt-0.5 shrink-0 text-sm font-medium text-accent">Start</span>}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Every finance page this admin can open, grouped as in the sidebar, each with one plain sentence on what it's for. */
function FinanceMap() {
  const access = useNavAccess();
  if (!access.ready) return null;
  const top = ["finance.attention"].map((id) => navNode(id)).filter((n) => n && (!n.capability || access.can(n.capability)));
  const groups = GROUPS.map((id) => ({ node: navNode(id)!, pages: navChildren(id, access) })).filter((g) => g.node && g.pages.length > 0 && (!g.node.capability || access.can(g.node.capability)));
  return (
    <section aria-labelledby="finance-map-title" data-testid="finance-map">
      <div className="mb-1 flex items-center gap-2">
        <h2 id="finance-map-title" className="text-[17px] font-semibold tracking-tight text-fg">Everything in Finance</h2>
      </div>
      <p className="mb-4 text-sm text-fg-muted">Every finance page, grouped the way the menu is. Not sure where something lives? Start here.</p>
      <div className="gap-x-10 md:columns-2">
        {groups.map(({ node, pages }) => (
          <div key={node.id} className="mb-7 break-inside-avoid">
            <h3 className="text-sm font-semibold text-fg">{node.label}</h3>
            {node.description && <p className="mt-0.5 text-xs text-fg-muted">{node.description}</p>}
            <ul className="mt-2 divide-y divide-line-subtle border-y border-line-subtle">
              {pages.map(({ node: page, href }) => (
                <li key={page.id}>
                  <Link href={href} className="group flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-fg group-hover:text-accent">{page.label}</span>
                      {page.description && <span className="block text-xs text-fg-muted">{page.description}</span>}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-accent" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {top.length > 0 && (
        <p className="mt-6 flex items-center gap-2 text-sm text-fg-muted">
          <BellRing className="h-4 w-4 text-ink-400" aria-hidden />
          Problems in the books and the month-end close live in <Link href="/admin/finance/attention" className="text-accent hover:underline">Needs attention</Link>.
        </p>
      )}
    </section>
  );
}

/** One side of "Where your money is": accounts holding something, largest first; the empty ones fold into a single line. */
function AccountList({ title, total, accounts }: { title: string; total: number; accounts: FinancialAccount[] }) {
  const withMoney = accounts.filter((a) => a.currentBalance !== 0 || a.pendingMovements > 0).sort((a, b) => b.currentBalance - a.currentBalance);
  const empty = accounts.length - withMoney.length;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-line-subtle pb-2">
        <h3 className="text-[13px] font-medium text-fg-muted">{title}</h3>
        <span className="text-sm font-semibold tabular-nums text-fg">{formatPrice(total)}</span>
      </div>
      <ul className="divide-y divide-line-subtle">
        {withMoney.map((a) => (
          <li key={a.id}>
            <Link href={`/admin/finance/accounts/${a.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.04]">
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{a.name}</span>
              <span className="hidden text-xs text-fg-subtle sm:inline">{KIND_LABEL[a.kind]}</span>
              {a.pendingMovements > 0 && <Badge variant="warning">{a.pendingMovements} waiting</Badge>}
              <span className="w-28 shrink-0 text-right text-sm tabular-nums text-fg">{formatPrice(a.currentBalance)}</span>
            </Link>
          </li>
        ))}
        {empty > 0 && (
          <li className="py-2.5 text-xs text-fg-subtle">
            {withMoney.length ? `+ ${empty} more with nothing in them` : `${empty} account${empty === 1 ? "" : "s"}, nothing in them yet`}
          </li>
        )}
        {accounts.length === 0 && <li className="py-2.5 text-xs text-fg-subtle">None set up.</li>}
      </ul>
    </div>
  );
}

function SectionTitle({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-[17px] font-semibold tracking-tight text-fg">{title}</h2>
      <Link href={href} className="flex shrink-0 items-center gap-0.5 text-[13px] font-medium text-accent hover:underline">
        {linkLabel} <ArrowUpRight size={13} aria-hidden />
      </Link>
    </div>
  );
}

function Row({ label, value, prior, hint, strong, href }: { label: string; value: number; prior?: number; hint?: string; strong?: boolean; href?: string }) {
  const trend = prior === undefined ? null : computeTrendPct(value, prior);
  const name = href ? <Link href={href} className="hover:text-accent hover:underline">{label}</Link> : label;
  return (
    <div className="flex items-baseline gap-3 py-2.5">
      <dt className={cn("min-w-0 flex-1", strong ? "font-medium text-fg" : "text-fg-muted")}>
        {name}
        {hint && <span className="ml-2 text-xs text-fg-subtle">{hint}</span>}
      </dt>
      {trend !== null && Number.isFinite(trend) && prior !== 0 && <span className="hidden text-xs tabular-nums text-fg-subtle sm:inline">last month {formatPrice(prior!)}</span>}
      <dd className={cn("w-32 shrink-0 text-right tabular-nums", strong ? "font-semibold text-fg" : "text-fg", strong && value < 0 && "text-danger-600")}>{formatPrice(value)}</dd>
    </div>
  );
}

/** Owner's books §2: where every taka is — cash by the person holding it, banks and wallets, what couriers and gateways
 * still owe (net of the charges booked against it), ad accounts — then what else is yours and what you owe. */
function MoneyMapView({ map }: { map: MoneyMap }) {
  const t = map.totals;
  const link = (a: MoneyMap["accounts"][number]) => `/admin/finance/accounts/${a.id}`;
  const banks = map.accounts.filter((a) => !a.clearing && (a.kind === "BANK" || a.kind === "MOBILE_WALLET" || a.kind === "OTHER"));
  const owedToYou = [
    { label: "Steadfast (after its charges)", value: t.courierReceivable, href: "/admin/finance/courier" },
    { label: "Payment gateways (after fees)", value: t.gatewayReceivable, href: "/admin/finance/settlements" },
    { label: "Payments recorded, not banked", value: t.otherReceivable, href: "/admin/finance/settlements" },
  ].filter((x) => x.value !== 0);
  const alsoYours = [
    { label: "Stock (at cost)", value: t.inventory, href: "/admin/finance/inventory-cutover" },
    { label: "Prepaid, not used yet", value: t.prepaid, href: "/admin/finance/prepaid" },
    { label: "Paid ahead to ad accounts", value: Math.max(0, t.adAccounts), href: "/admin/finance/ads" },
    { label: "In production", value: t.workInProgress, href: "/admin/manufacturing" },
  ].filter((x) => x.value !== 0);
  const youOwe = [
    { label: "Suppliers", value: t.suppliersOwed + t.goodsNotInvoiced, href: "/admin/finance/payables" },
    { label: "Owner, to repay", value: t.ownerToRepay, href: "/admin/finance/expenses" },
    { label: "Ad platforms (spent more than paid in)", value: Math.max(0, -t.adAccounts), href: "/admin/finance/ads" },
    { label: "Loans", value: t.loans, href: "/admin/finance/loans" },
    { label: "Customers' store credit", value: t.storeCredit, href: "/admin/finance/statements" },
    { label: "VAT", value: t.vatOwed, href: "/admin/finance/statements" },
  ].filter((x) => x.value !== 0);
  return (
    <div className="space-y-6" data-testid="money-map">
      <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
        <MapColumn title="Cash, by who holds it" total={t.cash} rows={map.cashByPerson.map((p) => ({ label: p.custodian?.name ?? "Not given to anyone", sub: p.accounts.map((a) => a.name).join(", "), value: p.total, href: p.accounts.length === 1 ? link(p.accounts[0]!) : "/admin/finance/accounts" }))} empty="No cash accounts." />
        <MapColumn title="Banks & wallets" total={t.bank + t.wallets + t.otherMoney} rows={banks.map((a) => ({ label: a.name, sub: KIND_LABEL[a.kind], value: a.balance, href: link(a) }))} empty="No bank or wallet accounts." />
        <MapColumn title="Still owed to you" total={owedToYou.reduce((s, x) => s + x.value, 0)} rows={owedToYou} empty="Nothing waiting with couriers or gateways." />
        <MapColumn title="Also yours" total={alsoYours.reduce((s, x) => s + x.value, 0)} rows={alsoYours} empty="—" />
      </div>
      {youOwe.length > 0 && (
        <div className="border-t border-line-subtle pt-4">
          <MapColumn title="You owe" total={youOwe.reduce((s, x) => s + x.value, 0)} rows={youOwe} empty="" />
        </div>
      )}
    </div>
  );
}

function MapColumn({ title, total, rows, empty }: { title: string; total: number; rows: Array<{ label: string; sub?: string; value: number; href: string }>; empty: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-line-subtle pb-2">
        <h3 className="text-[13px] font-medium text-fg-muted">{title}</h3>
        <span className="text-sm font-semibold tabular-nums text-fg">{formatPrice(total)}</span>
      </div>
      <ul className="divide-y divide-line-subtle">
        {rows.map((r) => (
          <li key={r.label}>
            <Link href={r.href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.04]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{r.label}</span>
                {r.sub && <span className="block truncate text-xs text-fg-subtle">{r.sub}</span>}
              </span>
              <span className={cn("w-28 shrink-0 text-right text-sm tabular-nums", r.value < 0 ? "text-danger-600" : "text-fg")}>{formatPrice(r.value)}</span>
            </Link>
          </li>
        ))}
        {rows.length === 0 && empty && <li className="py-2.5 text-xs text-fg-subtle">{empty}</li>}
      </ul>
    </div>
  );
}
