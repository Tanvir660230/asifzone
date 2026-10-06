"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Send, XCircle } from "lucide-react";
import { paymentLinkBlocker, type Order, type PaymentLinkChannel, type PaymentLinkDto } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import * as paymentsAdminApi from "@/lib/api/payments-admin";
import { formatPrice, formatStoreDateTime } from "@/lib/format";
import { invalidateOrderQueries, orderKeys } from "../order-domain";

const STATUS_VARIANT: Record<PaymentLinkDto["status"], "success" | "neutral" | "warning" | "danger"> = {
  ACTIVE: "success",
  USED: "neutral",
  EXPIRED: "warning",
  CANCELLED: "danger",
};

const EXPIRY_OPTIONS = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

/** Payment links for one order (docs/ORDER_ADJUSTMENTS.md §11): generate (and optionally send), copy, re-send, regenerate,
 * cancel, and see each link's attempts. The amount is always the server's: the ledger's balance due, or — when a change is
 * waiting for its price difference — exactly that difference (a MODIFICATION link), never a full-order amount. */
export function PaymentLinksPanel({
  order,
  amountDue,
  canManage,
  waitingChange,
}: {
  order: Order;
  amountDue: number;
  canManage: boolean;
  /** A change waiting for payment: the link collects its difference and applies it when paid. */
  waitingChange?: { id: string; sequence: number; amountDue: number } | null;
}) {
  const queryClient = useQueryClient();
  const [expiresInHours, setExpiresInHours] = useState(72);
  const [channels, setChannels] = useState<PaymentLinkChannel[]>([]);
  const { data } = useQuery({ queryKey: orderKeys.paymentLinks(order.id), queryFn: () => paymentsAdminApi.listPaymentLinks(order.id) });
  const links = data?.links ?? [];
  const active = links.find((l) => l.status === "ACTIVE");
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: orderKeys.paymentLinks(order.id) });
    invalidateOrderQueries(queryClient, order.id);
  };
  const fail = (fallback: string) => (err: unknown) => toast.error(err instanceof ApiError ? err.message : fallback);

  const create = useMutation({
    mutationFn: () => paymentsAdminApi.createPaymentLink(order.id, { expiresInHours, send: channels, ...(waitingChange ? { modificationId: waitingChange.id } : {}) }),
    onSuccess: ({ link }) => {
      refresh();
      toast.success(channels.length ? "Payment link created and sent" : "Payment link created");
      if (link.url) void copy(link.url);
    },
    onError: fail("Failed to create the payment link"),
  });
  const cancel = useMutation({
    mutationFn: (linkId: string) => paymentsAdminApi.cancelPaymentLink(order.id, linkId),
    onSuccess: () => {
      refresh();
      toast.success("Payment link cancelled");
    },
    onError: fail("Failed to cancel the link"),
  });
  const send = useMutation({
    mutationFn: ({ linkId, via }: { linkId: string; via: PaymentLinkChannel[] }) => paymentsAdminApi.sendPaymentLink(order.id, linkId, via),
    onSuccess: () => {
      refresh();
      toast.success("Payment link sent");
    },
    onError: fail("Failed to send the link"),
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually");
    }
  }

  const targetAmount = waitingChange ? waitingChange.amountDue : amountDue;
  const blocker = paymentLinkBlocker(order, targetAmount);
  const hasEmail = Boolean(order.customerEmail);
  const toggle = (c: PaymentLinkChannel) => setChannels((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  if (!links.length && blocker) return null;

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-line-subtle p-3.5" data-testid="order-payment-links">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
        <Link2 size={14} /> Payment link
      </p>

      {active && (
        <div className="space-y-2 rounded-lg bg-surface-muted p-3 text-sm">
          <p className="text-ink-700">
            Collects <span className="font-semibold text-ink-900">{formatPrice(active.amount)}</span>
            {active.purpose === "MODIFICATION" ? " for the order change" : " (balance due)"} · valid until {formatStoreDateTime(active.expiresAt)}
          </p>
          {active.url && <p className="break-all font-mono text-xs text-ink-600">{active.url}</p>}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {active.url && (
                <Button variant="outline" size="sm" onClick={() => copy(active.url!)}>
                  <Copy size={14} /> Copy link
                </Button>
              )}
              <Button variant="outline" size="sm" loading={send.isPending} onClick={() => send.mutate({ linkId: active.id, via: ["SMS"] })}>
                <Send size={14} /> Send by SMS
              </Button>
              {hasEmail && (
                <Button variant="outline" size="sm" loading={send.isPending} onClick={() => send.mutate({ linkId: active.id, via: ["EMAIL"] })}>
                  <Send size={14} /> Send by email
                </Button>
              )}
              <Button variant="outline" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(active.id)}>
                <XCircle size={14} /> Cancel link
              </Button>
            </div>
          )}
        </div>
      )}

      {canManage && !blocker && (
        <div className="flex flex-wrap items-end gap-3">
          <Field htmlFor="link-expiry" label="Valid for">
            <Select id="link-expiry" value={expiresInHours} onChange={(e) => setExpiresInHours(Number(e.target.value))}>
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.hours} value={o.hours}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="flex items-center gap-3 pb-2 text-sm text-ink-700">
            <legend className="sr-only">Send it now</legend>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={channels.includes("SMS")} onChange={() => toggle("SMS")} /> Send by SMS
            </label>
            {hasEmail && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={channels.includes("EMAIL")} onChange={() => toggle("EMAIL")} /> Email
              </label>
            )}
          </fieldset>
          <Button size="sm" loading={create.isPending} onClick={() => create.mutate()}>
            {active ? "Regenerate link" : waitingChange ? `Generate link for change #${waitingChange.sequence} — ${formatPrice(targetAmount)}` : `Generate link for ${formatPrice(targetAmount)}`}
          </Button>
        </div>
      )}
      {active && canManage && !blocker && <p className="text-xs text-ink-500">Regenerating cancels the current link.</p>}

      {links.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer select-none text-ink-600">Link history ({links.length})</summary>
          <ul className="mt-2 space-y-2">
            {links.map((l) => (
              <li key={l.id} className="rounded-lg border border-line-subtle px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {formatPrice(l.amount)} · {l.purpose === "MODIFICATION" ? "order change" : "balance due"}
                  </span>
                  <Badge variant={STATUS_VARIANT[l.status]}>{l.status.toLowerCase()}</Badge>
                </div>
                <p className="text-xs text-ink-500">
                  Created {formatStoreDateTime(l.createdAt)}
                  {l.createdBy ? ` by ${l.createdBy}` : ""}
                  {l.usedAt ? ` · paid ${formatStoreDateTime(l.usedAt)}` : ""}
                  {l.statusReason ? ` · ${l.statusReason}` : ""}
                </p>
                {l.attempts.length > 0 && (
                  <p className="text-xs text-ink-500">
                    Attempts: {l.attempts.map((a) => `${a.provider} ${a.status.toLowerCase()}`).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
