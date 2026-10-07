"use client";

import { useEffect, useState } from "react";
import { PiggyBank, Receipt, Undo2, Wallet } from "lucide-react";
import { manualPaymentBlocker, manualPaymentKindFor, type Order, type OrderPaymentSummary } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatPrice, formatStoreDateTime, PAYMENT_PROVIDER_LABEL } from "@/lib/format";
import type { useConfirmDialog } from "@/components/ui/confirm-dialog";
import type { OrderPermissions } from "../order-domain";
import { BlockedHint, DetailSection, Fact } from "./detail-section";
import type { OrderDetailCommands } from "./use-order-detail-commands";
import { PaymentLinksPanel } from "./payment-links-panel";
import { useOrderModifications } from "./changes-section";

const PROVIDER_LABEL: Record<OrderPaymentSummary["payments"][number]["provider"], string> = PAYMENT_PROVIDER_LABEL;

type Confirm = ReturnType<typeof useConfirmDialog>["confirm"];

/** 4 — the order's money, exactly as the payment ledger states it (docs/PAYMENT_LEDGER.md): every figure here is a field
 * of `order.payment`; this section renders them and sends commands. No gateway refund API exists, so a refund records
 * what staff already sent back. */
export function PaymentsSection({ order, detail, perms, confirm }: { order: Order; detail: OrderDetailCommands; perms: OrderPermissions; confirm: Confirm }) {
  const [form, setForm] = useState<"refund" | "payment" | "credit" | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [text, setText] = useState("");
  useEffect(() => setForm(null), [order.id]);

  const { data: modsData } = useOrderModifications(order.id);
  const waitingChange = modsData?.modifications.find((m) => m.status === "AWAITING_PAYMENT") ?? null;
  const ledger = order.payment;
  if (!ledger) return null;
  const succeeded = ledger.payments.filter((p) => p.status === "SUCCEEDED");
  const failed = ledger.payments.filter((p) => p.status === "FAILED");
  const kind = manualPaymentKindFor(order);
  const paymentBlocker = manualPaymentBlocker(order, kind);
  const canRefund = perms.refunds && !order.deletedAt && ledger.refundable > 0;
  const canRecordPayment = perms.recordPayment && ledger.amountDue > 0 && !paymentBlocker;
  // Store credit (docs/ORDER_ADJUSTMENTS.md §4): money owed back can go to the customer's store balance instead of a refund.
  const canCredit = perms.refunds && !order.deletedAt && ledger.refundDue > 0 && Boolean(order.customerId);

  function open(which: "refund" | "payment" | "credit") {
    setForm(which);
    setAmount(String(which === "refund" ? ledger!.refundable : which === "credit" ? ledger!.refundDue : ledger!.amountDue));
    setMethod("");
    setText("");
  }

  async function submit() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    if (form === "refund") {
      const ok = await confirm(
        `Record a ${formatPrice(value)} refund on ${order.orderNumber}? Do this after you've sent the money back — nothing is refunded automatically.`,
        { confirmLabel: "Record refund", tone: "default", title: "Record refund" },
      );
      if (ok) detail.refund.mutate({ amount: value, method: method || undefined, reason: text || undefined }, { onSuccess: () => setForm(null) });
    } else if (form === "payment") {
      detail.payment.mutate({ amount: value, kind, method: method || undefined, note: text || undefined }, { onSuccess: () => setForm(null) });
    } else if (form === "credit") {
      const ok = await confirm(
        `Add ${formatPrice(value)} to the customer's store balance? It can then be used on future orders but can no longer be refunded.`,
        { confirmLabel: "Add to store balance", tone: "default", title: "Store credit" },
      );
      if (ok) detail.storeCredit.mutate({ amount: value, reason: text || "Refund due moved to store balance" }, { onSuccess: () => setForm(null) });
    }
  }

  return (
    <DetailSection title="Payments & refunds" icon={Wallet} testId="order-payments">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Order total">{formatPrice(ledger.total)}</Fact>
        <Fact label="Received">{formatPrice(ledger.paid)}</Fact>
        <Fact label="Refunded">{formatPrice(ledger.refunded)}</Fact>
        <Fact label="Still due">
          <span className={ledger.amountDue > 0 ? "font-semibold text-ink-900" : undefined}>{formatPrice(ledger.amountDue)}</span>
        </Fact>
        {(ledger.credited ?? 0) > 0 && <Fact label="Credited to store balance">{formatPrice(ledger.credited)}</Fact>}
        {(ledger.paidFromStoreCredit ?? 0) > 0 && <Fact label="Paid from store balance">{formatPrice(ledger.paidFromStoreCredit)}</Fact>}
      </dl>

      <div className="mt-3 space-y-2">
        {ledger.codToCollect > 0 && (
          <p className="text-sm text-ink-600">
            The courier collects <span className="font-semibold text-ink-900">{formatPrice(ledger.codToCollect)}</span> on delivery.
          </p>
        )}
        {ledger.refundDue > 0 && (
          <Alert variant="warning" title={`${formatPrice(ledger.refundDue)} is owed back to the customer`}>
            Up to {formatPrice(ledger.refundable)} can be recorded as refunded.
          </Alert>
        )}
      </div>

      {(succeeded.length > 0 || ledger.refunds.length > 0 || (ledger.credits ?? []).length > 0) && (
        <ul className="mt-4 divide-y divide-line-subtle rounded-xl border border-line-subtle" aria-label="Payments and refunds">
          {succeeded.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-ink-900">
                  <span className="text-success-700">+{formatPrice(p.amount)}</span> · {PROVIDER_LABEL[p.provider] ?? p.provider}
                </p>
                {p.note && <p className="text-xs text-ink-500">{p.note}</p>}
              </div>
              <p className="shrink-0 text-right text-xs text-ink-400">
                {p.recordedBy ?? (p.backfilled ? "Backfilled" : "System")}
                <br />
                {formatStoreDateTime(p.settledAt)}
              </p>
            </li>
          ))}
          {(ledger.credits ?? []).map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-ink-900">
                  <span className="text-info-700">→ {formatPrice(c.amount)}</span> to store balance
                </p>
                <p className="text-xs text-ink-500">{c.reason}</p>
              </div>
              <p className="shrink-0 text-right text-xs text-ink-400">
                {c.createdBy ?? "System"}
                <br />
                {formatStoreDateTime(c.createdAt)}
              </p>
            </li>
          ))}
          {ledger.refunds.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-ink-900">
                  <span className="text-danger-700">−{formatPrice(r.amount)}</span> refund{r.method ? ` · ${r.method}` : ""}
                  {r.status === "REQUESTED" && <span className="ml-2 text-xs font-semibold text-warning-700">Owed — not paid out</span>}
                </p>
                {r.reason && <p className="text-xs text-ink-500">{r.reason}</p>}
              </div>
              {r.status === "REQUESTED" && perms.refunds ? (
                <Button
                  variant="outline"
                  size="sm"
                  loading={detail.completeRefund.isPending}
                  onClick={async () => {
                    if (await confirm(`Mark the ${formatPrice(r.amount)} refund as paid out? Only after the money has been sent.`, { confirmLabel: "Mark paid out", tone: "default", title: "Complete refund" })) {
                      detail.completeRefund.mutate(r.id);
                    }
                  }}
                >
                  Mark paid out
                </Button>
              ) : (
                <p className="shrink-0 text-right text-xs text-ink-400">
                  {r.completedBy ?? r.requestedBy ?? "System"}
                  <br />
                  {formatStoreDateTime(r.completedAt ?? r.createdAt)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {failed.length > 0 && (
        <details className="mt-3 rounded-xl border border-line-subtle px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none font-medium text-ink-700">
            {failed.length} failed payment attempt{failed.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-ink-500">
            {failed.map((p) => (
              <li key={p.id}>
                {formatStoreDateTime(p.settledAt)} · {PROVIDER_LABEL[p.provider] ?? p.provider} · {formatPrice(p.amount)}
                {p.note ? ` — ${p.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {form ? (
        <div className="mt-4 space-y-3 rounded-xl border border-line-subtle p-3.5" role="group" aria-label={form === "refund" ? "Record a refund" : form === "credit" ? "Move to store balance" : "Record a payment"}>
          <p className="text-sm font-medium text-ink-900">
            {form === "refund"
              ? "Record a refund"
              : form === "credit"
                ? "Move what's owed back to the customer's store balance"
                : kind === "COD_COLLECTED"
                  ? "Record cash the courier collected"
                  : "Record a payment received"}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field htmlFor="money-amount" label={`Amount (up to ${formatPrice(form === "refund" ? ledger.refundable : form === "credit" ? ledger.refundDue : ledger.amountDue)})`}>
              <Input id="money-amount" type="number" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            {form !== "credit" && (
              <Field htmlFor="money-method" label="Method">
                <Input id="money-method" placeholder="bKash, bank transfer, cash…" value={method} onChange={(e) => setMethod(e.target.value)} />
              </Field>
            )}
          </div>
          <Field htmlFor="money-note" label={form === "payment" ? "Note (optional)" : "Reason"}>
            <Textarea id="money-note" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button size="sm" loading={detail.refund.isPending || detail.payment.isPending || detail.storeCredit.isPending} disabled={!(Number(amount) > 0)} onClick={submit}>
              {form === "refund" ? "Record refund" : form === "credit" ? "Add to store balance" : "Record payment"}
            </Button>
          </div>
        </div>
      ) : (
        (canRefund || canRecordPayment || canCredit) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {canRecordPayment && (
              <Button variant="outline" size="sm" onClick={() => open("payment")}>
                <Receipt size={14} /> {kind === "COD_COLLECTED" ? "Record courier-collected cash" : "Record a payment"}
              </Button>
            )}
            {canRefund && (
              <Button variant="outline" size="sm" onClick={() => open("refund")}>
                <Undo2 size={14} /> Record a refund
              </Button>
            )}
            {canCredit && (
              <Button variant="outline" size="sm" onClick={() => open("credit")}>
                <PiggyBank size={14} /> Move to store balance
              </Button>
            )}
          </div>
        )
      )}
      {!form && perms.recordPayment && ledger.amountDue > 0 && paymentBlocker && !order.deletedAt && (
        <div className="mt-2">
          <BlockedHint>Payments can&apos;t be recorded here: {paymentBlocker.charAt(0).toLowerCase() + paymentBlocker.slice(1)}.</BlockedHint>
        </div>
      )}
      <PaymentLinksPanel order={order} amountDue={ledger.amountDue} canManage={perms.recordPayment} waitingChange={waitingChange} />
    </DetailSection>
  );
}
