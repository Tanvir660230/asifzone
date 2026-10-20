"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Megaphone, Pencil, Plus, ShoppingBag, TrendingUp } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import type { AdCampaign } from "@/lib/api/finance-books";
import { formatBookDate, formatPrice } from "@/lib/format";

const today = () => new Date().toLocaleDateString("en-CA");

/** Owner's books §5: every campaign's daily spend — Meta's actual figure when connected, else the budget for the day —
 * booked out of the ad account, with the orders it brought and profit after ads. */
export default function AdSpendPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const t = today();
  const [from, setFrom] = useState(`${t.slice(0, 7)}-01`);
  const [to, setTo] = useState(t);
  const period = { from: from || undefined, to: to || undefined };
  const list = useQuery({ queryKey: booksApi.booksKeys.campaigns(period), queryFn: () => booksApi.listCampaigns(period), enabled: allowed && !(from && to && from > to) });
  const accounts = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts, enabled: allowed });
  const adAccounts = (accounts.data?.financialAccounts ?? []).filter((a) => a.kind === "AD_PLATFORM" && a.isActive);
  const [editing, setEditing] = useState<AdCampaign | "new" | null>(null);
  const [spendFor, setSpendFor] = useState<AdCampaign | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finance"] });
  const meta = useMutation({
    mutationFn: () => booksApi.importMetaSpend({ days: 7 }),
    onSuccess: (r) => {
      refresh();
      const bad = r.accounts.filter((a) => a.error);
      if (bad.length) toast.error(bad.map((a) => `${a.adAccountId}: ${a.error}`).join(" · "));
      else toast.success(`Meta spend brought in: ${r.accounts.reduce((s, a) => s + a.days, 0)} campaign-days`);
    },
    onError: (e) => toast.error(getErrorMessage(e, "Meta's spend couldn't be read")),
  });

  if (ready && !allowed) return <div><ModuleTabs /><EmptyState icon={Megaphone} title="Ad spend isn't available to your role" /></div>;
  const d = list.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Ad spend"
        description="Each campaign's daily spend comes out of its ad account — Meta's real figure when connected, otherwise the budget until you enter what was spent."
        action={can("finance.transact") && (
          <div className="flex flex-wrap gap-2" data-phone-row>
            {d?.meta.connected && <Button size="sm" variant="outline" loading={meta.isPending} onClick={() => meta.mutate()} data-testid="import-meta"><Download className="h-4 w-4" /> Bring in Meta spend</Button>}
            <Button size="sm" onClick={() => setEditing("new")} disabled={!adAccounts.length} data-testid="new-campaign"><Plus className="h-4 w-4" /> Campaign</Button>
          </div>
        )}
      />

      {accounts.data && adAccounts.length === 0 && (
        <Alert variant="info" title="Add your ad account first">
          Create a money account of type <strong>Ad account</strong> in <Link href="/admin/finance/accounts?new=account" className="text-accent hover:underline">Money accounts</Link> (for Meta, its reference is the ad account id, act_…). Top it up with a transfer from bKash or the bank; spend is taken out of it day by day.
        </Alert>
      )}
      {d && !d.meta.connected && (
        <p className="text-sm text-fg-muted">Tip: connect <Link href="/admin/settings?pane=integrations" className="text-accent hover:underline">Meta ad spend</Link> in Settings › Integrations and the real daily spend comes in by itself.</p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="ads-from" label="From" className="w-40"><Input id="ads-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field htmlFor="ads-to" label="To" className="w-40" error={from && to && from > to ? "Before From" : undefined}><Input id="ads-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>

      {list.isLoading && <Skeleton className="h-40 w-full" />}
      {list.isError && <Alert variant="danger" title="Campaigns couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>}>{getErrorMessage(list.error, "")}</Alert>}
      {d && (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Totals">
            <StatTile label="Spent in the period" value={formatPrice(Math.round(d.totals.spend))} icon={<Megaphone />} tone="accent" />
            <StatTile label="Orders from the ads" value={String(d.totals.orders)} icon={<ShoppingBag />} />
            <StatTile label="Sales from the ads" value={formatPrice(Math.round(d.totals.revenue))} icon={<TrendingUp />} />
          </section>
          {d.campaigns.length === 0 ? (
            <EmptyState icon={Megaphone} title="No campaigns yet" description="Add a campaign with its budget — or connect Meta and they come in by themselves." />
          ) : (
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Campaign</TableHeaderCell>
                    <TableHeaderCell align="right">Spend</TableHeaderCell>
                    <TableHeaderCell align="right">Orders</TableHeaderCell>
                    <TableHeaderCell align="right">Cost / order</TableHeaderCell>
                    <TableHeaderCell align="right">Sales ÷ spend</TableHeaderCell>
                    <TableHeaderCell />
                  </tr>
                </TableHead>
                <tbody>
                  {d.campaigns.map((c) => (
                    <TableRow key={c.id} data-testid="campaign-row">
                      <TableCell>
                        <span className="block font-medium text-fg">{c.name} {!c.isActive && <Badge>paused</Badge>}</span>
                        <span className="block text-xs text-fg-muted">
                          {c.adAccount.name} · {formatBookDate(c.startDate)}{c.endDate ? ` → ${formatBookDate(c.endDate)}` : ""}
                          {c.budgetType ? ` · ${c.budgetType === "DAILY" ? `${formatPrice(c.budget!)} a day` : `${formatPrice(c.budget!)} in all`}` : ""}
                        </span>
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatPrice(c.spend)}
                        {c.plannedSpend > 0 && <span className="block text-xs text-fg-muted">{formatPrice(c.plannedSpend)} from budget</span>}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">{c.orders}</TableCell>
                      <TableCell align="right" className="tabular-nums">{c.costPerOrder === null ? "—" : formatPrice(c.costPerOrder)}</TableCell>
                      <TableCell align="right" className="tabular-nums">{c.roas === null ? "—" : `${c.roas}×`}</TableCell>
                      <TableCell align="right">
                        {can("finance.transact") && (
                          <span className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setSpendFor(c)}>Day’s spend</Button>
                            <Button size="sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil className="h-4 w-4" /></Button>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          <p className="text-xs text-fg-muted">Orders count when the shopper arrived through the campaign (utm_campaign = its id or name) or landed on its page. Profit after ads per order is in <Link href="/admin/finance/profit" className="text-accent hover:underline">Profit by order & product</Link>.</p>
        </>
      )}
      {editing && <CampaignModal campaign={editing === "new" ? null : editing} adAccounts={adAccounts} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}
      {spendFor && <SpendModal campaign={spendFor} onClose={() => setSpendFor(null)} onDone={() => { setSpendFor(null); refresh(); }} />}
    </div>
  );
}

function CampaignModal({ campaign, adAccounts, onClose, onDone }: { campaign: AdCampaign | null; adAccounts: financeApi.FinancialAccount[]; onClose: () => void; onDone: () => void }) {
  const [accountId, setAccountId] = useState(campaign?.adAccount.id ?? adAccounts[0]?.id ?? "");
  const [name, setName] = useState(campaign?.name ?? "");
  const [start, setStart] = useState(campaign?.startDate ?? today());
  const [end, setEnd] = useState(campaign?.endDate ?? "");
  const [budgetType, setBudgetType] = useState<"" | "DAILY" | "LIFETIME">(campaign?.budgetType ?? "DAILY");
  const [budget, setBudget] = useState(campaign?.budget ? String(campaign.budget) : "");
  const [externalId, setExternalId] = useState(campaign?.externalId ?? "");
  const [landing, setLanding] = useState(campaign?.landingPath ?? "");
  const [active, setActive] = useState(campaign?.isActive ?? true);
  const body = {
    name: name.trim(), startDate: start, endDate: end || null, budgetType: budgetType || null, budget: budgetType ? Number(budget) : null,
    externalId: externalId.trim() || null, landingPath: landing.trim() || null, isActive: active,
  };
  const valid = Boolean(name.trim() && start && (campaign || accountId)) && (!budgetType || Number(budget) > 0) && (budgetType !== "LIFETIME" || Boolean(end)) && (!end || end >= start);
  const save = useMutation({
    mutationFn: () => (campaign ? booksApi.updateCampaign(campaign.id, body) : booksApi.createCampaign({ ...body, financialAccountId: accountId })),
    onSuccess: (c) => { toast.success(`${c.name} saved`); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The campaign couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={campaign ? `Edit ${campaign.name}` : "New campaign"} description="Its budget books spend for each day until the real figure is known." widthClassName="max-w-lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-campaign">Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {!campaign && (
          <Field htmlFor="cp-acc" label="Ad account" required className="sm:col-span-2">
            <Select id="cp-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </Field>
        )}
        <Field htmlFor="cp-name" label="Name" required className="sm:col-span-2"><Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="Cap launch — Dhaka" /></Field>
        <Field htmlFor="cp-start" label="Starts" required><Input id="cp-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field htmlFor="cp-end" label="Ends" hint={budgetType === "LIFETIME" ? "Needed to spread a total budget" : "Leave empty while it runs"}><Input id="cp-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field htmlFor="cp-btype" label="Budget">
          <Select id="cp-btype" value={budgetType} onChange={(e) => setBudgetType(e.target.value as "" | "DAILY" | "LIFETIME")}>
            <option value="DAILY">Per day</option>
            <option value="LIFETIME">Total for the campaign</option>
            <option value="">None (only actual spend)</option>
          </Select>
        </Field>
        {budgetType && <Field htmlFor="cp-budget" label={budgetType === "DAILY" ? "Amount a day" : "Total amount"} required><Input id="cp-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></Field>}
        <Field htmlFor="cp-ext" label="Meta campaign id" hint="Links Meta's spend and utm_campaign to it"><Input id="cp-ext" value={externalId} onChange={(e) => setExternalId(e.target.value)} maxLength={64} /></Field>
        <Field htmlFor="cp-landing" label="Landing page" hint="e.g. /lp/cap — orders that land there count for it"><Input id="cp-landing" value={landing} onChange={(e) => setLanding(e.target.value)} maxLength={200} /></Field>
        {campaign && (
          <Field htmlFor="cp-active" label="Status" hint="A paused campaign books no more budget">
            <Select id="cp-active" value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}><option value="1">Running</option><option value="0">Paused / ended</option></Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function SpendModal({ campaign, onClose, onDone }: { campaign: AdCampaign; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString("en-CA");
  });
  const [amount, setAmount] = useState("");
  const save = useMutation({
    mutationFn: () => booksApi.recordDaySpend(campaign.id, { date, amount: Number(amount) }),
    onSuccess: () => { toast.success("Spend saved — it replaces the budget for that day"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The spend couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={`What ${campaign.name} spent`} description="From Ads Manager, for one day. It replaces that day's budget in the books." widthClassName="max-w-sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={amount === "" || !(Number(amount) >= 0)} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-day-spend">Save</Button></>}>
      <div className="grid gap-3">
        <Field htmlFor="sp-date" label="Day"><Input id="sp-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="sp-amount" label="Spent" required><Input id="sp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
      </div>
    </Modal>
  );
}
