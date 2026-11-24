"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PauseCircle, PlayCircle } from "lucide-react";
import {
  ORDER_HOLD_MAX_DAYS,
  ORDER_HOLD_REASONS,
  ORDER_HOLD_REASON_LABELS,
  addDays,
  businessDate,
  businessDayStartUtc,
  holdAdvancePaid,
  holdKeepsStock,
  orderHoldState,
  placeHoldBlocker,
  type Order,
  type OrderHoldReason,
} from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { toDatetimeLocalValue } from "@/lib/datetime-local";
import { formatStoreDateTime } from "@/lib/format";
import { getStoreConfig } from "@/lib/store-config";
import { cn } from "@/lib/utils";
import { invalidateOrderQueries, type OrderPermissions } from "../order-domain";

/**
 * Order hold (docs/ORDER_HOLD.md): the customer asked us to wait. The banner says until when and what happened to the
 * stock, and ends the hold; the dialog asks why and until when, and says before saving whether the stock stays or goes
 * back to sell. The server decides both (it re-checks the advance and the dates); these only preview.
 */

/** 10:00 store time, `days` from today. */
function storeMorning(days: number): Date {
  const { timezone } = getStoreConfig();
  return new Date(businessDayStartUtc(addDays(businessDate(new Date(), timezone), days), timezone).getTime() + 10 * 3_600_000);
}

/** The next 5th of the month at 10:00 store time — salaries in Bangladesh usually land in the first days of the month. */
function afterPayday(): Date {
  const { timezone } = getStoreConfig();
  const today = businessDate(new Date(), timezone);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const target = d < 5 ? new Date(Date.UTC(y, m - 1, 5)) : new Date(Date.UTC(y, m, 5));
  const days = Math.round((target.getTime() - Date.UTC(y, m - 1, d)) / 86_400_000);
  return storeMorning(days);
}

function useHoldCommands(orderId: string) {
  const queryClient = useQueryClient();
  const place = useMutation({
    mutationFn: (input: { reason: OrderHoldReason; until: string; note?: string }) => adminOrdersApi.placeOrderHold(orderId, input),
    onSuccess: ({ order }) => {
      invalidateOrderQueries(queryClient, orderId);
      toast.success(order.holdStockReleased ? "On hold — the stock is back on sale" : "On hold — the stock is kept for this order");
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't put the order on hold")),
  });
  const end = useMutation({
    mutationFn: () => adminOrdersApi.endOrderHold(orderId),
    onSuccess: () => {
      invalidateOrderQueries(queryClient, orderId);
      toast.success("Hold ended — the order is back in its queue");
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't end the hold")),
  });
  return { place, end };
}

/** The "Put on hold" button for the order's action row, or nothing when a hold can't be placed. */
export function PutOnHoldButton({ order, perms }: { order: Order; perms: OrderPermissions }) {
  const [open, setOpen] = useState(false);
  if (!perms.manage || order.holdUntil) return null;
  // The count limit is shown in the dialog (an owner/manager may go past it); the other blockers hide the button.
  if (placeHoldBlocker(order, { canOverride: true })) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PauseCircle size={14} aria-hidden="true" /> Put on hold
      </Button>
      {open && <HoldDialog order={order} perms={perms} onClose={() => setOpen(false)} />}
    </>
  );
}

function HoldDialog({ order, perms, onClose }: { order: Order; perms: OrderPermissions; onClose: () => void }) {
  const { place } = useHoldCommands(order.id);
  const [reason, setReason] = useState<OrderHoldReason | null>(null);
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const countBlocker = placeHoldBlocker(order, { canOverride: perms.escalations });

  const picks = [
    { label: "Tomorrow", at: () => storeMorning(1) },
    { label: "In 3 days", at: () => storeMorning(3) },
    { label: "In 7 days", at: () => storeMorning(7) },
    { label: "After payday (5th)", at: afterPayday },
  ];
  const untilDate = until ? new Date(until) : null;
  const now = new Date();
  const maxDate = new Date(now.getTime() + ORDER_HOLD_MAX_DAYS * 86_400_000);
  const dateProblem = !untilDate ? null : untilDate <= now ? "Pick a time in the future" : untilDate > maxDate ? `A hold can run ${ORDER_HOLD_MAX_DAYS} days at most` : null;
  const advance = order.payment ? holdAdvancePaid(order.payment.netPaid, Number(order.shippingFee)) : false;
  const keeps = untilDate && !dateProblem ? holdKeepsStock({ until: untilDate, now, previousHolds: order.holdCount ?? 0, advancePaid: advance }) : null;
  const needsNote = reason === "OTHER";
  const ready = reason && untilDate && !dateProblem && (!needsNote || note.trim().length >= 3) && !countBlocker;

  function save() {
    if (!ready || !reason || !untilDate) return;
    place.mutate({ reason, until: untilDate.toISOString(), note: note.trim() || undefined }, { onSuccess: onClose });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Put ${order.orderNumber} on hold`}
      description="The customer asked us to wait. It leaves the call and booking lists until the date you pick."
      widthClassName="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!ready} loading={place.isPending}>
            Put on hold
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {countBlocker && <Alert variant="warning">{countBlocker}</Alert>}

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">Why</legend>
          <div className="flex flex-wrap gap-2">
            {ORDER_HOLD_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={reason === r}
                onClick={() => setReason(r)}
                className={cn(
                  "min-h-[40px] rounded-full border px-3.5 text-sm transition-colors",
                  reason === r ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-fg hover:bg-ink-900/[0.04]",
                )}
              >
                {ORDER_HOLD_REASON_LABELS[r]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">Until</legend>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {picks.map((p) => (
              <Button key={p.label} type="button" variant="outline" size="sm" onClick={() => setUntil(toDatetimeLocalValue(p.at().toISOString()))}>
                {p.label}
              </Button>
            ))}
          </div>
          <Input type="datetime-local" aria-label="Hold until" value={until} onChange={(e) => setUntil(e.target.value)} aria-invalid={Boolean(dateProblem)} />
          {dateProblem && <p className="mt-1 text-xs text-danger-600">{dateProblem}</p>}
        </fieldset>

        <Textarea
          aria-label="Hold note"
          rows={2}
          maxLength={500}
          placeholder={needsNote ? "What did the customer say? (required)" : "Note (optional) — e.g. will pay the delivery charge on Friday"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {keeps !== null && (
          <Alert variant={keeps ? "info" : "warning"} title={keeps ? "The stock stays reserved" : "The stock goes back on sale"}>
            {keeps
              ? advance
                ? "An advance is paid, so the items stay set aside for up to 7 days."
                : "A first hold of a day or less keeps the items set aside."
              : "Other buyers can have these items while the order waits. When the hold ends the order takes them back — if they sold out, you'll be asked to add stock or change the order. Tell the customer: an advance of the delivery charge keeps them reserved."}
          </Alert>
        )}
      </div>
    </Modal>
  );
}

/** The banner on a held order: until when, why, what happened to the stock, and "End hold". */
export function OrderHoldBanner({ order, perms }: { order: Order; perms: OrderPermissions }) {
  const { end } = useHoldCommands(order.id);
  const state = orderHoldState(order);
  if (state === "none" || order.deletedAt) return null;
  const reason = order.holdReason ? (ORDER_HOLD_REASON_LABELS[order.holdReason as OrderHoldReason] ?? order.holdReason) : null;
  return (
    <Alert
      variant={state === "due" ? "warning" : "info"}
      title={state === "due" ? `Hold date reached — ${formatStoreDateTime(order.holdUntil!)}` : `On hold until ${formatStoreDateTime(order.holdUntil!)}`}
      action={
        perms.manage ? (
          <Button variant="outline" size="sm" onClick={() => end.mutate()} loading={end.isPending}>
            <PlayCircle size={14} aria-hidden="true" /> End hold
          </Button>
        ) : undefined
      }
    >
      <span data-testid="order-hold-banner">
        {reason}
        {order.holdNote ? ` — ${order.holdNote}` : ""}
        {" · "}
        {order.holdStockReleased ? "Stock is back on sale; ending the hold takes it back." : "Stock is reserved for this order."}
        {state === "due" && " Call the customer, then end the hold, confirm or cancel."}
      </span>
    </Alert>
  );
}
