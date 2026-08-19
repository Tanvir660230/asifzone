"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Printer,
  Truck,
  Trash2,
  RotateCcw,
  Package,
  PackageX,
  Pencil,
  X,
  User,
  MapPin,
  ShoppingBag,
  Receipt,
  History,
  ListChecks,
  StickyNote,
  Phone,
  MessageCircle,
  Copy,
  ExternalLink,
  ChevronDown,
  Check,
  CalendarClock,
  Undo2,
  AlertTriangle,
} from "lucide-react";
import type {
  OrderStatus,
  UpdateOrderDetailsInput,
  AdjustOrderPriceInput,
  ReconcilePartialDeliveryInput,
  RecordRefundInput,
} from "@clothing-brand/shared";
import {
  updateOrderDetailsSchema,
  adjustOrderPriceSchema,
  normalizeBdPhone,
  BD_ALL_DISTRICTS,
  BD_AREAS_BY_DISTRICT,
  BD_ALL_AREA_OPTIONS,
  BD_DIVISION_BY_DISTRICT,
  parseAreaDistrictOption,
} from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/ui/back-link";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Popover } from "@/components/ui/popover";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { OrderStatusIcon } from "@/components/admin/order-status-icon";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as paymentsAdminApi from "@/lib/api/payments-admin";
import {
  formatPrice,
  initials,
  orderStatusBadgeClass,
  orderStatusLabel,
  courierStatusBadgeClass,
  courierStatusLabel,
  courierStatusDescription,
  timeAgo,
} from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { copyToClipboard } from "@/lib/clipboard";
import { ApiError } from "@/lib/api-client";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";

const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["DELIVERED", "PARTIALLY_DELIVERED", "CANCELLED", "REFUNDED", "RETURNED"];

interface DetailsDraft {
  customerName: string;
  customerPhone: string;
  shippingDistrict: string;
  shippingArea: string;
  shippingAddressLine: string;
}

interface PriceDraft {
  amount: string;
  note: string;
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
  "PARTIALLY_DELIVERED",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
];

// The natural happy-path pipeline — used only to suggest the next status in the picker, not to
// restrict which status can be picked (any status is still selectable, this just highlights one).
const PIPELINE_STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"];

function suggestedNextStatus(current: OrderStatus): OrderStatus | null {
  const idx = PIPELINE_STATUSES.indexOf(current);
  if (idx === -1 || idx === PIPELINE_STATUSES.length - 1) return null;
  return PIPELINE_STATUSES[idx + 1] ?? null;
}

function waLink(phone: string, message: string): string {
  const local = normalizeBdPhone(phone);
  return `https://wa.me/880${local.slice(1)}?text=${encodeURIComponent(message)}`;
}

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
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  const [tracking, setTracking] = useState<{ trackingNumber: string; carrier: string } | null>(null);
  const [adminNotes, setAdminNotes] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState<DetailsDraft | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [holdNote, setHoldNote] = useState("");
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState<PriceDraft | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [returnedQuantities, setReturnedQuantities] = useState<Record<string, number>>({});
  const [refundDraft, setRefundDraft] = useState<{ amount: string; reason: string; method: string } | null>(null);

  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";

  // This panel can now stay mounted while `id` changes underneath it (Drawer next/prev) instead of
  // always remounting fresh — without this, an in-progress edit on one order (e.g. editingDetails
  // with its draft) would visually leak onto whichever order is navigated to next.
  useEffect(() => {
    setEditingDetails(false);
    setDetailsDraft(null);
    setDetailsError(null);
    setEditingPrice(false);
    setPriceDraft(null);
    setPriceError(null);
    setStatusNote("");
    setStatusPickerOpen(false);
    setTracking(null);
    setAdminNotes(null);
    setHoldNote("");
    setReturnedQuantities({});
    setRefundDraft(null);
  }, [id]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-order", id],
    queryFn: () => adminOrdersApi.getOrder(id),
  });

  const statusMutation = useMutation({
    mutationFn: (status: OrderStatus) => adminOrdersApi.updateOrderStatus(id, status, statusNote || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-order-stats"] });
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
      toast.success("Follow-up scheduled");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to set follow-up"),
  });

  const clearHoldMutation = useMutation({
    mutationFn: () => adminOrdersApi.clearOrderHold(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-order-stats"] });
      toast.success("Follow-up cleared");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to clear hold"),
  });

  const priceMutation = useMutation({
    mutationFn: (input: AdjustOrderPriceInput) => adminOrdersApi.adjustOrderPrice(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-order-stats"] });
      toast.success("Price adjusted");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to adjust price"),
  });

  const reconcileMutation = useMutation({
    mutationFn: (input: ReconcilePartialDeliveryInput) => adminOrdersApi.reconcilePartialDelivery(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-order-stats"] });
      setReturnedQuantities({});
      toast.success("Partial delivery reconciled");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to reconcile"),
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

  const { data: refundsData } = useQuery({
    queryKey: ["admin-order-refunds", id],
    queryFn: () => paymentsAdminApi.listRefunds(id),
  });
  const refundMutation = useMutation({
    mutationFn: (input: RecordRefundInput) => paymentsAdminApi.createRefund(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order-refunds", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-order-stats"] });
      setRefundDraft(null);
      toast.success("Refund recorded");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to record refund"),
  });

  const outerClassName = variant === "page" ? "mx-auto max-w-4xl space-y-5" : "space-y-4 p-5";

  if (isLoading || !data) {
    return (
      <div className={outerClassName}>
        <div className="animate-pulse space-y-4">
          <div className="h-20 rounded-xl bg-ink-50" />
          <div className="h-32 rounded-xl bg-ink-50" />
          <div className="h-48 rounded-xl bg-ink-50" />
        </div>
      </div>
    );
  }

  const { order } = data;
  const trackingValue = tracking ?? { trackingNumber: order.trackingNumber ?? "", carrier: order.carrier ?? "" };
  const notesValue = adminNotes ?? order.adminNotes ?? "";
  const suggested = suggestedNextStatus(order.status);
  const fullAddress = `${order.shippingAddressLine}, ${order.shippingArea}, ${order.shippingDistrict}, ${order.shippingDivision}`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${fullAddress}, Bangladesh`)}`;
  const trackingCode = order.trackingNumber || order.courierConsignmentId || "";

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

  // Picking a new district directly (not via the area search above) leaves the old area belonging
  // to a different district — clear it so a stale district/area pair can't be saved.
  function handleDistrictChange(value: string) {
    if (!detailsDraft) return;
    setDetailsDraft({ ...detailsDraft, shippingDistrict: value, shippingArea: "" });
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

  const canAdjustPrice = !order.deletedAt && !TERMINAL_ORDER_STATUSES.includes(order.status) && !order.courierConsignmentId;
  // Steadfast has no API to push a name/address correction to an already-booked parcel — matches
  // the backend guard in updateOrderDetails.
  const canEditDetails = !order.deletedAt && !order.courierConsignmentId;

  function startEditingPrice() {
    setPriceError(null);
    setPriceDraft({ amount: String(Number(order.priceAdjustment)), note: "" });
    setEditingPrice(true);
  }

  function cancelEditingPrice() {
    setEditingPrice(false);
    setPriceDraft(null);
    setPriceError(null);
  }

  function savePrice() {
    if (!priceDraft) return;
    const amount = priceDraft.amount.trim() === "" ? 0 : Number(priceDraft.amount);
    if (!Number.isFinite(amount)) {
      setPriceError("Enter a valid amount");
      return;
    }
    const parsed = adjustOrderPriceSchema.safeParse({ priceAdjustment: amount, note: priceDraft.note || null });
    if (!parsed.success) {
      setPriceError(parsed.error.issues[0]?.message ?? "Please check the amount");
      return;
    }
    setPriceError(null);
    priceMutation.mutate(parsed.data, { onSuccess: () => cancelEditingPrice() });
  }

  function pickStatus(next: OrderStatus) {
    if (next === order.status) {
      setStatusPickerOpen(false);
      return;
    }
    statusMutation.mutate(next);
    setStatusPickerOpen(false);
  }

  return (
    <div className={outerClassName}>
      {variant === "page" && <BackLink onClick={onClose} label="Back to Orders" />}

      {order.deletedAt && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          This order was deleted on {new Date(order.deletedAt).toLocaleString()}. Restore it to make further changes.
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-xl tracking-tight text-ink-900 sm:text-2xl">{order.orderNumber}</h1>
          <Badge className={orderStatusBadgeClass(order.status)}>
            <span className="flex items-center gap-1">
              <OrderStatusIcon status={order.status} size={12} />
              {orderStatusLabel(order.status)}
            </span>
          </Badge>
          {variant === "drawer" && (
            <span className="hidden items-center gap-2 text-xs text-ink-300 sm:flex">
              <kbd className="rounded border border-ink-200 px-1 py-0.5 font-sans">↑↓</kbd> navigate
              <kbd className="rounded border border-ink-200 px-1 py-0.5 font-sans">Esc</kbd> close
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>

      {/* Order Summary — order/date/amount/payment/courier at a glance. */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5 sm:p-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Placed</p>
            <p className="mt-0.5 text-sm text-ink-700">{new Date(order.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Amount</p>
            <p className="mt-0.5 font-sans text-lg font-semibold tabular-nums text-ink-900">{formatPrice(order.total)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Payment</p>
            <div className="mt-1 flex items-center gap-1.5">
              <Badge className={order.paymentMethod === "COD" ? "bg-ink-100 text-ink-700" : "bg-info-100 text-info-700"}>
                {order.paymentMethod === "COD" ? "COD" : "Online"}
              </Badge>
              <span
                className={cn(
                  "text-xs font-medium",
                  order.paymentStatus === "PAID"
                    ? "text-success-600"
                    : order.paymentStatus === "FAILED"
                      ? "text-danger-600"
                      : "text-warning-600",
                )}
              >
                {order.paymentStatus === "PAID" ? "Paid" : order.paymentStatus === "FAILED" ? "Failed" : "Unpaid"}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Courier</p>
            <div className="mt-1">
              {order.courierConsignmentId ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    courierStatusBadgeClass(order.courierStatus ?? ""),
                  )}
                >
                  {order.courierStatus ? courierStatusLabel(order.courierStatus) : "Booked"}
                </span>
              ) : (
                <span className="text-sm text-ink-400">Not booked</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Refunds — no EPS/SSLCommerz refund API exists, so this only records what an admin already
          did themselves (bKash/bank transfer) rather than triggering a real money movement. Shown
          whenever there's history to display, even if the order is no longer PAID. */}
      {(order.paymentStatus === "PAID" || (refundsData?.refunds.length ?? 0) > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Undo2 size={16} className="text-ink-400" /> Refunds
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {refundsData && refundsData.refunds.length > 0 && (
              <ul className="space-y-2">
                {refundsData.refunds.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 p-3 text-sm">
                    <div>
                      <p className="font-medium text-ink-900">
                        {formatPrice(r.amount)}
                        {r.method ? ` · ${r.method}` : ""}
                      </p>
                      {r.reason && <p className="mt-0.5 text-xs text-ink-500">{r.reason}</p>}
                    </div>
                    <div className="text-right text-xs text-ink-400">
                      <p>{r.requestedByAdmin?.name ?? "—"}</p>
                      <p>{new Date(r.createdAt).toLocaleDateString()}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {order.paymentStatus === "PAID" &&
              (refundDraft ? (
                <div className="space-y-3 rounded-lg border border-ink-100 p-4">
                  <div>
                    <Label htmlFor="refundAmount">Amount</Label>
                    <Input
                      id="refundAmount"
                      type="number"
                      step="0.01"
                      value={refundDraft.amount}
                      onChange={(e) => setRefundDraft({ ...refundDraft, amount: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="refundMethod">Method</Label>
                    <Input
                      id="refundMethod"
                      placeholder="bKash, Bank transfer, Cash…"
                      value={refundDraft.method}
                      onChange={(e) => setRefundDraft({ ...refundDraft, method: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="refundReason">Reason</Label>
                    <Textarea
                      id="refundReason"
                      rows={2}
                      value={refundDraft.reason}
                      onChange={(e) => setRefundDraft({ ...refundDraft, reason: e.target.value })}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setRefundDraft(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="brass"
                      size="sm"
                      disabled={refundMutation.isPending || !refundDraft.amount}
                      onClick={async () => {
                        const amount = Number(refundDraft.amount);
                        if (!amount || amount <= 0) return toast.error("Enter a valid amount");
                        if (
                          !(await confirm(
                            `Record a ${formatPrice(amount)} refund for order ${order.orderNumber}? This assumes you've already sent the money back yourself — nothing is charged or refunded automatically.`,
                          ))
                        )
                          return;
                        refundMutation.mutate({
                          amount,
                          reason: refundDraft.reason || undefined,
                          method: refundDraft.method || undefined,
                        } as RecordRefundInput);
                      }}
                    >
                      {refundMutation.isPending ? "Recording…" : "Record refund"}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRefundDraft({ amount: String(order.total), reason: "", method: "" })}
                >
                  <Undo2 size={14} /> Record a refund
                </Button>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Status Management — contextual workflow instead of a raw dropdown. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks size={16} className="text-ink-400" /> Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative inline-block">
            <button
              ref={statusTriggerRef}
              onClick={() => setStatusPickerOpen((v) => !v)}
              disabled={!!order.deletedAt}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity duration-150 ease-smooth hover:opacity-80 disabled:pointer-events-none disabled:opacity-50",
                orderStatusBadgeClass(order.status),
              )}
            >
              <OrderStatusIcon status={order.status} size={13} />
              {orderStatusLabel(order.status)}
              <ChevronDown size={12} className="opacity-60" />
            </button>

            <Popover
              open={statusPickerOpen}
              onClose={() => setStatusPickerOpen(false)}
              anchorRef={statusTriggerRef}
              align="start"
              className="w-72"
            >
              <div className="space-y-2 p-2.5">
                <p className="px-1 text-xs font-medium uppercase tracking-wide text-ink-400">Change status</p>
                {suggested && (
                  <button
                    disabled={statusMutation.isPending}
                    onClick={() => pickStatus(suggested)}
                    className="flex w-full items-center gap-2.5 rounded-lg bg-ink-900 px-3 py-2.5 text-left text-sm font-medium text-cream-50 transition-colors duration-150 ease-smooth hover:bg-ink-800 disabled:opacity-60"
                  >
                    <OrderStatusIcon status={suggested} size={15} />
                    <span className="flex-1">Move to {orderStatusLabel(suggested)}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-cream-50/70">Suggested</span>
                  </button>
                )}
                <div className="max-h-52 space-y-0.5 overflow-y-auto border-t border-ink-100 pt-2">
                  {STATUS_OPTIONS.map((s) => (
                    <button
                      key={s}
                      disabled={s === order.status || statusMutation.isPending}
                      onClick={() => pickStatus(s)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 ease-smooth disabled:cursor-default",
                        s === order.status ? "bg-ink-50 font-medium text-ink-900" : "text-ink-600 hover:bg-ink-50",
                      )}
                    >
                      <OrderStatusIcon status={s} size={14} className="text-ink-400" />
                      {orderStatusLabel(s)}
                      {s === order.status && <Check size={14} className="ml-auto text-ink-400" />}
                    </button>
                  ))}
                </div>
                <div className="border-t border-ink-100 pt-2">
                  <Input
                    placeholder="Note for this change (optional)"
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    className="text-sm"
                  />
                </div>
              </div>
            </Popover>
          </div>

          {!TERMINAL_ORDER_STATUSES.includes(order.status) && !order.deletedAt && (
            <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
              {order.followUpAt ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm text-warning-800">
                    <CalendarClock size={14} /> Follow up by {formatBdDateTime(order.followUpAt)}
                    {order.callAttempts > 0 && (
                      <> · {order.callAttempts} call attempt{order.callAttempts > 1 ? "s" : ""}</>
                    )}
                  </p>
                  <Button variant="outline" size="sm" disabled={clearHoldMutation.isPending} onClick={() => clearHoldMutation.mutate()}>
                    Clear
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ink-700">
                    <CalendarClock size={14} /> Schedule a callback / reminder
                  </p>
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
        </CardContent>
      </Card>

      {/* Timeline — chronological status history: icon, timestamp, actor, optional note. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History size={16} className="text-ink-400" /> Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-0">
            {order.statusHistory.map((entry, i) => (
              <li key={entry.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-600">
                    <OrderStatusIcon status={entry.status} size={13} />
                  </span>
                  {i < order.statusHistory.length - 1 && <span className="my-1 w-px flex-1 bg-ink-100" />}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-ink-900">{orderStatusLabel(entry.status)}</span>
                    <span className="text-xs text-ink-400">{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">{entry.changedByAdmin?.name ?? "System"}</p>
                  {entry.note && <p className="mt-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 text-sm text-ink-600">{entry.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {order.status === "PARTIALLY_DELIVERED" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackageX size={16} className="text-warning-500" /> Partial Delivery
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {order.partialDeliveryReconciledAt ? (
              <p className="text-sm text-ink-600">
                Reconciled {formatBdDateTime(order.partialDeliveryReconciledAt)} —{" "}
                {order.items.some((item) => item.returnedQuantity > 0)
                  ? `${order.items.reduce((sum, item) => sum + item.returnedQuantity, 0)} unit(s) restocked.`
                  : "customer kept the full shipment, nothing restocked."}
              </p>
            ) : (
              <>
                <p className="text-sm text-warning-700">
                  Steadfast reported this as a partial delivery — the customer refused part of the shipment. Enter how
                  many units of each item actually came back so stock can be restored; leave 0 for anything they kept.
                </p>
                <div className="space-y-2">
                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 p-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink-900">{item.productNameSnapshot}</p>
                        <p className="text-xs text-ink-400">
                          {item.sizeSnapshot}/{item.colorSnapshot} · Ordered {item.quantity}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Label htmlFor={`returned-${item.id}`} className="text-xs text-ink-400">
                          Returned
                        </Label>
                        <Input
                          id={`returned-${item.id}`}
                          type="number"
                          min={0}
                          max={item.quantity}
                          step={1}
                          className="w-20"
                          value={returnedQuantities[item.id] ?? 0}
                          onChange={(e) =>
                            setReturnedQuantities({
                              ...returnedQuantities,
                              [item.id]: Math.max(0, Math.min(item.quantity, Math.round(Number(e.target.value) || 0))),
                            })
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={reconcileMutation.isPending}
                    onClick={() =>
                      reconcileMutation.mutate({
                        items: order.items.map((item) => ({
                          orderItemId: item.id,
                          returnedQuantity: returnedQuantities[item.id] ?? 0,
                        })),
                      })
                    }
                  >
                    Restock returned items &amp; reconcile
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck size={16} className="text-info-500" /> Shipping &amp; Courier
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-ink-100 bg-ink-50/50 p-3.5">
            {order.courierConsignmentId ? (
              <>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center rounded-md bg-ink-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cream-50">
                    Steadfast
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                      courierStatusBadgeClass(order.courierStatus ?? ""),
                    )}
                  >
                    {order.courierStatus ? courierStatusLabel(order.courierStatus) : "Booked"}
                  </span>
                  {order.courierTrackingLink && (
                    <a
                      href={order.courierTrackingLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-info-600 hover:text-info-700 hover:underline"
                    >
                      <ExternalLink size={13} /> Open tracking
                    </a>
                  )}
                  {trackingCode && (
                    <button
                      onClick={() => copyToClipboard(trackingCode, "Tracking number copied")}
                      className={cn(ICON_BUTTON_HIT, "text-ink-400 hover:text-ink-900")}
                      aria-label="Copy tracking number"
                      title="Copy tracking number"
                    >
                      <Copy size={13} />
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={refreshCourierMutation.isPending || !!order.deletedAt}
                      onClick={() => refreshCourierMutation.mutate()}
                    >
                      Sync Now
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
                </div>
                <p className="mt-1.5 text-xs text-ink-400">
                  {order.courierStatus ? courierStatusDescription(order.courierStatus) : "Booked with Steadfast — status not yet reported."}
                  {" · "}
                  {order.courierStatusSyncedAt ? `Last synced ${timeAgo(order.courierStatusSyncedAt)}` : "Never synced"}
                </p>
                {order.courierSyncError && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger-600">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    Sync failed: {order.courierSyncError} — showing last known status.
                  </p>
                )}
                {!TERMINAL_ORDER_STATUSES.includes(order.status) && (
                  <p className="mt-1.5 text-xs text-ink-400">
                    Order status will automatically move to <span className="font-medium">Delivered</span>,{" "}
                    <span className="font-medium">Partially Delivered</span>, or{" "}
                    <span className="font-medium">Cancelled</span> once Steadfast reports a final outcome — it&apos;s expected to
                    stay <span className="font-medium">{orderStatusLabel(order.status)}</span> until then.
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
            <CardTitle className="flex items-center gap-2">
              <User size={16} className="text-ink-400" /> Customer
            </CardTitle>
            {(editingDetails || canEditDetails) &&
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
          <CardContent className="space-y-3 text-sm text-ink-700">
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
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-100 text-sm font-semibold text-ink-700">
                    {initials(order.customerName)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{order.customerName}</p>
                    <p className="text-xs text-ink-400">{order.customerPhone}</p>
                  </div>
                </div>
                {order.customerEmail && <p className="text-ink-600">{order.customerEmail}</p>}
                <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-3">
                  <a href={`tel:${order.customerPhone}`}>
                    <Button variant="outline" size="sm">
                      <Phone size={13} /> Call
                    </Button>
                  </a>
                  <a href={waLink(order.customerPhone, `Hi ${order.customerName.split(" ")[0]}, `)} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm">
                      <MessageCircle size={13} /> WhatsApp
                    </Button>
                  </a>
                  <button
                    onClick={() => copyToClipboard(order.customerPhone, "Phone number copied")}
                    className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")}
                    aria-label="Copy phone number"
                    title="Copy phone number"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin size={16} className="text-ink-400" /> Shipping Address
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-ink-700">
            {editingDetails && detailsDraft ? (
              <div className="space-y-2">
                <div>
                  <Label htmlFor="shippingDistrict">District</Label>
                  <SearchableSelect
                    id="shippingDistrict"
                    value={detailsDraft.shippingDistrict}
                    onChange={handleDistrictChange}
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
                <div>
                  <p>{order.shippingAddressLine}</p>
                  <p>
                    {order.shippingArea}, {order.shippingDistrict}
                  </p>
                  <p>{order.shippingDivision}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-3">
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(fullAddress, "Address copied")}>
                    <Copy size={13} /> Copy address
                  </Button>
                  <a href={mapsUrl} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm">
                      <ExternalLink size={13} /> Open in Maps
                    </Button>
                  </a>
                </div>
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
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag size={16} className="text-ink-400" /> Order Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Below sm: a 5-column table has no room on a phone — stack each item instead of
              horizontal-scrolling a second region inside the (already scrolling) drawer/page. */}
          <div className="space-y-3 sm:hidden">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-start gap-2.5 border-t border-ink-100 pt-3 first:border-t-0 first:pt-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ink-100 bg-ink-50">
                  {item.live?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolveImageUrl(item.live.imageUrl)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Package size={14} className="text-ink-300" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {item.live?.productSlug ? (
                        <Link
                          href={`/product/${item.live.productSlug}`}
                          target="_blank"
                          className="font-medium text-ink-900 transition-colors hover:text-info-600 hover:underline"
                        >
                          {item.productNameSnapshot}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink-900">{item.productNameSnapshot}</span>
                      )}
                      <div className="text-xs text-ink-400">
                        {item.sizeSnapshot}/{item.colorSnapshot} · SKU {item.skuSnapshot}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm font-medium tabular-nums text-ink-900">
                      {formatPrice(Number(item.priceSnapshot) * item.quantity)}
                    </div>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-500">
                    Qty {item.quantity} × {formatPrice(item.priceSnapshot)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <table className="hidden w-full text-sm sm:table">
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
          <CardTitle className="flex items-center gap-2">
            <Receipt size={16} className="text-ink-400" /> Payment Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ml-auto max-w-xs space-y-1 text-sm">
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
            {!editingPrice && Number(order.priceAdjustment) !== 0 && (
              <div className={`flex justify-between ${Number(order.priceAdjustment) < 0 ? "text-success-600" : "text-ink-600"}`}>
                <span>Price adjustment</span>
                <span>
                  {Number(order.priceAdjustment) > 0 ? "+" : "−"}
                  {formatPrice(Math.abs(Number(order.priceAdjustment)))}
                </span>
              </div>
            )}

            {editingPrice && priceDraft ? (
              <div className="space-y-2 border-t border-ink-100 pt-2">
                <div>
                  <Label htmlFor="priceAdjustment">Price adjustment (৳, negative = discount)</Label>
                  <Input
                    id="priceAdjustment"
                    type="number"
                    step="1"
                    value={priceDraft.amount}
                    onChange={(e) => setPriceDraft({ ...priceDraft, amount: e.target.value })}
                    placeholder="e.g. -100"
                  />
                </div>
                <div>
                  <Label htmlFor="priceAdjustmentNote">Reason (optional)</Label>
                  <Input
                    id="priceAdjustmentNote"
                    value={priceDraft.note}
                    onChange={(e) => setPriceDraft({ ...priceDraft, note: e.target.value })}
                    placeholder="e.g. loyal customer discount"
                  />
                </div>
                {priceError && <p className="text-danger-600">{priceError}</p>}
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={cancelEditingPrice}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={priceMutation.isPending} onClick={savePrice}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              canAdjustPrice && (
                <button onClick={startEditingPrice} className="text-xs text-info-600 hover:underline">
                  {Number(order.priceAdjustment) !== 0 ? "Edit adjustment" : "Adjust price"}
                </button>
              )
            )}

            <div className="flex justify-between border-t border-ink-100 pt-1 text-base text-ink-900">
              <span>Total</span>
              <span>{formatPrice(order.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StickyNote size={16} className="text-ink-400" /> Admin Notes
          </CardTitle>
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
