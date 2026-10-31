"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { DepreciationMethod, FixedAsset } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";
import { PermissionState } from "@/components/admin/permission-state";
import { todayLocal } from "@/lib/datetime-local";

/** Fixed assets (docs/FINANCE_FIXED_ASSETS.md): what the business owns and uses for years — cost, depreciation month by
 * month, book value — and the monthly run that books it. The register always equals the fixed-asset accounts. */
export default function FixedAssetsPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const [showDisposed, setShowDisposed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [disposing, setDisposing] = useState<FixedAsset | null>(null);
  const [reversing, setReversing] = useState(false);
  const q = useQuery({ queryKey: financeApi.assetKeys.register({ showDisposed }), queryFn: () => financeApi.getAssetRegister(showDisposed), enabled: allowed });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finance"] });
  const run = useMutation({
    mutationFn: (periodKey: string) => financeApi.runDepreciation(periodKey),
    onSuccess: (r) => { refresh(); toast.success(`Depreciation for ${r.run.periodKey} posted: ${formatPrice(r.run.total)}`); },
    onError: (err) => toast.error(getErrorMessage(err, "Depreciation couldn't be run")),
  });
  const reverse = useMutation({
    mutationFn: (reason: string) => financeApi.reverseLatestDepreciation(reason),
    onSuccess: (r) => { refresh(); setReversing(false); toast.success(`Depreciation for ${r.periodKey} reversed`); },
    onError: (err) => toast.error(getErrorMessage(err, "The run couldn't be reversed")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <PermissionState icon={Building2} page="Fixed assets" />
      </div>
    );
  }
  const d = q.data;
  const latest = d?.runs.find((r) => r.status === "POSTED");
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Fixed assets"
        description="Equipment, computers, furniture and vehicles — what they cost, how they depreciate and what they are worth in the books."
        action={can("finance.transact") && <Button size="sm" onClick={() => setAdding(true)} data-testid="new-asset"><Plus className="h-4 w-4" /> Register asset</Button>}
      />
      {q.isLoading && <Skeleton className="h-48 w-full" />}
      {q.isError && <Alert variant="danger" title="The register couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>}
      {d && (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Cost" value={formatPrice(d.totals.cost)} hint={`${d.totals.assets} asset${d.totals.assets === 1 ? "" : "s"} in use`} />
            <Stat label="Depreciated so far" value={formatPrice(d.totals.accumulatedDepreciation)} />
            <Stat label="Book value" value={formatPrice(d.totals.bookValue)} strong />
            <Stat label="Next month's charge" value={formatPrice(d.nextRunCharge)} hint={d.nextRun ? `for ${d.nextRun}` : "Up to date"} />
          </dl>

          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <p className="font-medium text-ink-900">Monthly depreciation</p>
              <p className="text-ink-600">{latest ? `Posted through ${latest.periodKey}.` : "Not run yet."} {d.nextRun ? `${d.nextRun} is ready to run.` : "Nothing to run until next month starts."}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {latest && can("finance.reverse") && <Button size="sm" variant="ghost" onClick={() => setReversing(true)}>Reverse {latest.periodKey}</Button>}
              {d.nextRun && can("finance.post") && <Button size="sm" loading={run.isPending} onClick={() => run.mutate(d.nextRun!)} data-testid="run-depreciation">Run {d.nextRun}</Button>}
            </div>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink-900">Register</h2>
            <label className="flex items-center gap-2 text-sm text-ink-700"><Checkbox checked={showDisposed} onChange={(e) => setShowDisposed(e.target.checked)} /> Show disposed</label>
          </div>
          {d.assets.length ? (
            <Card className="overflow-hidden p-0">
              <HScrollShadow>
                <Table>
                  <TableHead>
                    <tr><TableHeaderCell>Asset</TableHeaderCell><TableHeaderCell>Acquired</TableHeaderCell><TableHeaderCell align="right">Cost</TableHeaderCell><TableHeaderCell align="right">Depreciated</TableHeaderCell><TableHeaderCell align="right">Book value</TableHeaderCell><TableHeaderCell>Schedule</TableHeaderCell><TableHeaderCell /></tr>
                  </TableHead>
                  <tbody>
                    {d.assets.map((a) => (
                      <TableRow key={a.id} data-testid="asset-row">
                        <TableCell className="min-w-56"><span className="font-mono text-xs text-ink-500">{a.number}</span> {a.name}<span className="block text-xs text-ink-500">{a.assetAccount.code} {a.assetAccount.name}{a.location ? ` · ${a.location}` : ""}</span></TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{a.acquisitionDate}</TableCell>
                        <TableCell align="right" className="tabular-nums">{formatPrice(a.cost)}</TableCell>
                        <TableCell align="right" className="tabular-nums">{formatPrice(a.accumulatedDepreciation)}</TableCell>
                        <TableCell align="right" className="font-medium tabular-nums">{formatPrice(a.bookValue)}</TableCell>
                        <TableCell className="min-w-44 text-sm">
                          {a.status === "DISPOSED" ? (
                            <><Badge variant="neutral">disposed</Badge> <span className="text-xs text-ink-500">{a.disposedAt} · {a.disposalGainLoss !== null && a.disposalGainLoss >= 0 ? "gain" : "loss"} {formatPrice(Math.abs(a.disposalGainLoss ?? 0))}</span></>
                          ) : a.nextCharge ? (
                            <span className="text-ink-700">{formatPrice(a.nextCharge.amount)} a month · until {a.fullyDepreciatedBy}<span className="block text-xs text-ink-500">{a.method === "STRAIGHT_LINE" ? "straight line" : `declining ${a.decliningRatePct}% a year`}</span></span>
                          ) : (
                            <span className="text-ink-500">fully depreciated</span>
                          )}
                        </TableCell>
                        <TableCell align="right">{a.status === "IN_USE" && can("finance.post") && <Button size="sm" variant="ghost" onClick={() => setDisposing(a)}>Dispose</Button>}</TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </HScrollShadow>
            </Card>
          ) : (
            <EmptyState icon={Building2} title="No fixed assets yet" description="Register equipment once its cost is in the books — from a supplier bill, a payment or the opening balances." />
          )}
          {d.runs.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-ink-900">Depreciation runs</h2>
              <Card className="divide-y divide-line p-0 text-sm">
                {d.runs.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span><span className="tabular-nums text-ink-900">{r.periodKey}</span> <span className="text-ink-500">· {r.assets} asset{r.assets === 1 ? "" : "s"}{r.reversalReason ? ` · reversed: ${r.reversalReason}` : ""}</span></span>
                    <span className="flex items-center gap-2"><span className={r.status === "POSTED" ? "tabular-nums text-ink-900" : "tabular-nums text-ink-500 line-through"}>{formatPrice(r.total)}</span><Badge variant={r.status === "POSTED" ? "success" : "neutral"}>{r.status === "POSTED" ? "posted" : "reversed"}</Badge></span>
                  </div>
                ))}
              </Card>
            </section>
          )}
        </>
      )}
      {adding && <AssetModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
      {disposing && <DisposeModal asset={disposing} onClose={() => setDisposing(null)} onDone={() => { setDisposing(null); refresh(); }} />}
      {reversing && latest && <ReasonModal title={`Reverse depreciation for ${latest.periodKey}`} hint="Its journal is reversed; the month can then be run again." loading={reverse.isPending} onClose={() => setReversing(false)} onConfirm={(reason) => reverse.mutate(reason)} />}
    </div>
  );
}

function AssetModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart });
  const assetAccounts = useMemo(() => (chart.data?.accounts ?? []).filter((a) => a.type === "ASSET" && a.isPostable && a.isActive && a.normalBalance === "DEBIT" && a.code.startsWith("18")), [chart.data]);
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(() => todayLocal());
  const [cost, setCost] = useState("");
  const [residual, setResidual] = useState("");
  const [life, setLife] = useState("36");
  const [method, setMethod] = useState<DepreciationMethod>("STRAIGHT_LINE");
  const [rate, setRate] = useState("");
  const [source, setSource] = useState("SUPPLIER_INVOICE");
  const [sourceRef, setSourceRef] = useState("");
  const [location, setLocation] = useState("");
  const valid = name.trim().length >= 2 && Boolean(accountId) && Number(cost) > 0 && Number(life) >= 1 && (method === "STRAIGHT_LINE" || Number(rate) > 0) && (residual === "" || Number(residual) < Number(cost));
  const save = useMutation({
    mutationFn: () => financeApi.createAsset({ name: name.trim(), assetAccountId: accountId, acquisitionDate: date, cost: Number(cost), residualValue: residual ? Number(residual) : 0, usefulLifeMonths: Number(life), method, decliningRatePct: method === "DECLINING_BALANCE" ? Number(rate) : null, sourceType: source, sourceRef: sourceRef.trim() || null, location: location.trim() || null }),
    onSuccess: (a) => { toast.success(`${a.number} registered`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The asset couldn't be registered")),
  });
  return (
    <Modal open onClose={onClose} title="Register a fixed asset" description="Its cost must already be on the asset account (a supplier bill, a payment or the opening balances)." widthClassName="max-w-xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="confirm-asset">Register</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="fa-name" label="Name" required className="sm:col-span-2"><Input id="fa-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Embroidery machine" maxLength={160} /></Field>
        <Field htmlFor="fa-acc" label="Asset account" required>
          <Select id="fa-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose…</option>
            {assetAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </Select>
        </Field>
        <Field htmlFor="fa-date" label="Acquired on" required><Input id="fa-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="fa-cost" label="Cost" required><Input id="fa-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Field htmlFor="fa-res" label="Residual value" hint="What it should be worth at the end"><Input id="fa-res" inputMode="decimal" value={residual} onChange={(e) => setResidual(e.target.value)} placeholder="0" /></Field>
        <Field htmlFor="fa-life" label="Useful life (months)" required><Input id="fa-life" inputMode="numeric" value={life} onChange={(e) => setLife(e.target.value)} /></Field>
        <Field htmlFor="fa-method" label="Method">
          <Select id="fa-method" value={method} onChange={(e) => setMethod(e.target.value as DepreciationMethod)}>
            <option value="STRAIGHT_LINE">Straight line</option>
            <option value="DECLINING_BALANCE">Declining balance</option>
          </Select>
        </Field>
        {method === "DECLINING_BALANCE" && <Field htmlFor="fa-rate" label="Rate a year (%)" required><Input id="fa-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>}
        <Field htmlFor="fa-src" label="Cost booked through">
          <Select id="fa-src" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="SUPPLIER_INVOICE">A supplier bill</option>
            <option value="MONEY_MOVEMENT">A payment</option>
            <option value="OPENING_BALANCE">The opening balances</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field htmlFor="fa-ref" label="Reference" hint="Bill or payment number"><Input id="fa-ref" value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} maxLength={120} /></Field>
        <Field htmlFor="fa-loc" label="Location" className="sm:col-span-2"><Input id="fa-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} /></Field>
      </div>
    </Modal>
  );
}

function DisposeModal({ asset, onClose, onDone }: { asset: FixedAsset; onClose: () => void; onDone: () => void }) {
  const money = useQuery({ queryKey: ["finance", "financial-accounts"], queryFn: financeApi.listFinancialAccounts });
  const paying = (money.data?.financialAccounts ?? []).filter((a) => a.isActive && ["CASH", "BANK", "MOBILE_WALLET"].includes(a.kind));
  const [date, setDate] = useState(() => todayLocal());
  const [proceeds, setProceeds] = useState("");
  const [accountId, setAccountId] = useState("");
  const [reason, setReason] = useState("");
  const value = proceeds ? Number(proceeds) : 0;
  const result = Math.round((value - asset.bookValue) * 100) / 100;
  const valid = reason.trim().length >= 3 && value >= 0 && (value === 0 || Boolean(accountId));
  const save = useMutation({
    mutationFn: () => financeApi.disposeAsset(asset.id, { disposalDate: date, proceeds: value, financialAccountId: value ? accountId : null, reason: reason.trim() }),
    onSuccess: (a) => { toast.success(`${a.number} disposed`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The asset couldn't be disposed")),
  });
  return (
    <Modal open onClose={onClose} title={`Dispose of ${asset.number} ${asset.name}`} description={`Book value ${formatPrice(asset.bookValue)}. Sold, scrapped or lost — this is final.`} widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="confirm-dispose">Dispose</Button></>}>
      <div className="space-y-3">
        <Field htmlFor="dp-date" label="Date"><Input id="dp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="dp-proceeds" label="Sale proceeds" hint="Empty if scrapped or lost"><Input id="dp-proceeds" inputMode="decimal" value={proceeds} onChange={(e) => setProceeds(e.target.value)} /></Field>
        {value > 0 && (
          <Field htmlFor="dp-acc" label="Received into" required>
            <Select id="dp-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Choose…</option>
              {paying.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}
        <p className={result >= 0 ? "text-sm text-ink-700" : "text-sm text-danger-700"}>{result >= 0 ? `Gain of ${formatPrice(result)}` : `Loss of ${formatPrice(-result)}`} against the book value.</p>
        <Field htmlFor="dp-reason" label="Reason" required><Textarea id="dp-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <Card className="p-4">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd className={strong ? "text-lg font-semibold tabular-nums text-ink-900" : "text-lg tabular-nums text-ink-900"}>{value}</dd>
      {hint && <dd className="text-xs text-ink-500">{hint}</dd>}
    </Card>
  );
}
