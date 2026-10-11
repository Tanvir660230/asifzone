"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, History, Lock, PenLine, Wallet, XCircle } from "lucide-react";
import { customerCancelBlocker, orderModificationBlocker, type Order, type OrderModificationRecord } from "@clothing-brand/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cancelMyOrder, getMyStoreCredit, listMyOrderChanges, payMyOrderChange } from "@/lib/api/customers";
import { getSettings } from "@/lib/api/settings";
import { formatPrice, formatStoreDate } from "@/lib/format";
import { adjustmentErrorOf } from "@/lib/order-adjustment-errors";

const MONEY_RECEIVED = ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"];

const CHANGE_STATUS: Record<OrderModificationRecord["status"], string> = {
  APPLIED: "Applied",
  AWAITING_PAYMENT: "Waiting for your payment",
  SUPERSEDED: "Replaced by a newer change",
  CANCELLED: "Not applied",
  EXPIRED: "Expired — not paid in time",
};

/** Pays a change waiting for its difference: the store sets the amount; this only picks the payment method. */
function PayChange({ order, change }: { order: Order; change: OrderModificationRecord }) {
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 5 * 60 * 1000 });
  const providers = [
    ...(settings?.settings.epsPaymentEnabled ? [{ id: "EPS_PG" as const, label: "Pay online (EPS)" }] : []),
    ...(settings?.settings.onlinePaymentEnabled ? [{ id: "SSLCOMMERZ" as const, label: "Pay online (card / mobile banking)" }] : []),
  ];
  const pay = useMutation({
    mutationFn: (provider: "SSLCOMMERZ" | "EPS_PG") => payMyOrderChange(order.id, change.id, provider),
    onSuccess: ({ gatewayUrl }) => {
      window.location.href = gatewayUrl;
    },
    onError: (err) => toast.error(adjustmentErrorOf(err, "The payment couldn't be started").message),
  });
  return (
    <div className="space-y-3 rounded-xl border border-warning-200 bg-warning-50 p-3.5" data-testid="pay-change">
      <p className="flex items-start gap-2">
        <CreditCard size={18} className="mt-0.5 shrink-0 text-warning-700" aria-hidden="true" />
        <span>
          <span className="block font-semibold text-ink-900">{formatPrice(change.amountDue)} to pay for your change</span>
          <span className="block text-ink-600">
            Your order changes to {formatPrice(change.newTotal)} once this is paid
            {change.expiresAt ? ` (by ${formatStoreDate(change.expiresAt)})` : ""}. Until then your original order stays as it is.
          </span>
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {providers.map((p) => (
          <Button key={p.id} className="min-h-11" loading={pay.isPending && pay.variables === p.id} disabled={pay.isPending} onClick={() => pay.mutate(p.id)}>
            {p.label} — {formatPrice(change.amountDue)}
          </Button>
        ))}
        {providers.length === 0 && <p className="text-ink-600">Online payment is unavailable right now — please contact us.</p>}
      </div>
    </div>
  );
}

/** What the customer can still do with their order (docs/ORDER_ADJUSTMENTS.md §18): change it or cancel it while it hasn't
 * been prepared (and why not, when it can't), pay a change that's waiting for its difference, their change history and
 * Store Balance. Eligibility uses the shared guards the API enforces; every amount comes from the server. */
export function OrderSelfService({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [credited, setCredited] = useState<string | null>(null);
  const { data: credit } = useQuery({ queryKey: ["my-store-credit"], queryFn: getMyStoreCredit });
  const { data: changes } = useQuery({ queryKey: ["my-order-changes", order.id], queryFn: () => listMyOrderChanges(order.id) });
  const balance = credit?.storeCredit.balance ?? 0;
  const orderCredit = (credit?.storeCredit.entries ?? []).filter((e) => e.orderId === order.id && e.amount > 0).reduce((n, e) => n + e.amount, 0);
  const mods = changes?.modifications ?? [];
  const waiting = mods.find((m) => m.status === "AWAITING_PAYMENT");

  const cancel = useMutation({
    mutationFn: () => cancelMyOrder(order.id, reason),
    onSuccess: (res) => {
      setConfirming(false);
      setCredited(res.message);
      void queryClient.invalidateQueries({ queryKey: ["my-order", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["my-order-changes", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["my-store-credit"] });
      toast.success("Your order has been cancelled");
    },
    onError: (err) => {
      toast.error(adjustmentErrorOf(err, "Could not cancel the order").message);
      void queryClient.invalidateQueries({ queryKey: ["my-order", order.id] });
    },
  });

  const editBlocker = orderModificationBlocker(order, "CUSTOMER");
  const cancelBlocker = order.status === "CANCELLED" ? "cancelled" : customerCancelBlocker(order);
  const cancellable = !cancelBlocker;
  const paid = MONEY_RECEIVED.includes(order.paymentStatus);
  const cancelled = order.status === "CANCELLED" || Boolean(credited);

  return (
    <Card data-testid="order-self-service">
      <CardHeader>
        <CardTitle>Changes &amp; store balance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {cancelled ? (
          <p className="text-ink-600">This order has been cancelled.</p>
        ) : editBlocker ? (
          <p className="flex items-start gap-2 text-ink-600" data-testid="order-not-editable">
            <Lock size={15} className="mt-0.5 shrink-0 text-ink-400" aria-hidden="true" />
            <span>
              {editBlocker}
              {/[.!?]$/.test(editBlocker) ? "" : "."}
              {/* The shared blocker messages already say "please contact us" — don't say it twice. */}
              {!cancellable && !/contact us/i.test(editBlocker) && " Need help? Contact us."}
            </span>
          </p>
        ) : (
          <p className="text-ink-600">This order hasn&apos;t been prepared yet — you can still change items, sizes, quantities or the delivery address, or cancel it.</p>
        )}

        {waiting && !cancelled && <PayChange order={order} change={waiting} />}

        {!editBlocker && !cancelled && !waiting && (
          <Link href={`/account/orders/${order.id}/change`} className={buttonVariants({ size: "md", className: "min-h-11" })} data-testid="change-order-link">
            <PenLine size={15} aria-hidden="true" /> Change order
          </Link>
        )}

        {(credited || orderCredit > 0) && (
          <p className="flex items-center gap-2 rounded-lg bg-success-50 p-2.5 font-medium text-success-700">
            <Wallet size={16} aria-hidden="true" /> {credited ?? `Store Balance: +${formatPrice(orderCredit)}`}
          </p>
        )}
        {balance > 0 && (
          <p className="text-ink-600">
            Store Balance available: <span className="font-medium text-ink-900">{formatPrice(balance)}</span> — use it at checkout.{" "}
            <Link href="/account/store-balance" className="font-medium text-ink-900 underline underline-offset-2">
              View history
            </Link>
          </p>
        )}

        {mods.length > 0 && (
          <details className="rounded-lg border border-ink-100 px-3 py-2">
            <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 font-medium text-ink-800">
              <History size={15} aria-hidden="true" /> Changes to this order ({mods.length})
            </summary>
            <ul className="mt-1 space-y-2 pb-1" aria-label="Changes to this order">
              {mods.map((m) => (
                <li key={m.id} className="text-ink-600">
                  <span className="font-medium text-ink-900">
                    {formatPrice(m.previousTotal)} → {formatPrice(m.newTotal)}
                  </span>{" "}
                  · {CHANGE_STATUS[m.status]} · {formatStoreDate(m.appliedAt ?? m.createdAt)}
                  {m.amountCredited > 0 && <span className="block text-success-700">+{formatPrice(m.amountCredited)} added to your Store Balance</span>}
                </li>
              ))}
            </ul>
          </details>
        )}

        {cancellable &&
          !credited &&
          (confirming ? (
            <div className="space-y-2 rounded-lg border border-ink-100 p-3" role="group" aria-label="Cancel this order">
              <p className="font-medium text-ink-900">Cancel order {order.orderNumber}?</p>
              {paid && <p className="text-ink-600">Your payment will be added to your store balance, which you can use on your next order.</p>}
              <Textarea rows={2} maxLength={500} aria-label="Reason (optional)" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="min-h-11" onClick={() => setConfirming(false)}>
                  Keep order
                </Button>
                <Button size="sm" className="min-h-11" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                  Cancel order
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => setConfirming(true)}>
              <XCircle size={14} aria-hidden="true" /> Cancel order
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}
