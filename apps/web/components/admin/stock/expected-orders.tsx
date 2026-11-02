"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageOpen } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as stockApi from "@/lib/api/stock";
import type { ExpectedOrder } from "@/lib/api/stock";
import { formatBookDate, formatPrice, storeCurrencySymbol } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { num, todayLocal } from "./stock-shared";

const PAYING = new Set(["CASH", "BANK", "MOBILE_WALLET"]);
const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : v.trim() === "" ? 0 : NaN);

/** "4 litre" next to "4,000 ml" when the item was ordered in a purchase unit. */
const inBought = (l: ExpectedOrder["lines"][number], qty: number) => (l.boughtAs ? ` (${num(Math.round((qty / l.boughtAs.factor) * 10_000) / 10_000)} ${l.boughtAs.label})` : "");

/**
 * Expected deliveries (docs/MATERIALS_PURCHASING.md §4): orders made with "No, ordered" on the purchase form, oldest first,
 * each with what is still to come and a Receive button. Shown only while something is on its way.
 */
export function ExpectedOrders({ canReceive, canPay }: { canReceive: boolean; canPay: boolean }) {
  const q = useQuery({ queryKey: stockApi.stockKeys.expected(), queryFn: stockApi.listExpectedOrders });
  const [receiving, setReceiving] = useState<ExpectedOrder | null>(null);
  if (q.isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (q.isError) {
    return (
      <Alert variant="warning" title="Expected deliveries couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>
        {getErrorMessage(q.error, "Check your connection and try again.")}
      </Alert>
    );
  }
  const orders = q.data?.orders ?? [];
  if (!orders.length) return null;
  const today = todayLocal();
  return (
    <section aria-labelledby="expected-title" className="space-y-3" data-testid="expected-orders">
      <h2 id="expected-title" className="text-base font-semibold text-fg">Expected deliveries <span className="font-normal tabular-nums text-fg-muted">{orders.length}</span></h2>
      <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle">
        {orders.map((o) => {
          const late = o.expectedDate !== null && o.expectedDate < today;
          return (
            <li key={o.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4" data-testid="expected-order">
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-fg">
                  {o.supplier.name}
                  <span className="text-sm font-normal text-fg-muted tabular-nums">{o.number}</span>
                  {o.status === "SUBMITTED" && <Badge variant="warning">Waiting for approval</Badge>}
                  {o.status === "PARTIALLY_RECEIVED" && <Badge variant="neutral">Part arrived</Badge>}
                  {late && <Badge variant="warning">Late</Badge>}
                </p>
                <p className="text-sm text-fg-muted">
                  Ordered {formatBookDate(o.orderDate)}{o.expectedDate ? ` · expected ${formatBookDate(o.expectedDate)}` : ""}
                </p>
                <ul className="text-sm text-fg">
                  {o.lines.filter((l) => l.remaining > 0).map((l) => (
                    <li key={l.variantId} className="tabular-nums">{l.name}: {num(l.remaining)} {l.unit}{inBought(l, l.remaining)} to come{l.received ? <span className="text-fg-muted"> · {num(l.received)} arrived</span> : null}</li>
                  ))}
                </ul>
              </div>
              {canReceive && (
                <Button size="sm" variant="outline" className="shrink-0" disabled={o.status === "SUBMITTED"} title={o.status === "SUBMITTED" ? "Approve it on Finance › Purchase orders first" : undefined} onClick={() => setReceiving(o)} data-testid="expected-receive">
                  <PackageOpen className="h-4 w-4" aria-hidden="true" /> Receive
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {receiving && <DeliverySheet order={receiving} canPay={canPay} onClose={() => setReceiving(null)} />}
    </section>
  );
}

/** One delivery: per item what arrived in good condition and what arrived damaged; the bill now (paid or not) or later. */
function DeliverySheet({ order, canPay, onClose }: { order: ExpectedOrder; canPay: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const formId = useRef(`stock-delivery:${order.id}:${Date.now().toString(36)}`).current;
  const items = order.lines.filter((l) => l.remaining > 0);
  const [good, setGood] = useState<Record<string, string>>(() => Object.fromEntries(items.map((l) => [l.variantId, String(l.remaining)])));
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayLocal());
  const [bill, setBill] = useState<"NOW" | "LATER">("NOW");
  const [paidFrom, setPaidFrom] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [transport, setTransport] = useState("");
  const [method, setMethod] = useState<"VALUE" | "QUANTITY">("VALUE");
  const accountsQ = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts, enabled: canPay, retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2 });
  const accounts = (accountsQ.data?.financialAccounts ?? []).filter((a) => a.isActive && PAYING.has(a.kind));

  const rows = items.map((l) => ({ l, good: whole(good[l.variantId] ?? ""), damaged: whole(damaged[l.variantId] ?? "") }));
  const rowError = (r: (typeof rows)[number]) => (Number.isNaN(r.good) || Number.isNaN(r.damaged) ? "Whole numbers" : r.good > r.l.remaining ? `Only ${num(r.l.remaining)} ${r.l.unit} still to come — more needs an approver on Finance › Purchase orders` : null);
  const transportOk = transport.trim() === "" || /^\d+(\.\d{1,2})?$/.test(transport.trim());
  const anything = rows.some((r) => (r.good || 0) + (r.damaged || 0) > 0);
  const valid = anything && rows.every((r) => !rowError(r)) && transportOk && (!transport.trim() || Boolean(paidFrom)) && date <= todayLocal();

  const save = useMutation({
    mutationFn: () => {
      const body: stockApi.DeliveryBody = {
        date,
        supplierRef: supplierRef.trim() || null,
        lines: rows.filter((r) => r.good || r.damaged).map((r) => ({ variantId: r.l.variantId, good: r.good, damaged: r.damaged })),
        bill,
        paidFromAccountId: bill === "NOW" && paidFrom ? paidFrom : null,
        extras: transport.trim() && Number(transport) > 0 ? [{ description: "Transport", amount: Number(transport) }] : [],
        extrasMethod: method,
      };
      return stockApi.receiveStockDelivery(order.id, body, idempotencyKeyFor(formId, body));
    },
    onSuccess: (r) => {
      settleIdempotencyKey(formId);
      toast.success(r.replayed ? "Already received — nothing was added twice" : `Received${r.receiptNumber ? ` (${r.receiptNumber})` : ""}${r.order.remaining > 0 ? " — the rest stays under Expected" : ""}`);
      void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all });
      void qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e, "The delivery couldn't be recorded")),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Receive ${order.number}`}
      description={`${order.supplier.name}. Only what you put in stock here counts — damaged units are not stocked.`}
      widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="delivery-save">Receive</Button></>}
    >
      <div className="space-y-6">
        <section aria-labelledby="delivery-items" className="space-y-3">
          <h3 id="delivery-items" className="text-sm font-medium text-fg">What arrived</h3>
          {rows.map((r) => (
            <div key={r.l.variantId} className="rounded-xl border border-line-subtle p-3" data-testid="delivery-line">
              <p className="text-[15px] font-medium text-fg">{r.l.name}</p>
              <p className="text-xs text-fg-muted tabular-nums">{num(r.l.remaining)} {r.l.unit}{inBought(r.l, r.l.remaining)} still to come</p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:max-w-sm">
                <Field htmlFor={`dl-g-${r.l.variantId}`} label={`Good (${r.l.unit})`}>
                  <Input id={`dl-g-${r.l.variantId}`} inputMode="numeric" className="tabular-nums" value={good[r.l.variantId] ?? ""} onChange={(e) => setGood((g) => ({ ...g, [r.l.variantId]: e.target.value }))} data-testid="delivery-good" />
                </Field>
                <Field htmlFor={`dl-d-${r.l.variantId}`} label={`Damaged (${r.l.unit})`}>
                  <Input id={`dl-d-${r.l.variantId}`} inputMode="numeric" className="tabular-nums" value={damaged[r.l.variantId] ?? ""} placeholder="0" onChange={(e) => setDamaged((d) => ({ ...d, [r.l.variantId]: e.target.value }))} data-testid="delivery-damaged" />
                </Field>
              </div>
              {rowError(r) && <p className="ui-field-error mt-2" role="alert">{rowError(r)}</p>}
            </div>
          ))}
        </section>

        <section aria-labelledby="delivery-bill" className="grid gap-3 sm:grid-cols-2">
          <h3 id="delivery-bill" className="sr-only">Date and bill</h3>
          <Field htmlFor="dl-date" label="Arrived on">
            <Input id="dl-date" type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field htmlFor="dl-ref" label="Supplier's bill or challan no." hint="Optional.">
            <Input id="dl-ref" value={supplierRef} maxLength={100} onChange={(e) => setSupplierRef(e.target.value)} />
          </Field>
          <Field htmlFor="dl-bill" label="The bill" hint={bill === "LATER" ? "It waits under Finance › Bills to enter when the supplier's invoice comes." : "Made now at the order's price, for the good units."}>
            <Select id="dl-bill" value={bill} onChange={(e) => setBill(e.target.value as "NOW" | "LATER")} data-testid="delivery-bill">
              <option value="NOW">Make the bill now</option>
              <option value="LATER">The bill comes later</option>
            </Select>
          </Field>
          {bill === "NOW" && canPay && (
            <Field htmlFor="dl-paid" label="Paid from" hint={paidFrom ? undefined : "Leave empty to pay it later."}>
              <Select id="dl-paid" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} disabled={accountsQ.isLoading} data-testid="delivery-paid-from">
                <option value="">{accountsQ.isLoading ? "Loading…" : "Not paid yet"}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatPrice(a.currentBalance)})</option>)}
              </Select>
            </Field>
          )}
          {bill === "NOW" && canPay && (
            <>
              <Field htmlFor="dl-transport" label={`Transport, loading (${storeCurrencySymbol()})`} hint={transport.trim() && !paidFrom ? "Choose the account it was paid from." : "Optional. Added to the goods' cost."} error={!transportOk ? "An amount like 300" : undefined}>
                <Input id="dl-transport" inputMode="decimal" className="tabular-nums" value={transport} onChange={(e) => setTransport(e.target.value)} data-testid="delivery-transport" />
              </Field>
              {transport.trim() !== "" && items.length > 1 && (
                <Field htmlFor="dl-method" label="Share it out">
                  <Select id="dl-method" value={method} onChange={(e) => setMethod(e.target.value as "VALUE" | "QUANTITY")}>
                    <option value="VALUE">By what each item cost</option>
                    <option value="QUANTITY">By how many units</option>
                  </Select>
                </Field>
              )}
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
