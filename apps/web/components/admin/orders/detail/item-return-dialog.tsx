"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import type { ItemReturnPreviewInput, Order, ReturnCompensation } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { MoneyOutcome } from "@/components/orders/adjustments/money-outcome";
import * as adjustmentsApi from "@/lib/api/admin-order-adjustments";
import { formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { adjustmentErrorOf } from "@/lib/order-adjustment-errors";
import { cn } from "@/lib/utils";
import { invalidateOrderQueries, orderKeys } from "../order-domain";

function Stepper({ label, value, max, onChange, min = 0 }: { label: string; value: number; max: number; min?: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border border-line-strong" role="group" aria-label={label}>
      <IconButton aria-label={`${label}: one less`} size="lg" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={14} />
      </IconButton>
      <span className="min-w-8 text-center text-sm tabular-nums" aria-live="polite">
        {value}
      </span>
      <IconButton aria-label={`${label}: one more`} size="lg" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={14} />
      </IconButton>
    </div>
  );
}

/**
 * Item-level return on a delivered order (docs/ORDER_ADJUSTMENTS.md §8, §11 — "kept 1 of 3"). Staff pick exact units per
 * line and how many came back damaged; the server values them from the order's own allocated pricing (preview), and the
 * same valuation is recorded on confirm. The original order lines and total are never rewritten.
 */
export function ItemReturnDialog({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <ItemReturnBody order={order} onClose={onClose} />;
}

function ItemReturnBody({ order, onClose }: { order: Order; onClose: () => void }) {
  const queryClient = useQueryClient();
  const lines = order.items.filter((i) => i.quantity - i.restockedQuantity > 0);
  const [qty, setQty] = useState<Record<string, { returning: number; damaged: number }>>({});
  const [compensation, setCompensation] = useState<ReturnCompensation>("STORE_CREDIT");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  /** Second step inside this dialog (no stacked confirm dialog — one focus trap at a time). */
  const [confirming, setConfirming] = useState(false);

  const input: ItemReturnPreviewInput = useMemo(
    () => ({
      items: Object.entries(qty).flatMap(([orderItemId, q]) => [
        ...(q.returning - q.damaged > 0 ? [{ orderItemId, quantity: q.returning - q.damaged, restock: true }] : []),
        ...(q.damaged > 0 ? [{ orderItemId, quantity: q.damaged, restock: false }] : []),
      ]),
    }),
    [qty],
  );
  const deferred = useDeferredValue(input);
  const preview = useQuery({
    queryKey: [...orderKeys.detail(order.id), "return-preview", deferred],
    queryFn: () => adjustmentsApi.previewItemReturn(order.id, deferred),
    enabled: deferred.items.length > 0,
    retry: false,
  });
  const p = deferred.items.length > 0 ? preview.data?.preview : undefined;
  const previewError = preview.error ? adjustmentErrorOf(preview.error, "The return couldn't be valued") : null;

  const scope = `item-return:${order.id}`;
  const record = useMutation({
    mutationFn: () => {
      const body = { ...input, reason: reason.trim(), note: note.trim() || null, compensation };
      return adjustmentsApi.recordItemReturn(order.id, body, idempotencyKeyFor(scope, body));
    },
    onSuccess: ({ returnRequest }) => {
      settleIdempotencyKey(scope);
      invalidateOrderQueries(queryClient, order.id);
      const amt = Number(returnRequest.compensationAmount ?? 0);
      toast.success(
        compensation === "STORE_CREDIT" && amt > 0
          ? `Return recorded — ${formatPrice(amt)} added to the customer's Store Balance`
          : compensation === "REFUND" && amt > 0
            ? `Return recorded — ${formatPrice(amt)} refund owed`
            : "Return recorded",
      );
      onClose();
    },
    onError: (err) => {
      const e = adjustmentErrorOf(err, "The return couldn't be recorded");
      toast.error(e.message);
      if (e.kind === "stale" || e.kind === "not-editable") invalidateOrderQueries(queryClient, order.id);
    },
  });

  const set = (id: string, patch: Partial<{ returning: number; damaged: number }>) => {
    setConfirming(false);
    setQty((cur) => {
      const next = { returning: 0, damaged: 0, ...cur[id], ...patch };
      next.damaged = Math.min(next.damaged, next.returning);
      return { ...cur, [id]: next };
    });
  };

  const compAmount = p ? (compensation === "STORE_CREDIT" ? p.compensation.storeCredit : compensation === "REFUND" ? p.compensation.refund : 0) : 0;
  const ready = Boolean(p) && reason.trim().length > 0 && !preview.isFetching && deferred === input;

  const consequence = compensation === "STORE_CREDIT" ? `${formatPrice(compAmount)} goes to the customer's Store Balance.` : compensation === "REFUND" ? `A ${formatPrice(compAmount)} refund is recorded as owed.` : "Nothing is paid back.";

  return (
    <Modal
      open
      onClose={onClose}
      title={`Record a return — ${order.orderNumber}`}
      description="Choose exactly which units came back. Values are what the customer paid for them, after discounts."
      widthClassName="max-w-2xl"
      footer={
        confirming && p ? (
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <p className="text-sm text-ink-700">
              Record {p.lines.reduce((n, l) => n + l.quantity, 0)} returned unit(s)? {consequence}
            </p>
            <div className="flex shrink-0 justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={record.isPending}>
                Back
              </Button>
              <Button loading={record.isPending} onClick={() => record.mutate()} data-testid="confirm-record-return">
                Yes, record return
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!ready} onClick={() => setConfirming(true)} data-testid="record-return">
              Record return
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4" data-testid="item-return-dialog">
        <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle">
          {lines.map((item) => {
            const q = qty[item.id] ?? { returning: 0, damaged: 0 };
            const returnable = item.quantity - item.restockedQuantity;
            const valued = p?.lines.find((l) => l.orderItemId === item.id);
            const label = [item.sizeSnapshot, item.colorSnapshot].filter(Boolean).join(" / ");
            return (
              <li key={item.id} className="space-y-2 p-3" data-testid="return-line">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ink-900">
                    {item.productNameSnapshot} <span className="font-normal text-ink-500">{label}</span>
                  </p>
                  <p className="text-xs text-ink-500">
                    Ordered {item.quantity} · already back {item.restockedQuantity} · <span className="font-medium text-ink-700">returnable {returnable}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                  <span className="flex items-center gap-2">
                    Returning <Stepper label={`Units of ${item.productNameSnapshot} ${label} returning`} value={q.returning} max={returnable} onChange={(v) => set(item.id, { returning: v })} />
                  </span>
                  <span className={cn("flex items-center gap-2", q.returning === 0 && "opacity-50")}>
                    of which damaged <Stepper label={`Damaged units of ${item.productNameSnapshot} ${label}`} value={q.damaged} max={q.returning} onChange={(v) => set(item.id, { damaged: v })} />
                  </span>
                </div>
                {q.returning > 0 && (
                  <p className="text-xs text-ink-600">
                    Customer keeps {returnable - q.returning} · back on the shelf {q.returning - q.damaged}
                    {q.damaged > 0 && ` · written off ${q.damaged}`}
                    {valued && <span className="ml-2 font-medium text-ink-900">Paid value {formatPrice(valued.value)}</span>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {previewError && (
          <Alert variant="danger" title="Can't record this return">
            {previewError.message}
          </Alert>
        )}

        {p && (
          <fieldset className="space-y-2" data-testid="return-compensation">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">What the customer gets back</legend>
            <p className="text-sm text-ink-600">
              Returned value <span className="font-semibold tabular-nums text-ink-900">{formatPrice(p.value)}</span>
              {p.returnsEverything && " · every item is back, so the order will be marked Returned"}
            </p>
            {(
              [
                { value: "STORE_CREDIT", label: "Store credit", amount: p.compensation.storeCredit, hint: "Added to the customer's Store Balance for future orders." },
                { value: "REFUND", label: "Refund owed", amount: p.compensation.refund, hint: "Recorded as owed; you pay it out and mark it paid." },
                { value: "NONE", label: "Nothing now", amount: 0, hint: "Only the stock and the record are updated." },
              ] as const
            ).map((o) => (
              <label key={o.value} className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm", compensation === o.value ? "border-ink-900" : "border-line-subtle")}>
                <input type="radio" name="return-compensation" className="mt-1" checked={compensation === o.value} onChange={() => setCompensation(o.value)} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink-900">{o.label}</span>
                  {o.value !== "NONE" && <span className="ml-2 tabular-nums text-ink-700">{formatPrice(o.amount)}</span>}
                  <span className="block text-xs text-ink-500">{o.hint}</span>
                </span>
              </label>
            ))}
            {compAmount > 0 && <MoneyOutcome kind={compensation === "STORE_CREDIT" ? "credit" : "refund"} amount={compAmount} audience="staff" />}
            {compensation !== "NONE" && compAmount === 0 && (
              <p className="text-xs text-warning-700">Nothing was received for this order that could be given back, so no money moves.</p>
            )}
          </fieldset>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field htmlFor="return-reason" label="Reason" required>
            <Input id="return-reason" maxLength={200} placeholder="e.g. Didn't fit" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field htmlFor="return-note" label="Note (optional)">
            <Textarea id="return-note" rows={1} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
