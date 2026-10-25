"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, Megaphone, Pencil, Plus, ShoppingBag, TrendingUp } from "lucide-react";
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
import type { AdCampaign, UnlinkedAdTag } from "@/lib/api/finance-books";
import { formatBookDate, formatPrice, formatPriceWhole } from "@/lib/format";

const today = () => new Date().toLocaleDateString("en-CA");

/** Visitors arrive from Meta with the campaign's id as utm_campaign. Until a campaign carries that id, its orders can't be
 * counted (it shows 0 orders) — this card names each unclaimed id with what it brought, and links it in one step. */
function UnlinkedTags({ tags, campaigns, canLink, onLinked }: { tags: UnlinkedAdTag[]; campaigns: AdCampaign[]; canLink: boolean; onLinked: () => void }) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  const link = useMutation({
    mutationFn: ({ tag, campaignId }: { tag: string; campaignId: string }) => booksApi.updateCampaign(campaignId, { externalId: tag }),
    onSuccess: () => { toast.success("Linked — its orders now count for the campaign"); onLinked(); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't link the tag")),
  });
  const open = campaigns.filter((c) => !c.externalId);
  return (
    <Card className="p-0" data-testid="unlinked-ad-tags">
      <div className="space-y-1 px-5 pt-4 sm:px-6">
        <h2 className="text-[15px] font-semibold text-fg">Ad visits not linked to a campaign</h2>
        <p className="text-sm text-fg-muted">Meta sends each campaign&rsquo;s id with the visit. Pick the campaign each id belongs to and its orders start counting (find the id in Ads Manager › Campaign ID).</p>
      </div>
      <ul className="mt-3 divide-y divide-line-subtle border-t border-line-subtle">
        {tags.map((t) => (
          <li key={t.tag} className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6">
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[13px] text-fg">{t.tag}</span>
              <span className="block text-xs text-fg-muted tabular-nums">{t.sessions.toLocaleString("en-US")} visits · {t.orders} order{t.orders === 1 ? "" : "s"}</span>
            </span>
            {canLink && open.length > 0 && (
              <span className="flex w-full gap-2 sm:w-auto">
                <Select aria-label={`Campaign for ${t.tag}`} className="min-w-0 flex-1 sm:w-56" value={choice[t.tag] ?? ""} onChange={(e) => setChoice((c) => ({ ...c, [t.tag]: e.target.value }))}>
                  <option value="">Choose campaign…</option>
                  {open.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Button size="sm" variant="outline" disabled={!choice[t.tag]} loading={link.isPending && link.variables?.tag === t.tag} onClick={() => link.mutate({ tag: t.tag, campaignId: choice[t.tag]! })}>Link</Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

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
  const [importing, setImporting] = useState(false);
  const settings = useQuery({ queryKey: booksApi.centerKeys.settings(), queryFn: booksApi.getCenterSettings, enabled: allowed });
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
            <Button size="sm" variant="outline" onClick={() => setImporting(true)} disabled={!adAccounts.length} data-testid="import-ad-csv"><FileUp className="h-4 w-4" /> Import CSV</Button>
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
            <StatTile label="Spent in the period" value={formatPriceWhole(Math.round(d.totals.spend))} icon={<Megaphone />} tone="accent" />
            <StatTile label="Orders from the ads" value={String(d.totals.orders)} icon={<ShoppingBag />} />
            <StatTile label="Sales from the ads" value={formatPriceWhole(Math.round(d.totals.revenue))} icon={<TrendingUp />} />
          </section>
          {(d.unlinkedTags?.length ?? 0) > 0 && d.campaigns.length > 0 && (
            <UnlinkedTags tags={d.unlinkedTags!} campaigns={d.campaigns} canLink={can("finance.transact")} onLinked={refresh} />
          )}
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
                        {c.foreignSpend?.map((f) => <span key={f.currency} className="block text-xs text-fg-muted">{f.currency} {f.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>)}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">{c.orders}</TableCell>
                      <TableCell align="right" className="tabular-nums">{c.costPerOrder === null ? "—" : formatPrice(c.costPerOrder)}</TableCell>
                      <TableCell align="right" className="tabular-nums">{c.roas === null ? "—" : `${c.roas}×`}</TableCell>
                      <TableCell align="right">
                        {can("finance.transact") && (
                          <span className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setSpendFor(c)}>Add spend</Button>
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
          <p className="text-xs text-fg-muted">Orders count when the shopper arrived through the campaign (utm_campaign = its id or name) or landed on its page. Profit after ads, by day and per order, is in <Link href="/admin/finance/profit" className="text-accent hover:underline">Profit</Link>.</p>
        </>
      )}
      {editing && <CampaignModal campaign={editing === "new" ? null : editing} adAccounts={adAccounts} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}
      {spendFor && <SpendModal campaign={spendFor} defaultRate={settings.data?.defaultUsdRate ?? null} onClose={() => setSpendFor(null)} onDone={() => { setSpendFor(null); refresh(); }} />}
      {importing && <CsvModal adAccounts={adAccounts} defaultRate={settings.data?.defaultUsdRate ?? null} onClose={() => setImporting(false)} onDone={() => { setImporting(false); refresh(); }} />}
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
  const [budgetFrom, setBudgetFrom] = useState(today());
  const budgetChanged = Boolean(campaign) && ((budgetType || null) !== campaign!.budgetType || (budgetType ? Number(budget) : null) !== campaign!.budget);
  const body = {
    name: name.trim(), startDate: start, endDate: end || null, budgetType: budgetType || null, budget: budgetType ? Number(budget) : null,
    externalId: externalId.trim() || null, landingPath: landing.trim() || null, isActive: active, ...(budgetChanged ? { budgetFrom } : {}),
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
        {budgetChanged && (
          <Field htmlFor="cp-bfrom" label="New budget from" hint="Days before keep the old budget" className="sm:col-span-2">
            <Input id="cp-bfrom" type="date" value={budgetFrom} min={start} max={today()} onChange={(e) => setBudgetFrom(e.target.value)} />
          </Field>
        )}
        {campaign?.budgetHistory && campaign.budgetHistory.length > 1 && (
          <div className="sm:col-span-2 text-xs text-fg-muted">
            <p className="font-medium text-fg">Budget history</p>
            <ul className="mt-1 space-y-0.5">{campaign.budgetHistory.map((b) => <li key={b.from} className="tabular-nums">From {formatBookDate(b.from)}: {b.budget === null ? "no budget" : `${formatPrice(b.budget)}${b.budgetType === "DAILY" ? " a day" : " in all"}`}</li>)}</ul>
          </div>
        )}
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

function SpendModal({ campaign, defaultRate, onClose, onDone }: { campaign: AdCampaign; defaultRate: number | null; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString("en-CA");
  });
  const [mode, setMode] = useState<"DAY" | "PERIOD">("DAY");
  const [from, setFrom] = useState(campaign.startDate);
  const [to, setTo] = useState(today());
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"LOCAL" | "USD">("USD");
  const [rate, setRate] = useState("");
  const [charged, setCharged] = useState("");
  const usd = currency === "USD";
  const period = mode === "PERIOD";
  const effectiveRate = rate ? Number(rate) : defaultRate;
  const valid = amount !== "" && Number(amount) >= 0 && (!usd || charged !== "" || (effectiveRate ?? 0) > 0) && (!period || (from !== "" && to !== "" && from <= to));
  const money = usd ? { originalAmount: Number(amount), currency: "USD", fxRate: rate ? Number(rate) : null, amount: charged ? Number(charged) : null } : { amount: Number(amount) };
  const save = useMutation({
    mutationFn: async () => {
      if (!period) {
        await booksApi.recordDaySpend(campaign.id, { date, ...money });
        return "Spend saved — it replaces the budget for that day";
      }
      const r = await booksApi.recordPeriodSpend(campaign.id, { from, to, ...money });
      return `${formatPrice(r.shared)} shared over ${r.sharedDays} day(s)${r.ownDays ? `; ${r.ownDays} day(s) kept their own figure` : ""}`;
    },
    onSuccess: (message) => { toast.success(message); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The spend couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={`What ${campaign.name} spent`}
      description={period ? "A total from Ads Manager or the card statement. Days that already have their own figure keep it; the rest is shared evenly over the other days." : "From Ads Manager, for one day. It replaces that day's budget in the books."}
      widthClassName="max-w-sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-day-spend">Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="sp-mode" label="For" className="sm:col-span-2">
          <Select id="sp-mode" value={mode} onChange={(e) => setMode(e.target.value as "DAY" | "PERIOD")}><option value="DAY">One day</option><option value="PERIOD">A period (total)</option></Select>
        </Field>
        {period ? (
          <>
            <Field htmlFor="sp-from" label="From"><Input id="sp-from" type="date" value={from} min={campaign.startDate} max={to || today()} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field htmlFor="sp-to" label="To"><Input id="sp-to" type="date" value={to} min={from} max={campaign.endDate && campaign.endDate < today() ? campaign.endDate : today()} onChange={(e) => setTo(e.target.value)} /></Field>
          </>
        ) : (
          <Field htmlFor="sp-date" label="Day"><Input id="sp-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        )}
        <Field htmlFor="sp-cur" label="Currency" className={period ? "sm:col-span-2" : undefined}>
          <Select id="sp-cur" value={currency} onChange={(e) => setCurrency(e.target.value as "LOCAL" | "USD")}><option value="USD">USD (as Ads Manager shows)</option><option value="LOCAL">Taka</option></Select>
        </Field>
        <Field htmlFor="sp-amount" label={`${period ? "Total spent" : "Spent"} (${usd ? "USD" : "taka"})`} required className="sm:col-span-2"><Input id="sp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        {usd && (
          <>
            <Field htmlFor="sp-rate" label="Taka per USD" hint={defaultRate ? `Empty = default ${defaultRate} (marked an estimate)` : "Or set a default in Owner's summary › Settings"}>
              <Input id="sp-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={defaultRate ? String(defaultRate) : ""} />
            </Field>
            <Field htmlFor="sp-charged" label="Taka charged on the card" hint="From the statement — exact, wins over the rate">
              <Input id="sp-charged" inputMode="decimal" value={charged} onChange={(e) => setCharged(e.target.value)} />
            </Field>
            {amount !== "" && !charged && (effectiveRate ?? 0) > 0 && <p className="text-xs text-fg-muted sm:col-span-2">≈ {formatPrice(Math.round(Number(amount) * effectiveRate! * 100) / 100)} in the books{rate ? "" : " (estimate at the default rate)"}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}

function CsvModal({ adAccounts, defaultRate, onClose, onDone }: { adAccounts: financeApi.FinancialAccount[]; defaultRate: number | null; onClose: () => void; onDone: () => void }) {
  const [accountId, setAccountId] = useState(adAccounts[0]?.id ?? "");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [rate, setRate] = useState("");
  const body = { financialAccountId: accountId, csv, currency: "USD", fxRate: rate ? Number(rate) : null };
  const preview = useMutation({ mutationFn: () => booksApi.importAdCsv({ ...body, commit: false }), onError: (e) => toast.error(getErrorMessage(e, "The file couldn't be read")) });
  const commit = useMutation({
    mutationFn: () => booksApi.importAdCsv({ ...body, commit: true }),
    onSuccess: (r) => { toast.success(`Imported: ${r.new} new day(s), ${r.replace} replaced, ${r.same} unchanged`); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "Nothing was imported")),
  });
  const p = preview.data;
  const reset = () => preview.reset();
  return (
    <Modal open onClose={onClose} title="Import ad spend (CSV)" description="Export from Ads Manager with Day, Campaign name, Campaign ID and Amount spent. Check the preview, then import — all rows or none." widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>{p ? <Button disabled={p.errors.length > 0 || p.rows === 0} loading={commit.isPending} onClick={() => commit.mutate()} data-testid="commit-ad-csv">Import {p.rows} row(s)</Button> : <Button disabled={!accountId || !csv} loading={preview.isPending} onClick={() => preview.mutate()} data-testid="preview-ad-csv">Preview</Button>}</>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="csv-acc" label="Ad account" required>
            <Select id="csv-acc" value={accountId} onChange={(e) => { setAccountId(e.target.value); reset(); }}>{adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </Field>
          <Field htmlFor="csv-rate" label="Taka per USD" hint={defaultRate ? `Empty = default ${defaultRate} (marked an estimate)` : "Needed for USD amounts"}>
            <Input id="csv-rate" inputMode="decimal" value={rate} onChange={(e) => { setRate(e.target.value); reset(); }} placeholder={defaultRate ? String(defaultRate) : ""} />
          </Field>
          <Field htmlFor="csv-file" label="File" className="sm:col-span-2" hint={fileName || "A .csv file"}>
            <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setFileName(f.name); setCsv(await f.text()); reset(); }} />
          </Field>
        </div>
        {p && (
          <div className="space-y-3" data-testid="ad-csv-preview">
            <p className="text-sm text-fg">
              {p.rows} row(s) · <span className="tabular-nums">{formatPrice(p.total)}</span> · {p.new} new · {p.replace} replace · {p.same} unchanged
              {p.newCampaigns.length > 0 && <> · new campaign(s): {p.newCampaigns.join(", ")}</>}
              {p.estimated > 0 && <> · {p.estimated} at the default rate (estimate)</>}
            </p>
            {p.errors.length > 0 && (
              <Alert variant="danger" title={`${p.errors.length} line(s) can't be read — fix the file, nothing is imported until then`}>
                <ul className="list-disc pl-5">{p.errors.slice(0, 8).map((e) => <li key={e.line}>Line {e.line}: {e.error}</li>)}</ul>
              </Alert>
            )}
            <div className="max-h-64 overflow-auto rounded-lg border border-line">
              <Table>
                <TableHead><tr><TableHeaderCell>Day</TableHeaderCell><TableHeaderCell>Campaign</TableHeaderCell><TableHeaderCell align="right">Spend</TableHeaderCell><TableHeaderCell align="right">Taka</TableHeaderCell><TableHeaderCell /></tr></TableHead>
                <tbody>
                  {p.lines.map((l) => (
                    <TableRow key={l.line}>
                      <TableCell className="whitespace-nowrap">{formatBookDate(l.date)}</TableCell>
                      <TableCell>{l.campaign}</TableCell>
                      <TableCell align="right" className="tabular-nums">{l.currency} {l.spend.toFixed(2)}</TableCell>
                      <TableCell align="right" className="tabular-nums">{formatPrice(l.amount)}{l.previous !== null && l.action === "REPLACE" && <span className="block text-xs text-fg-muted">was {formatPrice(l.previous)}</span>}</TableCell>
                      <TableCell><Badge variant={l.action === "NEW" ? "success" : l.action === "REPLACE" ? "warning" : "neutral"}>{l.action === "NEW" ? "new" : l.action === "REPLACE" ? "replace" : "same"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
