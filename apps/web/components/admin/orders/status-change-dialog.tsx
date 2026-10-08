"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Ban, Info, TriangleAlert } from "lucide-react";
import { transitionNeedsReason, transitionReasonMissing, canTransitionOrder, describeOrderTransitionConsequences, describeRefusedTransition, type Order, type OrderStatus, type OrderTransitionConsequence } from "@clothing-brand/shared";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { orderStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OrderStatusBadge } from "./order-badges";
import { transitionContextOf } from "./order-domain";

export type StatusChangeOrder = Pick<
  Order,
  | "id"
  | "orderNumber"
  | "status"
  | "paymentMethod"
  | "paymentStatus"
  | "courierConsignmentId"
  | "courierStatus"
  | "courierSyncError"
  | "followUpAt"
  | "couponId"
  | "deletedAt"
  | "partialDeliveryReconciledAt"
>;

export interface StatusChangeRequest {
  orders: StatusChangeOrder[];
  to: OrderStatus;
}

const TONE_ICON = { info: Info, warning: TriangleAlert, blocked: Ban } as const;
const TONE_CLASS = { info: "text-ink-600", warning: "text-warning-700", blocked: "text-danger-700" } as const;

export function ConsequenceList({ items }: { items: Array<OrderTransitionConsequence & { suffix?: string }> }) {
  if (items.length === 0) return <p className="text-sm text-ink-500">No stock, payment or customer effects — the order just moves.</p>;
  return (
    <ul className="space-y-1.5" aria-label="What this change does">
      {items.map((c) => {
        const Icon = TONE_ICON[c.tone];
        return (
          <li key={c.text} className={cn("flex items-start gap-2 text-sm", TONE_CLASS[c.tone])}>
            <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="sr-only">{c.tone === "blocked" ? "Blocked: " : c.tone === "warning" ? "Warning: " : ""}</span>
              {c.text}
              {c.suffix && <span className="text-ink-400"> {c.suffix}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Confirmation for a status change — single or bulk. Which moves are legal and what each does both come from the shared
 * state machine (`canTransitionOrder`, `describeOrderTransitionConsequences`); the server re-checks everything. */
export function StatusChangeDialog({
  request,
  pending,
  onCancel,
  onConfirm,
}: {
  request: StatusChangeRequest | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  useEffect(() => setNote(""), [request]);

  const plan = useMemo(() => {
    if (!request) return null;
    const { orders, to } = request;
    const moving = orders.filter((o) => o.status !== to && canTransitionOrder(o.status, to));
    const unchanged = orders.filter((o) => o.status === to);
    const refused = orders.filter((o) => o.status !== to && !canTransitionOrder(o.status, to));
    // Union of every moving order's consequences; in a bulk change, say how many orders each one applies to.
    const byText = new Map<string, OrderTransitionConsequence & { count: number }>();
    for (const o of moving) {
      for (const c of describeOrderTransitionConsequences(o.status, to, transitionContextOf(o)) ?? []) {
        const prev = byText.get(c.text);
        byText.set(c.text, { ...c, count: (prev?.count ?? 0) + 1 });
      }
    }
    const consequences = [...byText.values()].map((c) => ({
      tone: c.tone,
      text: c.text,
      suffix: orders.length > 1 && c.count < moving.length ? `(${c.count} of ${moving.length})` : undefined,
    }));
    return { moving, unchanged, refused, consequences, single: orders.length === 1 ? orders[0]! : null };
  }, [request]);

  if (!request || !plan) return null;
  const { to } = request;
  const destructive = to === "CANCELLED" || to === "RETURNED";
  const singleBlocked = plan.single && plan.consequences.some((c) => c.tone === "blocked");
  // DR-8: cancelling (D22) and the SHIPPED → PACKED correction need a reason — the server refuses them without one too.
  const reasonKind = to === "CANCELLED" ? "cancel" : plan.moving.some((o) => transitionNeedsReason(o.status, to)) ? "correction" : null;
  const needsReason = reasonKind !== null;
  const reasonMissing = plan.moving.some((o) => transitionReasonMissing(o.status, to, note));

  return (
    <Modal
      open
      onClose={onCancel}
      title={plan.single ? `Change status of ${plan.single.orderNumber}` : `Change status of ${request.orders.length} orders`}
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            size="sm"
            loading={pending}
            disabled={plan.moving.length === 0 || Boolean(singleBlocked) || reasonMissing}
            onClick={() => onConfirm(note.trim())}
          >
            {plan.single ? `Move to ${orderStatusLabel(to)}` : `Move ${plan.moving.length} to ${orderStatusLabel(to)}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {plan.single ? (
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={plan.single.status} />
            <ArrowRight size={16} className="text-ink-400" aria-label="to" />
            <OrderStatusBadge status={to} />
          </div>
        ) : (
          <p className="text-sm text-ink-700">
            <span className="font-medium">{plan.moving.length}</span> will move to {orderStatusLabel(to)}
            {plan.unchanged.length > 0 && <>, {plan.unchanged.length} already there</>}
            {plan.refused.length > 0 && (
              <>
                , <span className="font-medium text-danger-700">{plan.refused.length} can&apos;t</span>
              </>
            )}
            .
          </p>
        )}

        {plan.moving.length > 0 && (
          <div className="rounded-xl border border-line-subtle bg-surface-muted p-3.5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">What happens</p>
            <ConsequenceList items={plan.consequences} />
          </div>
        )}

        {plan.refused.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-danger-600">Not allowed — skipped by the server</p>
            <ul className="max-h-32 space-y-1 overflow-y-auto text-sm text-ink-600">
              {plan.refused.map((o) => (
                <li key={o.id}>
                  <span className="font-medium text-ink-800">{o.orderNumber}</span> — {describeRefusedTransition(o.status, to)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(plan.single || needsReason) && (
          <div>
            <Label htmlFor="status-change-note" required={needsReason}>
              {reasonKind === "cancel"
                ? plan.single
                  ? "Reason for cancelling"
                  : "Reason for cancelling these orders"
                : reasonKind === "correction"
                  ? "Why is this going back to Packed?"
                  : "Note for the timeline (optional)"}
            </Label>
            <Textarea
              id="status-change-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                reasonKind === "cancel"
                  ? "e.g. customer changed their mind on the confirmation call"
                  : reasonKind === "correction"
                    ? "e.g. marked shipped before the courier picked it up"
                    : "e.g. customer confirmed on the phone"
              }
            />
            {needsReason && <p className="ui-field-hint">Saved on each order&apos;s timeline and in the audit log.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
