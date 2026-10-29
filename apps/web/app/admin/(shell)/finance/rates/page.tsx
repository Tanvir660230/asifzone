"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2, Truck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as booksApi from "@/lib/api/finance-books";
import type { CourierRateCard, RateCardZone } from "@/lib/api/finance-books";
import { formatBookDate, formatPrice } from "@/lib/format";
import { PermissionState } from "@/components/admin/permission-state";

const today = () => new Date().toLocaleDateString("en-CA");
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
/** A starting point only — every figure is checked against the courier's own price list before saving. */
const STARTER: RateCardZone[] = [
  { name: "Inside Dhaka", districts: ["Dhaka"], areas: [], charge: 60 },
  { name: "Sub-Dhaka", districts: [], areas: ["Savar", "Keraniganj", "Dhamrai", "Tongi", "Gazipur Sadar", "Narayanganj Sadar"], charge: 100 },
];

/** Owner's books §3.1 / §4: what Steadfast charges by area and what EPS keeps — so each order's real cost shows the day it
 * is delivered (an estimate), and the payout replaces it with the actual charge. */
export default function RatesPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const rates = useQuery({ queryKey: booksApi.booksKeys.rateCards(), queryFn: booksApi.listRateCards, enabled: allowed });
  const [editing, setEditing] = useState<CourierRateCard | "new" | null>(null);
  const [newFee, setNewFee] = useState(false);
  const { confirm, dialog } = useConfirmDialog();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: booksApi.booksKeys.all });
  const recalc = useMutation({
    mutationFn: () => financeApi.syncCommerce(true),
    onSuccess: (s) => toast.success(s.skipped ? `Not run: ${s.skipped.toLowerCase().replace(/_/g, " ")}` : `Re-checked ${s.orders} orders — ${s.recorded} change${s.recorded === 1 ? "" : "s"} booked`),
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't re-check the orders")),
  });
  const removeCard = useMutation({ mutationFn: (id: string) => booksApi.deleteRateCard(id), onSuccess: () => { toast.success("Rate card removed"); refresh(); }, onError: (e) => toast.error(getErrorMessage(e, "Couldn't remove it")) });
  const removeFee = useMutation({ mutationFn: (id: string) => booksApi.deleteGatewayRate(id), onSuccess: () => { toast.success("Fee rate removed"); refresh(); }, onError: (e) => toast.error(getErrorMessage(e, "Couldn't remove it")) });

  if (ready && !allowed) return <div><ModuleTabs /><PermissionState icon={Truck} page="Rates" /></div>;
  const cards = rates.data?.courierCards ?? [];
  const fees = rates.data?.gatewayRates ?? [];
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Courier & gateway rates"
        description="What Steadfast charges by area and what EPS keeps. Each order's delivery cost shows the day it's delivered; the payout then replaces it with the exact charge."
        action={can("finance.reconcile") && cards.length > 0 && <Button size="sm" variant="outline" loading={recalc.isPending} onClick={() => recalc.mutate()} data-testid="recalc-orders"><RefreshCw className="h-4 w-4" /> Re-check all orders</Button>}
      />
      {rates.isLoading && <Skeleton className="h-40 w-full" />}
      {rates.isError && <Alert variant="danger" title="Rates couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => rates.refetch()}>Retry</Button>}>{getErrorMessage(rates.error, "")}</Alert>}

      {rates.data && (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-fg">Steadfast</h2>
                <p className="text-sm text-fg-muted">A new card from a date changes the estimate of parcels from that date on. Older parcels keep their card.</p>
              </div>
              {can("finance.configure") && <Button size="sm" onClick={() => setEditing("new")} data-testid="new-rate-card"><Plus className="h-4 w-4" /> New rate card</Button>}
            </div>
            {cards.length === 0 ? (
              <Card className="p-5 text-sm text-fg-muted">No rate card yet — until there is one, an order’s courier charge is known only when the payout arrives.</Card>
            ) : (
              cards.map((c, i) => (
                <Card key={c.id} className="space-y-3 p-4 sm:p-5" data-testid="rate-card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-fg">From {formatBookDate(c.effectiveFrom)} {i === 0 && <Badge variant="success" className="ml-1">in use</Badge>}</p>
                      <p className="text-xs text-fg-muted">COD charge {c.codPercent}% of what is collected · a returned parcel costs {c.returnChargePercent}% of its delivery charge{c.notes ? ` · ${c.notes}` : ""}</p>
                    </div>
                    {can("finance.configure") && (
                      <span className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing(c)}>Edit</Button>
                        <Button size="sm" variant="ghost" aria-label="Remove rate card" onClick={async () => { if (await confirm("Estimates that used it change at the next re-check.", { title: "Remove this rate card?", confirmLabel: "Remove" })) removeCard.mutate(c.id); }}><Trash2 className="h-4 w-4" /></Button>
                      </span>
                    )}
                  </div>
                  <ul className="divide-y divide-line-subtle text-sm">
                    {c.zones.map((z) => (
                      <li key={z.name} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                        <span className="min-w-0">
                          <span className="text-fg">{z.name}</span>
                          <span className="block text-xs text-fg-muted">{[...z.districts, ...z.areas].join(", ")}</span>
                        </span>
                        <span className="tabular-nums text-fg">{formatPrice(z.charge)}</span>
                      </li>
                    ))}
                    <li className="flex items-baseline justify-between gap-2 py-2"><span className="text-fg">Everywhere else</span><span className="tabular-nums text-fg">{formatPrice(c.defaultCharge)}</span></li>
                  </ul>
                </Card>
              ))
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-fg">Online payments</h2>
                <p className="text-sm text-fg-muted">What the gateway keeps from each payment, until its settlement shows the exact fee.</p>
              </div>
              {can("finance.configure") && <Button size="sm" variant="outline" onClick={() => setNewFee(true)} data-testid="new-fee-rate"><Plus className="h-4 w-4" /> Fee rate</Button>}
            </div>
            {fees.length === 0 ? (
              <Card className="p-5 text-sm text-fg-muted">No fee rate yet.</Card>
            ) : (
              <Card className="divide-y divide-line p-0 text-sm">
                {fees.map((f) => (
                  <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span>{f.provider === "EPS_PG" ? "EPS" : "SSLCommerz"} · from {formatBookDate(f.effectiveFrom)}</span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums text-fg">{f.percent}%{f.fixed ? ` + ${formatPrice(f.fixed)}` : ""}</span>
                      {can("finance.configure") && <Button size="sm" variant="ghost" aria-label="Remove fee rate" onClick={() => removeFee.mutate(f.id)}><Trash2 className="h-4 w-4" /></Button>}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </section>
        </>
      )}
      {editing && <RateCardModal card={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}
      {newFee && <FeeModal onClose={() => setNewFee(false)} onDone={() => { setNewFee(false); refresh(); }} />}
      {dialog}
    </div>
  );
}

type ZoneDraft = { name: string; districts: string; areas: string; charge: string };
const draftOf = (z: RateCardZone): ZoneDraft => ({ name: z.name, districts: z.districts.join(", "), areas: z.areas.join(", "), charge: String(z.charge) });

function RateCardModal({ card, onClose, onDone }: { card: CourierRateCard | null; onClose: () => void; onDone: () => void }) {
  const [effectiveFrom, setFrom] = useState(card?.effectiveFrom ?? today());
  const [zones, setZones] = useState<ZoneDraft[]>((card?.zones ?? STARTER).map(draftOf));
  const [defaultCharge, setDefault] = useState(String(card?.defaultCharge ?? 120));
  const [cod, setCod] = useState(String(card?.codPercent ?? 1));
  const [ret, setRet] = useState(String(card?.returnChargePercent ?? 50));
  const [notes, setNotes] = useState(card?.notes ?? "");
  const set = (i: number, patch: Partial<ZoneDraft>) => setZones((zs) => zs.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  const valid = zones.every((z) => z.name.trim() && (list(z.districts).length || list(z.areas).length) && Number(z.charge) >= 0) && Number(defaultCharge) >= 0 && Number(cod) >= 0 && Number(ret) >= 0;
  const save = useMutation({
    mutationFn: () => booksApi.saveRateCard({ effectiveFrom, zones: zones.map((z) => ({ name: z.name.trim(), districts: list(z.districts), areas: list(z.areas), charge: Number(z.charge) })), defaultCharge: Number(defaultCharge), codPercent: Number(cod), returnChargePercent: Number(ret), notes: notes.trim() || null }),
    onSuccess: () => { toast.success("Rate card saved — press Re-check all orders to update past estimates"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The rate card couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={card ? "Edit rate card" : "New Steadfast rate card"} description="Copy the figures from your Steadfast price list. An area listed in a zone wins over its district." widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-rate-card">Save</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field htmlFor="rc-from" label="In force from" required><Input id="rc-from" type="date" value={effectiveFrom} disabled={Boolean(card)} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field htmlFor="rc-cod" label="COD charge %" hint="Of the cash collected"><Input id="rc-cod" inputMode="decimal" value={cod} onChange={(e) => setCod(e.target.value)} /></Field>
          <Field htmlFor="rc-ret" label="Return charge %" hint="Of the delivery charge"><Input id="rc-ret" inputMode="decimal" value={ret} onChange={(e) => setRet(e.target.value)} /></Field>
        </div>
        <div className="space-y-3">
          {zones.map((z, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line-subtle p-3 sm:grid-cols-[1fr_1fr_6rem_auto]">
              <Field htmlFor={`rz-name-${i}`} label="Zone"><Input id={`rz-name-${i}`} value={z.name} onChange={(e) => set(i, { name: e.target.value })} /></Field>
              <Field htmlFor={`rz-d-${i}`} label="Districts"><Input id={`rz-d-${i}`} value={z.districts} onChange={(e) => set(i, { districts: e.target.value })} placeholder="Dhaka" /></Field>
              <Field htmlFor={`rz-c-${i}`} label="Charge"><Input id={`rz-c-${i}`} inputMode="decimal" value={z.charge} onChange={(e) => set(i, { charge: e.target.value })} /></Field>
              <div className="flex items-end"><Button size="sm" variant="ghost" aria-label={`Remove ${z.name || "zone"}`} onClick={() => setZones((zs) => zs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div>
              <Field htmlFor={`rz-a-${i}`} label="Areas (within a district, charged differently)" className="sm:col-span-4"><Input id={`rz-a-${i}`} value={z.areas} onChange={(e) => set(i, { areas: e.target.value })} placeholder="Savar, Keraniganj" /></Field>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setZones((zs) => [...zs, { name: "", districts: "", areas: "", charge: "" }])}><Plus className="h-4 w-4" /> Add zone</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="rc-default" label="Everywhere else" hint="Outside every zone above"><Input id="rc-default" inputMode="decimal" value={defaultCharge} onChange={(e) => setDefault(e.target.value)} /></Field>
          <Field htmlFor="rc-notes" label="Notes"><Input id="rc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Up to 1 kg" /></Field>
        </div>
      </div>
    </Modal>
  );
}

function FeeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [provider, setProvider] = useState<"EPS_PG" | "SSLCOMMERZ">("EPS_PG");
  const [effectiveFrom, setFrom] = useState(today());
  const [percent, setPercent] = useState("");
  const [fixed, setFixed] = useState("0");
  const save = useMutation({
    mutationFn: () => booksApi.saveGatewayRate({ provider, effectiveFrom, percent: Number(percent), fixed: Number(fixed) || 0, notes: null }),
    onSuccess: () => { toast.success("Fee rate saved"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The fee rate couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title="Gateway fee rate" description="From your agreement with the gateway." widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!(Number(percent) >= 0) || percent === ""} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-fee-rate">Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="fr-p" label="Gateway"><Select id="fr-p" value={provider} onChange={(e) => setProvider(e.target.value as "EPS_PG" | "SSLCOMMERZ")}><option value="EPS_PG">EPS</option><option value="SSLCOMMERZ">SSLCommerz</option></Select></Field>
        <Field htmlFor="fr-from" label="In force from"><Input id="fr-from" type="date" value={effectiveFrom} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field htmlFor="fr-pct" label="Percent" required><Input id="fr-pct" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="2" /></Field>
        <Field htmlFor="fr-fixed" label="Plus a fixed amount"><Input id="fr-fixed" inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
