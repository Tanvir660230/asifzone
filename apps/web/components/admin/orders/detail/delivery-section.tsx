"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Copy, ExternalLink, PackageX, RefreshCw, Truck, Unlink } from "lucide-react";
import { CLOSED_ORDER_STATUSES, courierBookingBlocker, formatVariantLabel, type Order } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { copyToClipboard } from "@/lib/clipboard";
import { courierStatusDescription, formatPrice, formatStoreDateTime, timeAgo } from "@/lib/format";
import { CourierCell } from "../order-badges";
import { COURIER_PROVIDER_LABEL, type OrderPermissions } from "../order-domain";
import type { OrderCommands } from "../use-order-commands";
import { BlockedHint, DetailSection, Fact } from "./detail-section";
import type { OrderDetailCommands } from "./use-order-detail-commands";

const LOSS_REASON = { CANCELLED_POST_BOOKING: "Cancelled after booking", PARTIAL_RETURN: "Partial return" } as const;

/** Declare which units of a partially delivered order came back; the server restocks them and logs the courier loss. */
function PartialDelivery({ order, detail, canManage }: { order: Order; detail: OrderDetailCommands; canManage: boolean }) {
  const [returned, setReturned] = useState<Record<string, number>>({});
  useEffect(() => setReturned({}), [order.id]);

  if (order.partialDeliveryReconciledAt) {
    const units = order.items.reduce((sum, i) => sum + i.returnedQuantity, 0);
    return (
      <Alert variant="success" title="Partial delivery reconciled">
        {formatStoreDateTime(order.partialDeliveryReconciledAt)} — {units > 0 ? `${units} unit(s) restocked.` : "the customer kept the full shipment."}
      </Alert>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-warning-200 bg-warning-50/50 p-3.5" data-testid="partial-delivery">
      <p className="flex items-start gap-2 text-sm text-warning-800">
        <PackageX size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        The courier reported a partial delivery. Enter how many units of each item came back so they can be restocked; leave 0 for anything the customer kept.
      </p>
      <ul className="space-y-2">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-line-subtle bg-surface p-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-ink-900">{item.productNameSnapshot}</p>
              <p className="text-xs text-ink-500">{[formatVariantLabel(item.sizeSnapshot, item.colorSnapshot, "/"), `Ordered ${item.quantity}`].filter(Boolean).join(" · ")}</p>
            </div>
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-500">
              Returned
              <Input
                type="number"
                min={0}
                max={item.quantity}
                step={1}
                className="w-20"
                disabled={!canManage}
                aria-label={`Units of ${item.productNameSnapshot} returned`}
                value={returned[item.id] ?? 0}
                onChange={(e) => setReturned({ ...returned, [item.id]: Math.max(0, Math.min(item.quantity, Math.round(Number(e.target.value) || 0))) })}
              />
            </label>
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex justify-end">
          <Button
            size="sm"
            loading={detail.reconcile.isPending}
            onClick={() => detail.reconcile.mutate({ items: order.items.map((i) => ({ orderItemId: i.id, returnedQuantity: returned[i.id] ?? 0 })) })}
          >
            Restock returned units & reconcile
          </Button>
        </div>
      )}
    </div>
  );
}

/** 5 — getting the parcel to the customer: the courier booking (book, sync, unlink — through the courier abstraction's
 * endpoints), a manual carrier fallback, partial-delivery reconciliation and the courier-loss ledger. */
export function DeliverySection({
  order,
  commands,
  detail,
  perms,
}: {
  order: Order;
  commands: OrderCommands;
  detail: OrderDetailCommands;
  perms: OrderPermissions;
}) {
  const [manual, setManual] = useState<{ carrier: string; trackingNumber: string } | null>(null);
  useEffect(() => setManual(null), [order.id]);

  const booked = Boolean(order.courierConsignmentId);
  const deleted = Boolean(order.deletedAt);
  const bookBlocker = courierBookingBlocker(order);
  const open = !CLOSED_ORDER_STATUSES.includes(order.status) && order.status !== "DELIVERED" && order.status !== "PARTIALLY_DELIVERED";
  const trackingCode = order.trackingNumber || order.courierConsignmentId || "";
  const manualValue = manual ?? { carrier: order.carrier ?? "", trackingNumber: order.trackingNumber ?? "" };

  return (
    <DetailSection title="Delivery & courier" icon={Truck} testId="order-delivery">
      <div className="space-y-4">
        {booked ? (
          <div className="space-y-2 rounded-xl border border-line-subtle bg-surface-muted p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-ink-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cream-50">{COURIER_PROVIDER_LABEL}</span>
              <CourierCell order={order} compact />
              {trackingCode && (
                <IconButton size="sm" aria-label="Copy tracking code" onClick={() => copyToClipboard(trackingCode, "Tracking code copied")}>
                  <Copy size={13} />
                </IconButton>
              )}
              {perms.courier && !deleted && (
                <div className="ml-auto flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" loading={commands.pending.sync} onClick={() => commands.syncCourier(order)}>
                    <RefreshCw size={13} /> Sync now
                  </Button>
                  <Button variant="ghost" size="sm" loading={commands.pending.unlink} onClick={() => commands.unlinkCourier(order)}>
                    <Unlink size={13} /> Unlink
                  </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-ink-500">
              {order.courierStatus ? courierStatusDescription(order.courierStatus) : "Booked — the courier hasn't reported a status yet."} ·{" "}
              {order.courierStatusSyncedAt ? `last synced ${timeAgo(order.courierStatusSyncedAt)}` : "never synced"}
            </p>
            {order.courierSyncError && (
              <p className="flex items-start gap-1.5 text-xs text-danger-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                Sync failed: {order.courierSyncError} — showing the last known status. If the consignment was cancelled in the courier panel, unlink it.
              </p>
            )}
            {open && (
              <p className="text-xs text-ink-500">
                The order moves to Delivered, Partially delivered or Cancelled automatically when the courier reports a final outcome.
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2 pt-1">
              <Fact label="Consignment">{order.courierConsignmentId}</Fact>
              {order.trackingNumber && <Fact label="Tracking code">{order.trackingNumber}</Fact>}
              {order.courierBookedAt && <Fact label="Booked">{formatStoreDateTime(order.courierBookedAt)}</Fact>}
              {order.courierTrackingLink && (
                <Fact label="Tracking page">
                  <a href={order.courierTrackingLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-info-700 hover:underline">
                    Open <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </Fact>
              )}
            </dl>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line p-3.5">
            <p className="flex-1 text-sm text-ink-600">Not booked with a courier yet.</p>
            {perms.courier && !bookBlocker && (
              <Button size="sm" loading={commands.pending.book} onClick={() => commands.bookCourier(order, order.payment?.codToCollect)}>
                <Truck size={14} /> Book with {COURIER_PROVIDER_LABEL}
              </Button>
            )}
            {perms.courier && bookBlocker && !deleted && <BlockedHint>{bookBlocker}.</BlockedHint>}
          </div>
        )}

        {order.status === "PARTIALLY_DELIVERED" && <PartialDelivery order={order} detail={detail} canManage={perms.manage && !deleted} />}

        {order.courierLosses && order.courierLosses.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Courier loss ledger</p>
            <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle text-sm">
              {order.courierLosses.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-ink-700">{LOSS_REASON[l.reason]}</span>
                  <span className="text-right text-xs text-ink-500">
                    <span className="font-medium tabular-nums text-ink-800">{formatPrice(l.amount)}</span> est. return fee · {formatStoreDateTime(l.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {perms.manage && !deleted && (
          <details className="group rounded-xl border border-line-subtle px-3.5 py-2.5" open={Boolean(!booked && (order.carrier || order.trackingNumber))}>
            <summary className="cursor-pointer select-none text-sm font-medium text-ink-700">Manual carrier (fallback)</summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field htmlFor="manual-carrier" label="Carrier">
                <Input id="manual-carrier" placeholder="e.g. Pathao, Sundarban" value={manualValue.carrier} onChange={(e) => setManual({ ...manualValue, carrier: e.target.value })} />
              </Field>
              <Field htmlFor="manual-tracking" label="Tracking number">
                <Input id="manual-tracking" value={manualValue.trackingNumber} onChange={(e) => setManual({ ...manualValue, trackingNumber: e.target.value })} />
              </Field>
              <Button
                variant="outline"
                size="sm"
                className="h-10"
                loading={detail.details.isPending}
                disabled={!manual}
                onClick={() => detail.details.mutate({ carrier: manualValue.carrier || null, trackingNumber: manualValue.trackingNumber || null }, { onSuccess: () => setManual(null) })}
              >
                Save
              </Button>
            </div>
          </details>
        )}
      </div>
    </DetailSection>
  );
}
