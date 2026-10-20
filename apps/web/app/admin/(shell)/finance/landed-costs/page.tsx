"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Truck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as booksApi from "@/lib/api/finance-books";
import { formatBookDate, formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";

const today = () => new Date().toLocaleDateString("en-CA");

/** Owner's books §7.1: transport, labour or customs paid to bring goods in — added to those goods, so the cost per piece is
 * the real one. The units still in stock carry it; the share of units already sold goes to cost adjustments. */
export default function LandedCostsPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const list = useQuery({ queryKey: booksApi.booksKeys.landed(), queryFn: booksApi.listLandedCosts, enabled: allowed });
  const business = useQuery({ queryKey: financeApi.businessKeys.settings(), queryFn: financeApi.getBusiness, enabled: allowed });
  const [adding, setAdding] = useState(false);
  const costing = Boolean(business.data?.inventoryCostingActivatedAt);

  if (ready && !allowed) return <div><ModuleTabs /><EmptyState icon={Truck} title="Landed costs aren't available to your role" /></div>;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Landed costs"
        description="The van, the porter or customs that brought a delivery in — added to those goods, so 500 caps cost what they really cost."
        action={can("finance.transact") && <Button size="sm" onClick={() => setAdding(true)} disabled={!costing} data-testid="new-landed-cost"><Plus className="h-4 w-4" /> Landed cost</Button>}
      />
      {business.data && !costing && (
        <Alert variant="info" title="Confirm your stock's value first">
          Landed costs change the value of stock, so they work once stock is valued — <Link href="/admin/finance/inventory-cutover" className="text-accent hover:underline">Valuation cutover</Link>.
        </Alert>
      )}
      {list.isLoading && <Skeleton className="h-32 w-full" />}
      {list.isError && <Alert variant="danger" title="Landed costs couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>}>{getErrorMessage(list.error, "")}</Alert>}
      {list.data && (list.data.landedCosts.length === 0 ? (
        <EmptyState icon={Truck} title="No landed costs yet" description="When you pay to bring a delivery in, add it here against its goods receipt." />
      ) : (
        <div className="space-y-3">
          {list.data.landedCosts.map((l) => (
            <Card key={l.id} className="space-y-2 p-4 sm:p-5" data-testid="landed-cost">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{l.description}</p>
                  <p className="text-xs text-fg-muted">{l.number} · {formatBookDate(l.costDate)}{l.payee ? ` · ${l.payee}` : ""}{l.paidFrom ? ` · from ${l.paidFrom.name}` : ""} · spread by {l.method === "QUANTITY" ? "quantity" : "value"}</p>
                </div>
                <span className="font-semibold tabular-nums text-fg">{formatPrice(l.amount)}</span>
              </div>
              <ul className="divide-y divide-line-subtle text-sm">
                {l.allocations.map((a) => (
                  <li key={a.variantId} className="flex justify-between gap-3 py-1.5">
                    <span className="text-fg-muted">{a.sku} · {a.qty} pcs</span>
                    <span className="tabular-nums text-fg">+{formatPrice(a.amount)} <span className="text-xs text-fg-muted">({formatPrice(Math.round((a.amount / a.qty) * 100) / 100)} each)</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ))}
      {adding && <LandedModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); void queryClient.invalidateQueries({ queryKey: ["finance"] }); }} />}
    </div>
  );
}

function LandedModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const receipts = useQuery({ queryKey: booksApi.booksKeys.landedReceipts(), queryFn: booksApi.receiptsForLandedCost });
  const money = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts });
  const paying = (money.data?.financialAccounts ?? []).filter((a) => a.isActive && ["CASH", "BANK", "MOBILE_WALLET"].includes(a.kind));
  const [picked, setPicked] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"QUANTITY" | "VALUE">("QUANTITY");
  const [fromId, setFromId] = useState("");
  const [date, setDate] = useState(today());
  const units = (receipts.data?.receipts ?? []).filter((r) => picked.includes(r.id)).reduce((s, r) => s + r.units, 0);
  const body = { description: description.trim(), payee: payee.trim() || null, amount: Number(amount), method, goodsReceiptIds: picked, fromFinancialAccountId: fromId, costDate: date };
  const valid = Boolean(description.trim() && picked.length && fromId) && Number(amount) > 0;
  const save = useMutation({
    mutationFn: () => booksApi.createLandedCost(body, idempotencyKeyFor("landed", body)),
    onSuccess: (r) => { settleIdempotencyKey("landed"); toast.success(`${r.landedCost.number} added to the goods`); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The landed cost couldn't be added")),
  });
  return (
    <Modal open onClose={onClose} title="Landed cost" description="Paid now; spread over the deliveries you tick." widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-landed-cost">Add {Number(amount) > 0 ? formatPrice(Number(amount)) : ""}</Button></>}>
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm font-medium text-fg">Deliveries it brought</p>
          {receipts.isLoading && <Skeleton className="h-20 w-full" />}
          {receipts.data && (receipts.data.receipts.length === 0 ? (
            <p className="text-sm text-fg-muted">No received deliveries yet — receive the goods first (Purchasing › Goods receipts).</p>
          ) : (
            <ul className="max-h-64 divide-y divide-line-subtle overflow-y-auto rounded-lg border border-line-subtle">
              {receipts.data.receipts.map((r) => (
                <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                  <Checkbox id={`grn-${r.id}`} checked={picked.includes(r.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))} />
                  <label htmlFor={`grn-${r.id}`} className="min-w-0 flex-1 cursor-pointer text-sm">
                    <span className="block text-fg">{r.number} · {formatBookDate(r.receiptDate)}{r.supplier ? ` · ${r.supplier}` : ""}</span>
                    <span className="block text-xs text-fg-muted">{r.units} pcs · {formatPrice(r.value)} · {r.lines.map((l) => l.name).slice(0, 3).join(", ")}</span>
                  </label>
                </li>
              ))}
            </ul>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="lc-desc" label="What" required className="sm:col-span-2"><Input id="lc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Van from Chawkbazar" maxLength={300} /></Field>
          <Field htmlFor="lc-amount" label="Amount" required hint={units && Number(amount) > 0 ? `About ${formatPrice(Math.round((Number(amount) / units) * 100) / 100)} a piece` : undefined}><Input id="lc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field htmlFor="lc-method" label="Spread by">
            <Select id="lc-method" value={method} onChange={(e) => setMethod(e.target.value as "QUANTITY" | "VALUE")}><option value="QUANTITY">Number of pieces</option><option value="VALUE">Value of the goods</option></Select>
          </Field>
          <Field htmlFor="lc-from" label="Paid from" required>
            <Select id="lc-from" value={fromId} onChange={(e) => setFromId(e.target.value)}><option value="">Choose…</option>{paying.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </Field>
          <Field htmlFor="lc-date" label="Date"><Input id="lc-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field htmlFor="lc-payee" label="Paid to" className="sm:col-span-2"><Input id="lc-payee" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={200} /></Field>
        </div>
      </div>
    </Modal>
  );
}
