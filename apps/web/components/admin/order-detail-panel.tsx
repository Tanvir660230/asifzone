"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Truck, Trash2, RotateCcw, Package, Pencil, X } from "lucide-react";
import type { OrderStatus, UpdateOrderDetailsInput } from "@clothing-brand/shared";
import {
  updateOrderDetailsSchema,
  BD_ALL_DISTRICTS,
  BD_AREAS_BY_DISTRICT,
  BD_ALL_AREA_OPTIONS,
  BD_DIVISION_BY_DISTRICT,
  parseAreaDistrictOption,
} from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { formatPrice, courierStatusBadgeClass, courierStatusLabel, courierStatusDescription } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { ApiError } from "@/lib/api-client";

const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["DELIVERED", "CANCELLED", "REFUNDED", "RETURNED"];

interface DetailsDraft {
  customerName: string;
  customerPhone: string;
  shippingDistrict: string;
  shippingArea: string;
  shippingAddressLine: string;
}

const HOLD_QUICK_PICKS = [
  { label: "+1h", ms: 60 * 60 * 1000 },
  { label: "+2h", ms: 2 * 60 * 60 * 1000 },
  { label: "+4h", ms: 4 * 60 * 60 * 1000 },
];

/** "Tomorrow" quick-pick target: 10:00 next-day Bangladesh time, computed via an explicit +6h
 * offset rather than the browser's local timezone — admin staff are assumed to be in Bangladesh,
 * but this keeps the button correct even if someone's OS clock/timezone is misconfigured. */
function nextBdMorning(): Date {
  const bdNow = new Date(Date.now() + 6 * 60 * 60 * 1000); // "now" shifted into BD wall-clock
  const nextDayBdAsUtc = Date.UTC(bdNow.getUTCFullYear(), bdNow.getUTCMonth(), bdNow.getUTCDate() + 1, 10, 0, 0);
  return new Date(nextDayBdAsUtc - 6 * 60 * 60 * 1000); // shift back to the real UTC instant
}

function formatBdDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" });
}

const STATUS_OPTIONS: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
];

interface OrderDetailPanelProps {
  orderId: string;
  /** "Back to orders" (page) / drawer close (drawer) — also called after a permanent delete, since
   * there's nothing left here to show either way. */
  onClose: () => void;
  /** "page": full-width heading, centered column, own scroll (the standalone /orders/[id] route).
   * "drawer": tighter padding, no redundant heading/close — the Drawer chrome already provides those. */
  variant?: "page" | "drawer";
}

/** All order-detail content and mutations — shared by the standalone /admin/orders/[id] route and
 * the orders list's slide-in drawer, so there's exactly one implementation of this view. */
export function OrderDetailPanel({ orderId: id, onClose, variant = "page" }: OrderDetailPanelProps) {
  const queryClient = useQueryClient();
  const [statusNote, setStatusNote] = useState("");
  const [tracking, setTracking] = useState<{ trackingNumber: string; carrier: string } | null>(null);
  const [adminNotes, setAdminNotes] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState<DetailsDraft | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [holdNote, setHoldNote] = useState("");

  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";

  const { data, isLoading } = useQuery({
    queryKey: ["admin-order", id],
    queryFn: () => adminOrdersApi.getOrder(id),
  });

  const statusMutation = useMutation({
    mutationFn: (status: OrderStatus) => adminOrdersApi.updateOrderStatus(id, status, statusNote || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      setStatusNote("");
      toast.success("Order status updated");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update status"),
  });

  const detailsMutation = useMutation({
    mutationFn: (input: UpdateOrderDetailsInput) => adminOrdersApi.updateOrderDetails(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      toast.success("Order updated");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to save"),
  });

  const holdMutation = useMutation({
    mutationFn: (followUpAt: Date) => adminOrdersApi.holdOrder(id, followUpAt.toISOString(), holdNote || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-order-stats"] });
      setHoldNote("");
      toast.success("Order put on hold — follow-up scheduled");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to set follow-up"),
  });

  const clearHoldMutation = useMutation({
    mutationFn: () => adminOrdersApi.clearOrderHold(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-order-stats"] });
      toast.success("Follow-up hold cleared");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to clear hold"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => adminOrdersApi.deleteOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      toast.success("Order deleted");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to delete order"),
  });

  const restoreMutation = useMutation({
    mutationFn: () => adminOrdersApi.restoreOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      toast.success("Order restored");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to restore order"),
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: () => adminOrdersApi.permanentlyDeleteOrder(id),
    onSuccess: () => {
      toast.success("Order permanently deleted");
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to permanently delete order"),
  });

  const bookCourierMutation = useMutation({
    mutationFn: () => adminOrdersApi.bookCourier(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      setTracking(null);
      toast.success("Booked with Steadfast");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to book with Steadfast"),
  });

  const refreshCourierMutation = useMutation({
    mutationFn: () => adminOrdersApi.refreshCourierStatus(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      toast.success("Courier status refreshed");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to refresh status"),
  });

  const unlinkCourierMutation = useMutation({
    mutationFn: () => adminOrdersApi.unlinkCourier(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      toast.success("Courier booking unlinked — you can book again");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to unlink courier booking"),
  });

  const outerClassName =
    variant === "page" ? "mx-auto max-w-4xl space-y-6" : "space-y-5 p-5";

  if (isLoading || !data) {
    return (
      <div className={outerClassName}>
        <p className="py-10 text-center text-sm text-ink-400">Loading…</p>
      </div>
    );
  }

  const { order } = data;
  const trackingValue = tracking ?? { trackingNumber: order.trackingNumber ?? "", carrier: order.carrier ?? "" };
  const notesValue = adminNotes ?? order.adminNotes ?? "";

  const areaOptions: readonly string[] = detailsDraft?.shippingDistrict
    ? (BD_AREAS_BY_DISTRICT[detailsDraft.shippingDistrict] ?? [])
    : BD_ALL_AREA_OPTIONS;

  function startEditingDetails() {
    setDetailsError(null);
    setDetailsDraft({
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      shippingDistrict: order.shippingDistrict,
      shippingArea: order.shippingArea,
      shippingAddressLine: order.shippingAddressLine,
    });
    setEditingDetails(true);
  }

  function cancelEditingDetails() {
    setEditingDetails(false);
    setDetailsDraft(null);
    setDetailsError(null);
  }

  function handleAreaChange(value: string) {
    if (!detailsDraft) return;
    const parsed = parseAreaDistrictOption(value);
    setDetailsDraft(
      parsed ? { ...detailsDraft, shippingDistrict: parsed.district, shippingArea: parsed.area } : { ...detailsDraft, shippingArea: value },
    );
  }

  function saveDetails() {
    if (!detailsDraft) return;
    const shippingDivision = BD_DIVISION_BY_DISTRICT[detailsDraft.shippingDistrict];
    const parsed = updateOrderDetailsSchema
      .pick({
        customerName: true,
        customerPhone: true,
        shippingDivision: true,
        shippingDistrict: true,
        shippingArea: true,
        shippingAddressLine: true,
      })
      .safeParse({ ...detailsDraft, shippingDivision });
    if (!parsed.success) {
      setDetailsError(parsed.error.issues[0]?.message ?? "Please check the highlighted fields");
      return;
    }
    setDetailsError(null);
    detailsMutation.mutate(parsed.data, { onSuccess: () => cancelEditingDetails() });
  }

  return (
    <div className={outerClassName}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-sans text-2xl font-semibold tracking-tight text-ink-900">{order.orderNumber}</h1>
          <p className="text-sm text-ink-500">Placed {new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/admin/orders/${id}/invoice`} target="_blank">
            <Button variant="outline" size="sm">
              <Printer size={14} /> Invoice
            </Button>
          </Link>
          {isOwner &&
            (order.deletedAt ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={restoreMutation.isPending}
                  onClick={async () => {
                    if (await confirm(`Restore order ${order.orderNumber}?`)) restoreMutation.mutate();
                  }}
                >
                  <RotateCcw size={14} /> Restore
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={permanentDeleteMutation.isPending}
                  onClick={async () => {
                    if (
                      await confirm(
                        `Permanently delete order ${order.orderNumber}? This removes it and its line items/history forever — it cannot be undone.`,
                        { confirmLabel: "Delete forever", requireText: order.orderNumber },
                      )
                    )
                      permanentDeleteMutation.mutate();
                  }}
                >
                  <Trash2 size={14} /> Delete permanently
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={async () => {
                  if (
                    await confirm(
                      `Delete order ${order.orderNumber}? Stock will be restored — this can be undone from the orders list.`,
                    )
                  )
                    deleteMutation.mutate();
                }}
              >
                <Trash2 size={14} /> Delete
              </Button>
            ))}
          {variant === "page" && (
            <button onClick={onClose} className="text-sm text-ink-500 hover:text-ink-900">
              Back to orders
            </button>
          )}
        </div>
      </div>

      {order.deletedAt && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          This order was deleted on {new Date(order.deletedAt).toLocaleString()}. Restore it to make further changes.
        </div>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Status</CardTitle>
          <Badge>{order.paymentStatus}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={order.status}
              onChange={(e) => statusMutation.mutate(e.target.value as OrderStatus)}
              disabled={statusMutation.isPending || !!order.deletedAt}
              className="w-44"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Input
              placeholder="Note for this status change (optional)"
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
              disabled={!!order.deletedAt}
              className="max-w-xs"
            />
          </div>

          {order.status === "PENDING" && !order.deletedAt && (
            <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
              {order.followUpAt ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-warning-800">
                    On hold — follow up by {formatBdDateTime(order.followUpAt)}
                    {order.callAttempts > 0 && (
                      <> · {order.callAttempts} call attempt{order.callAttempts > 1 ? "s" : ""}</>
                    )}
                  </p>
                  <Button variant="outline" size="sm" disabled={clearHoldMutation.isPending} onClick={() => clearHoldMutation.mutate()}>
                    Clear hold
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-ink-700">Hold — call back later</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {HOLD_QUICK_PICKS.map((p) => (
                      <Button
                        key={p.label}
                        variant="outline"
                        size="sm"
                        disabled={holdMutation.isPending}
                        onClick={() => holdMutation.mutate(new Date(Date.now() + p.ms))}
                      >
                        {p.label}
                      </Button>
                    ))}
                    <Button variant="outline" size="sm" disabled={holdMutation.isPending} onClick={() => holdMutation.mutate(nextBdMorning())}>
                      Tomorrow
                    </Button>
                    <Input
                      placeholder="Note (e.g. asked to call after 6pm)"
                      value={holdNote}
                      onChange={(e) => setHoldNote(e.target.value)}
                      className="max-w-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <ol className="mt-4 space-y-3 border-l border-ink-100 pl-4">
            {order.statusHistory.map((entry) => (
              <li key={entry.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-ink-400" />
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink-900">{entry.status}</span>
                  <span className="text-xs text-ink-400">{new Date(entry.createdAt).toLocaleString()}</span>
                  {entry.changedByAdmin && <span className="text-xs text-ink-400">· {entry.changedByAdmin.name}</span>}
                </div>
                {entry.note && <p className="mt-0.5 text-ink-600">{entry.note}</p>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck size={16} className="text-info-500" /> Shipping &amp; Tracking
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-ink-100 bg-ink-50/50 p-3">
            {order.courierConsignmentId ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${courierStatusBadgeClass(order.courierStatus ?? "")}`}>
                    Steadfast: {order.courierStatus ? courierStatusLabel(order.courierStatus) : "Booked"}
                  </span>
                  {order.courierTrackingLink && (
                    <a
                      href={order.courierTrackingLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-info-600 underline hover:text-info-700"
                    >
                      Track parcel
                    </a>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={refreshCourierMutation.isPending || !!order.deletedAt}
                    onClick={() => refreshCourierMutation.mutate()}
                  >
                    Refresh status
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={unlinkCourierMutation.isPending || !!order.deletedAt}
                    onClick={async () => {
                      const ok = await confirm(
                        "Unlink this Steadfast booking? Only do this if the consignment was cancelled or deleted directly in the Steadfast panel — this doesn't cancel anything on Steadfast's side, it just clears the link here so you can book again.",
                        "Unlink",
                      );
                      if (ok) unlinkCourierMutation.mutate();
                    }}
                  >
                    Unlink
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-ink-400">
                  {order.courierStatus ? courierStatusDescription(order.courierStatus) : "Booked with Steadfast — status not yet reported."}
                </p>
                {!TERMINAL_ORDER_STATUSES.includes(order.status) && (
                  <p className="mt-1.5 text-xs text-ink-400">
                    Order status will automatically move to <span className="font-medium">Delivered</span> or{" "}
                    <span className="font-medium">Cancelled</span> once Steadfast reports a final outcome — it&apos;s expected to
                    stay <span className="font-medium">{order.status}</span> until then.
                  </p>
                )}
                <p className="mt-2 text-xs text-ink-400">
                  Parcel ID: {order.courierConsignmentId}
                  {order.trackingNumber && <> · Tracking code: {order.trackingNumber}</>}
                </p>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-ink-500">Not yet booked with a courier.</p>
                <Button
                  size="sm"
                  disabled={bookCourierMutation.isPending || !!order.deletedAt}
                  onClick={async () => {
                    const codAmount = order.paymentMethod === "COD" ? Number(order.total) : 0;
                    const ok = await confirm(
                      `Book delivery with Steadfast for ${order.customerName} (${order.customerPhone})? COD to collect: ${formatPrice(codAmount)}.`,
                      "Book",
                    );
                    if (ok) bookCourierMutation.mutate();
                  }}
                >
                  Book with Steadfast
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-ink-100 pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="carrier">Carrier (manual fallback)</Label>
              <Input
                id="carrier"
                placeholder="e.g. Pathao, Sundarban"
                value={trackingValue.carrier}
                onChange={(e) => setTracking({ ...trackingValue, carrier: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="trackingNumber">Tracking number</Label>
              <Input
                id="trackingNumber"
                value={trackingValue.trackingNumber}
                onChange={(e) => setTracking({ ...trackingValue, trackingNumber: e.target.value })}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={detailsMutation.isPending}
              onClick={() =>
                detailsMutation.mutate({
                  trackingNumber: trackingValue.trackingNumber || null,
                  carrier: trackingValue.carrier || null,
                })
              }
            >
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className={variant === "page" ? "grid grid-cols-1 gap-6 sm:grid-cols-2" : "grid grid-cols-1 gap-4"}>
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Customer</CardTitle>
            {!order.deletedAt &&
              (editingDetails ? (
                <button onClick={cancelEditingDetails} className="text-ink-400 hover:text-ink-700" aria-label="Cancel editing">
                  <X size={16} />
                </button>
              ) : (
                <Button variant="ghost" size="sm" onClick={startEditingDetails}>
                  <Pencil size={13} /> Edit
                </Button>
              ))}
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-ink-700">
            {editingDetails && detailsDraft ? (
              <div className="space-y-2">
                <div>
                  <Label htmlFor="customerName">Name</Label>
                  <Input
                    id="customerName"
                    value={detailsDraft.customerName}
                    onChange={(e) => setDetailsDraft({ ...detailsDraft, customerName: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="customerPhone">Phone</Label>
                  <Input
                    id="customerPhone"
                    value={detailsDraft.customerPhone}
                    onChange={(e) => setDetailsDraft({ ...detailsDraft, customerPhone: e.target.value })}
                  />
                </div>
              </div>
            ) : (
              <>
                <p>{order.customerName}</p>
                <p>{order.customerPhone}</p>
                {order.customerEmail && <p>{order.customerEmail}</p>}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shipping Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-ink-700">
            {editingDetails && detailsDraft ? (
              <div className="space-y-2">
                <div>
                  <Label htmlFor="shippingDistrict">District</Label>
                  <SearchableSelect
                    id="shippingDistrict"
                    value={detailsDraft.shippingDistrict}
                    onChange={(v) => setDetailsDraft({ ...detailsDraft, shippingDistrict: v })}
                    options={BD_ALL_DISTRICTS}
                    placeholder="Search district..."
                  />
                </div>
                <div>
                  <Label htmlFor="shippingArea">Area / Thana</Label>
                  <SearchableSelect
                    id="shippingArea"
                    value={detailsDraft.shippingArea}
                    onChange={handleAreaChange}
                    options={areaOptions}
                    placeholder="Search area/thana..."
                  />
                </div>
                <div>
                  <Label htmlFor="shippingAddressLine">House / Road / Details</Label>
                  <Textarea
                    id="shippingAddressLine"
                    rows={2}
                    value={detailsDraft.shippingAddressLine}
                    onChange={(e) => setDetailsDraft({ ...detailsDraft, shippingAddressLine: e.target.value })}
                  />
                </div>
              </div>
            ) : (
              <>
                <p>{order.shippingAddressLine}</p>
                <p>
                  {order.shippingArea}, {order.shippingDistrict}
                </p>
                <p>{order.shippingDivision}</p>
              </>
            )}
          </CardContent>
        </Card>

        {editingDetails && (
          <div className="flex items-center gap-2 sm:col-span-2">
            {detailsError && <p className="text-sm text-danger-600">{detailsError}</p>}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={cancelEditingDetails}>
                Cancel
              </Button>
              <Button size="sm" disabled={detailsMutation.isPending} onClick={saveDetails}>
                Save
              </Button>
            </div>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="pb-2">Product</th>
                <th className="pb-2">SKU</th>
                <th className="pb-2">Qty</th>
                <th className="pb-2 text-right">Price</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-t border-ink-100">
                  <td className="py-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ink-100 bg-ink-50">
                        {item.live?.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={resolveImageUrl(item.live.imageUrl)} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Package size={14} className="text-ink-300" />
                        )}
                      </span>
                      <div>
                        {item.live?.productSlug ? (
                          <Link
                            href={`/product/${item.live.productSlug}`}
                            target="_blank"
                            className="font-medium text-ink-900 transition-colors hover:text-info-600 hover:underline"
                          >
                            {item.productNameSnapshot}
                          </Link>
                        ) : (
                          item.productNameSnapshot
                        )}
                        <span className="text-ink-400"> ({item.sizeSnapshot}/{item.colorSnapshot})</span>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 text-ink-500">{item.skuSnapshot}</td>
                  <td className="py-2">{item.quantity}</td>
                  <td className="py-2 text-right">{formatPrice(item.priceSnapshot)}</td>
                  <td className="py-2 text-right">{formatPrice(Number(item.priceSnapshot) * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 ml-auto max-w-xs space-y-1 border-t border-ink-100 pt-4 text-sm">
            <div className="flex justify-between text-ink-600">
              <span>Subtotal</span>
              <span>{formatPrice(order.subtotal)}</span>
            </div>
            {Number(order.discount) > 0 && (
              <div className="flex justify-between text-success-600">
                <span>Discount</span>
                <span>−{formatPrice(order.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-ink-600">
              <span>Shipping</span>
              <span>{formatPrice(order.shippingFee)}</span>
            </div>
            <div className="flex justify-between border-t border-ink-100 pt-1 text-base text-ink-900">
              <span>Total</span>
              <span>{formatPrice(order.total)}</span>
            </div>
          </div>

          {order.notes && (
            <div className="mt-4 border-t border-ink-100 pt-4 text-sm text-ink-600">
              <span className="font-medium text-ink-900">Customer notes: </span>
              {order.notes}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admin Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            rows={3}
            placeholder="Internal notes — not visible to the customer"
            value={notesValue}
            onChange={(e) => setAdminNotes(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={detailsMutation.isPending}
              onClick={() => detailsMutation.mutate({ adminNotes: notesValue || null })}
            >
              Save notes
            </Button>
          </div>
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}
