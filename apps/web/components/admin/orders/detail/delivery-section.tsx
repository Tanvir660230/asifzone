"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Copy, ExternalLink, PackageX, RefreshCw, Truck, Unlink } from "lucide-react";
import { CLOSED_ORDER_STATUSES, courierBookingBlocker, formatVariantLabel, type Order } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { copyToClipboard } from "@/lib/clipboard";
import { courierStatusDescription, formatPrice, formatStoreDateTime, timeAgo } from "@/lib/format";
import { CourierCell } from "../order-badges";
import { COURIER_PROVIDER_LABEL, type OrderPermissions } from "../order-domain";
import type { OrderCommands } from "../use-order-commands";
import { BlockedHint, DetailSection, Fact } from "./detail-section";
import { CourierNotePanel } from "./courier-note-panel";
import { UnitStepper } from "./unit-stepper";
import type { OrderDetailCommands } from "./use-order-detail-commands";

const LOSS_REASON = { CANCELLED_POST_BOOKING: "Cancelled after booking", PARTIAL_RETURN: "Partial return" } as const;

/** Declare which units of a partially delivered order came back; the server restocks them and logs the courier loss. */
function PartialDelivery({ order, detail, canManage }: { order: Order; detail: OrderDetailCommands; canManage: boolean }) {
  const [returned, setReturned] = useState<Record<string, number>>({});
  const [damaged, setDamaged] = useState<Record<string, number>>({});
  useEffect(() => {
    setReturned({});
    setDamaged({});
  }, [order.id]);

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
        The courier reported a partial delivery. Enter how many units of each item came back and how many of those are damaged — good units are restocked, damaged ones written off. Leave 0 for anything the customer kept.
      </p>
      <ul className="space-y-2">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-line-subtle bg-surface p-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-ink-900">{item.productNameSnapshot}</p>
              <p className="text-xs text-ink-500">{[formatVariantLabel(item.sizeSnapshot, item.colorSnapshot, "/"), `Ordered ${item.quantity}`].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
              <label className="flex items-center gap-1.5 text-xs text-ink-500">
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
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(item.quantity, Math.round(Number(e.target.value) || 0)));
                    setReturned({ ...returned, [item.id]: v });
                    if ((damaged[item.id] ?? 0) > v) setDamaged({ ...damaged, [item.id]: v });
                  }}
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink-500">
                Damaged
                <Input
                  type="number"
                  min={0}
                  max={returned[item.id] ?? 0}
                  step={1}
                  className="w-20"
                  disabled={!canManage || !(returned[item.id] ?? 0)}
                  aria-label={`Returned units of ${item.productNameSnapshot} that are damaged`}
                  value={damaged[item.id] ?? 0}
                  onChange={(e) => setDamaged({ ...damaged, [item.id]: Math.max(0, Math.min(returned[item.id] ?? 0, Math.round(Number(e.target.value) || 0))) })}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex justify-end">
          <Button
            size="sm"
            loading={detail.reconcile.isPending}
            onClick={() =>
              detail.reconcile.mutate({
                items: order.items.map((i) => ({ orderItemId: i.id, returnedQuantity: returned[i.id] ?? 0, damaged: Math.min(damaged[i.id] ?? 0, returned[i.id] ?? 0) })),
              })
            }
          >
            Restock returned units & reconcile
          </Button>
        </div>
      )}
    </div>
  );
}

type ParcelLine = { back: number; damaged: number; lost: boolean };

/** A cancelled order whose units are still out: it was cancelled after it shipped, so the parcel is on its way back. Its
 * units go back into stock only when someone has it in hand (inventory recovery F-d) — never on the courier's word. Staff
 * say per item how many came back and how many of those are damaged; anything that didn't come back either stays
 * outstanding or is marked lost by the courier. Only the good units become sellable stock. */
function ParcelComingBack({ order, detail, canManage }: { order: Order; detail: OrderDetailCommands; canManage: boolean }) {
  const [lines, setLines] = useState<Record<string, ParcelLine>>({});
  const [damageNote, setDamageNote] = useState("");
  useEffect(() => {
    setLines({});
    setDamageNote("");
  }, [order.id]);

  const out = order.items.map((i) => ({ item: i, units: i.quantity - i.restockedQuantity })).filter((l) => l.units > 0);
  if (!out.length) return null;
  const total = out.reduce((s, l) => s + l.units, 0);
  const lineOf = (id: string, units: number): ParcelLine => lines[id] ?? { back: units, damaged: 0, lost: false };
  const set = (id: string, units: number, patch: Partial<ParcelLine>) => {
    const next = { ...lineOf(id, units), ...patch };
    next.damaged = Math.min(next.damaged, next.back);
    setLines({ ...lines, [id]: next });
  };

  let good = 0;
  let damaged = 0;
  let lost = 0;
  let waiting = 0;
  for (const { item, units } of out) {
    const l = lineOf(item.id, units);
    good += l.back - l.damaged;
    damaged += l.damaged;
    if (l.lost) lost += units - l.back;
    else waiting += units - l.back;
  }
  const nothing = good + damaged + lost === 0;
  const summary = [`${good} good`, damaged ? `${damaged} damaged` : "", lost ? `${lost} lost` : ""].filter(Boolean).join(", ");

  const receive = () =>
    detail.receiveReturn.mutate(
      {
        lines: out
          .map(({ item, units }) => {
            const l = lineOf(item.id, units);
            return { orderItemId: item.id, quantity: l.back, damaged: l.damaged, lost: l.lost ? units - l.back : 0 };
          })
          .filter((l) => l.quantity + l.lost > 0),
        damageNote: damaged ? damageNote.trim() || null : null,
      },
      { onSuccess: () => setLines({}) },
    );

  return (
    <div className="space-y-3 rounded-xl border border-warning-200 bg-warning-50/50 p-3.5" data-testid="parcel-coming-back">
      <p className="flex items-start gap-2 text-sm text-warning-800">
        <PackageX size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        Cancelled after it shipped — the parcel is coming back. {total} unit(s) go back into stock when you have it in hand. Check each item: damaged
        units are written off instead of restocked.
      </p>
      <ul className="space-y-2">
        {out.map(({ item, units }) => {
          const l = lineOf(item.id, units);
          const variant = formatVariantLabel(item.sizeSnapshot, item.colorSnapshot, "/");
          const missing = units - l.back;
          return (
            <li key={item.id} className="space-y-2.5 rounded-lg border border-line-subtle bg-surface p-2.5 text-sm" data-testid="parcel-line">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink-900">{item.productNameSnapshot}</p>
                <p className="text-xs text-ink-500">{[variant, `${units} out with the courier`].filter(Boolean).join(" · ")}</p>
              </div>
              {canManage && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-600">
                  <span className="flex items-center gap-2">
                    <span className="w-[4.5rem] sm:w-auto">Came back</span>
                    <UnitStepper label={`Units of ${item.productNameSnapshot} that came back`} value={l.back} max={units} onChange={(v) => set(item.id, units, { back: v })} />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-[4.5rem] sm:w-auto">Damaged</span>
                    <UnitStepper label={`Damaged units of ${item.productNameSnapshot}`} value={l.damaged} max={l.back} onChange={(v) => set(item.id, units, { damaged: v })} />
                  </span>
                </div>
              )}
              {canManage && missing > 0 && (
                <label className="flex items-center gap-2 text-xs text-ink-600">
                  <Checkbox checked={l.lost} onChange={(e) => set(item.id, units, { lost: e.target.checked })} />
                  {missing} didn&apos;t come back — the courier lost {missing === 1 ? "it" : "them"}
                  {!l.lost && <span className="text-ink-400">(otherwise {missing === 1 ? "it stays" : "they stay"} outstanding)</span>}
                </label>
              )}
            </li>
          );
        })}
      </ul>
      {canManage && damaged > 0 && (
        <Field htmlFor="parcel-damage-note" label="What was wrong? (optional)">
          <Input id="parcel-damage-note" placeholder="e.g. box crushed, bottle leaked" maxLength={200} value={damageNote} onChange={(e) => setDamageNote(e.target.value)} />
        </Field>
      )}
      {canManage && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {waiting > 0 && <p className="text-xs text-ink-500">{waiting} unit(s) stay outstanding</p>}
          <Button size="sm" className="max-sm:w-full" disabled={nothing} loading={detail.receiveReturn.isPending} onClick={receive} data-testid="parcel-received">
            Receive — {summary}
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
            {perms.courierNotConnected && !bookBlocker && (
              <BlockedHint>
                {COURIER_PROVIDER_LABEL} isn&apos;t connected to this store yet —{" "}
                <Link href="/admin/settings?pane=integrations" className="font-medium text-fg underline underline-offset-2 hover:text-accent">
                  add its API keys in Settings › Integrations
                </Link>
                .
              </BlockedHint>
            )}
          </div>
        )}

        {(booked || open) && <CourierNotePanel order={order} detail={detail} canEdit={perms.manage && !deleted} />}

        {order.status === "PARTIALLY_DELIVERED" && <PartialDelivery order={order} detail={detail} canManage={perms.manage && !deleted} />}
        {order.status === "CANCELLED" && !deleted && <ParcelComingBack order={order} detail={detail} canManage={perms.manage} />}

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
