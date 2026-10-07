"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PRE_SHIPMENT_STATUSES, type Order, type OrderStatus } from "@clothing-brand/shared";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import type { BulkOrderOutcome } from "@/lib/api/admin-orders";
import { ApiError } from "@/lib/api-client";
import { courierStatusLabel, formatPrice, orderStatusLabel } from "@/lib/format";
import { BulkResultDialog, type BulkResult } from "./bulk-result-dialog";
import { COURIER_PROVIDER_LABEL, invalidateOrderQueries, orderKeys } from "./order-domain";
import { StatusChangeDialog, type StatusChangeOrder, type StatusChangeRequest } from "./status-change-dialog";

type OrderRef = Pick<Order, "id" | "orderNumber">;
type TrashableOrder = OrderRef & Pick<Order, "status">;

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * Every order command the list, the drawer and the detail page share — one implementation of each mutation, its
 * confirmation, its toast and its cache invalidation (previously duplicated between orders/page.tsx and the detail panel).
 * Commands only call the API; what is legal and what it does is decided server-side (and previewed from @clothing-brand/shared).
 * Mount the returned `dialogs` once.
 */
export function useOrderCommands({ onOpenOrder, onPurged }: { onOpenOrder?: (id: string) => void; onPurged?: (id: string) => void } = {}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [statusRequest, setStatusRequest] = useState<StatusChangeRequest | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const refresh = (orderId?: string) => invalidateOrderQueries(queryClient, orderId);

  /** Bulk outcomes come back as ids; the caller's own rows supply the order numbers. */
  function reportBulk(title: string, succeededLabel: string, orders: OrderRef[], outcome: BulkOrderOutcome, detailOk?: string) {
    const numberOf = new Map(orders.map((o) => [o.id, o.orderNumber]));
    const result: BulkResult = {
      title,
      succeededLabel,
      succeeded: outcome.succeeded.map((id) => ({ orderId: id, orderNumber: numberOf.get(id) ?? id, detail: detailOk })),
      failed: outcome.failed.map((f) => ({ orderId: f.id, orderNumber: f.orderNumber ?? numberOf.get(f.id) ?? f.id, detail: f.reason })),
    };
    if (result.failed.length === 0) toast.success(`${result.succeeded.length} order(s) ${succeededLabel.toLowerCase()}`);
    else setBulkResult(result);
  }

  // ── status ──────────────────────────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: ({ order, to, note }: { order: StatusChangeOrder; to: OrderStatus; note?: string }) =>
      adminOrdersApi.updateOrderStatus(order.id, to, note || undefined),
    onSuccess: (_, { order, to }) => {
      refresh(order.id);
      setStatusRequest(null);
      toast.success(`${order.orderNumber} moved to ${orderStatusLabel(to)}`);
    },
    onError: (err) => toast.error(errorText(err, "Failed to update order status")),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ orders, to, note }: { orders: StatusChangeOrder[]; to: OrderStatus; note?: string }) =>
      adminOrdersApi.bulkUpdateOrderStatus(orders.map((o) => o.id), to, note),
    // Each order is its own transaction server-side: some may commit before another is refused — refetch either way.
    onSettled: () => refresh(),
    onSuccess: (result, { orders, to }) => {
      setStatusRequest(null);
      reportBulk(
        `Move to ${orderStatusLabel(to)}`,
        "Updated",
        orders,
        { succeeded: [...result.updated, ...result.unchanged], failed: result.failed },
      );
    },
    onError: (err) => toast.error(errorText(err, "Bulk status update failed")),
  });

  function requestStatusChange(orders: StatusChangeOrder[], to: OrderStatus) {
    if (orders.length === 0) return;
    if (orders.length === 1 && orders[0]!.status === to) return;
    setStatusRequest({ orders, to });
  }

  function confirmStatusChange(note: string) {
    if (!statusRequest) return;
    const { orders, to } = statusRequest;
    if (orders.length === 1) statusMutation.mutate({ order: orders[0]!, to, note });
    else bulkStatusMutation.mutate({ orders, to, note });
  }

  // ── trash / restore / permanent delete ──────────────────────────────────────
  const trashMutation = useMutation({
    mutationFn: (order: OrderRef) => adminOrdersApi.deleteOrder(order.id),
    onSuccess: (_, order) => {
      refresh(order.id);
      toast.success(`${order.orderNumber} moved to Trash`);
    },
    onError: (err) => toast.error(errorText(err, "Failed to move the order to Trash")),
  });
  const restoreMutation = useMutation({
    mutationFn: (order: OrderRef) => adminOrdersApi.restoreOrder(order.id),
    onSuccess: (_, order) => {
      refresh(order.id);
      toast.success(`${order.orderNumber} restored`);
    },
    onError: (err) => toast.error(errorText(err, "Failed to restore the order")),
  });
  const purgeMutation = useMutation({
    mutationFn: (order: OrderRef) => adminOrdersApi.permanentlyDeleteOrder(order.id),
    onSuccess: (_, order) => {
      refresh();
      queryClient.removeQueries({ queryKey: orderKeys.detail(order.id) });
      toast.success(`${order.orderNumber} permanently deleted`);
      onPurged?.(order.id);
    },
    onError: (err) => toast.error(errorText(err, "Failed to permanently delete the order")),
  });
  const bulkTrashMutation = useMutation({
    mutationFn: (orders: OrderRef[]) => adminOrdersApi.bulkDeleteOrders(orders.map((o) => o.id)),
    onSettled: () => refresh(),
    onSuccess: (outcome, orders) => reportBulk("Move to Trash", "Moved to Trash", orders, outcome),
    onError: (err) => toast.error(errorText(err, "Bulk move to Trash failed")),
  });
  const bulkRestoreMutation = useMutation({
    mutationFn: (orders: OrderRef[]) => adminOrdersApi.bulkRestoreOrders(orders.map((o) => o.id)),
    onSettled: () => refresh(),
    onSuccess: (outcome, orders) => reportBulk("Restore from Trash", "Restored", orders, outcome),
    onError: (err) => toast.error(errorText(err, "Bulk restore failed")),
  });
  const bulkPurgeMutation = useMutation({
    mutationFn: (orders: OrderRef[]) => adminOrdersApi.bulkPermanentlyDeleteOrders(orders.map((o) => o.id)),
    onSettled: () => refresh(),
    onSuccess: (outcome, orders) => reportBulk("Delete permanently", "Deleted", orders, outcome),
    onError: (err) => toast.error(errorText(err, "Bulk permanent delete failed")),
  });

  /** Mirrors deleteOrder: only an order whose goods haven't left gives its reserved stock back. */
  const releasesStock = (o: TrashableOrder) => PRE_SHIPMENT_STATUSES.includes(o.status);

  async function trash(order: TrashableOrder) {
    const stock = releasesStock(order) ? " Its reserved stock goes back to inventory." : "";
    if (!(await confirm(`Move ${order.orderNumber} to Trash?${stock} You can restore it from the Trash view.`, { confirmLabel: "Move to Trash" }))) return;
    trashMutation.mutate(order);
  }
  async function restore(order: TrashableOrder) {
    const stock = releasesStock(order) ? " Its items are reserved again — if that stock has sold since, the restore is refused." : "";
    if (!(await confirm(`Restore ${order.orderNumber}?${stock}`, { confirmLabel: "Restore", tone: "default" }))) return;
    restoreMutation.mutate(order);
  }
  async function purge(order: OrderRef) {
    const ok = await confirm(`Permanently delete ${order.orderNumber}? Its line items and history are removed forever — this cannot be undone.`, {
      confirmLabel: "Delete forever",
      requireText: order.orderNumber,
      title: "Delete permanently",
    });
    if (ok) purgeMutation.mutate(order);
  }
  async function bulkTrash(orders: TrashableOrder[]) {
    const releasing = orders.filter(releasesStock).length;
    const stock = releasing > 0 ? ` ${releasing} of them still hold reserved stock, which goes back to inventory.` : "";
    if (!(await confirm(`Move ${orders.length} order(s) to Trash?${stock}`, { confirmLabel: "Move to Trash" }))) return;
    bulkTrashMutation.mutate(orders);
  }
  async function bulkRestore(orders: OrderRef[]) {
    if (!(await confirm(`Restore ${orders.length} order(s)? Pre-shipment orders reserve their stock again; any whose stock has sold since are reported, not restored.`, { confirmLabel: "Restore", tone: "default" }))) return;
    bulkRestoreMutation.mutate(orders);
  }
  async function bulkPurge(orders: OrderRef[]) {
    const ok = await confirm(`Permanently delete ${orders.length} order(s)? Their line items and history are removed forever — this cannot be undone.`, {
      confirmLabel: "Delete forever",
      requireText: "DELETE",
      title: "Delete permanently",
    });
    if (ok) bulkPurgeMutation.mutate(orders);
  }

  // ── courier ─────────────────────────────────────────────────────────────────
  const bookMutation = useMutation({
    mutationFn: (order: OrderRef) => adminOrdersApi.bookCourier(order.id),
    onSuccess: (_, order) => {
      refresh(order.id);
      toast.success(`${order.orderNumber} booked with ${COURIER_PROVIDER_LABEL}`);
    },
    onError: (err) => toast.error(errorText(err, `Failed to book with ${COURIER_PROVIDER_LABEL}`)),
  });
  const syncMutation = useMutation({
    mutationFn: (order: OrderRef) => adminOrdersApi.refreshCourierStatus(order.id),
    onSuccess: (_, order) => {
      refresh(order.id);
      toast.success("Courier status synced");
    },
    onError: (err) => toast.error(errorText(err, "Courier sync failed")),
  });
  const unlinkMutation = useMutation({
    mutationFn: (order: OrderRef) => adminOrdersApi.unlinkCourier(order.id),
    onSuccess: (_, order) => {
      refresh(order.id);
      toast.success("Courier booking unlinked — the order can be booked again");
    },
    onError: (err) => toast.error(errorText(err, "Failed to unlink the courier booking")),
  });
  const bulkBookMutation = useMutation({
    mutationFn: (orders: OrderRef[]) => adminOrdersApi.bulkBookCourier(orders.map((o) => o.id)),
    onSettled: () => refresh(),
    onSuccess: (r, orders) =>
      reportBulk(`Book with ${COURIER_PROVIDER_LABEL}`, "Booked", orders, {
        succeeded: r.booked.map((b) => b.orderId),
        failed: r.failed.map((f) => ({ id: f.orderId, orderNumber: f.orderNumber, reason: f.reason })),
      }),
    onError: (err) => toast.error(errorText(err, "Bulk courier booking failed")),
  });
  const bulkSyncMutation = useMutation({
    mutationFn: (orders: OrderRef[]) => adminOrdersApi.bulkSyncCourier(orders.map((o) => o.id)),
    onSettled: () => refresh(),
    onSuccess: (r, orders) => {
      const statusById = new Map(r.synced.map((s) => [s.orderId, courierStatusLabel(s.courierStatus)]));
      const numberOf = new Map(orders.map((o) => [o.id, o.orderNumber]));
      const result: BulkResult = {
        title: "Sync courier status",
        succeededLabel: "Synced",
        succeeded: r.synced.map((s) => ({ orderId: s.orderId, orderNumber: s.orderNumber ?? numberOf.get(s.orderId) ?? s.orderId, detail: statusById.get(s.orderId) })),
        failed: r.failed.map((f) => ({ orderId: f.orderId, orderNumber: f.orderNumber, detail: f.reason })),
      };
      if (result.failed.length === 0) toast.success(`${result.succeeded.length} order(s) synced`);
      else setBulkResult(result);
    },
    onError: (err) => toast.error(errorText(err, "Bulk courier sync failed")),
  });
  const scoreMutation = useMutation({
    mutationFn: ({ orders }: { orders: OrderRef[]; quiet?: boolean }) => adminOrdersApi.bulkCheckDeliveryScore(orders.map((o) => o.id)),
    onSettled: () => refresh(),
    onSuccess: (r, { quiet }) => {
      if (quiet) {
        if (r.failed.length > 0) toast.error(r.failed[0]!.reason);
        return;
      }
      const result: BulkResult = {
        title: "Delivery score check",
        succeededLabel: "Checked",
        succeeded: r.checked.map((c) => ({
          orderId: c.orderId,
          orderNumber: c.orderNumber,
          detail: `${c.successRate === null ? "No history" : `${c.successRate}%`} (${c.volumeRange ?? c.totalParcels} parcel${(c.volumeRange ?? String(c.totalParcels)) === "1" ? "" : "s"})`,
        })),
        failed: r.failed.map((f) => ({ orderId: f.orderId, orderNumber: f.orderNumber, detail: f.reason })),
      };
      setBulkResult(result);
    },
    onError: (err) => toast.error(errorText(err, "Delivery score check failed")),
  });

  /** `codToCollect` is the ledger's figure when the caller has it (detail view); a list row doesn't, so it isn't guessed. */
  async function bookCourier(order: OrderRef & Pick<Order, "customerName" | "customerPhone">, codToCollect?: number) {
    const cod =
      codToCollect === undefined
        ? "The courier collects the order's balance due, as calculated by the server at booking."
        : `COD to collect: ${formatPrice(codToCollect)}.`;
    const ok = await confirm(`Book delivery with ${COURIER_PROVIDER_LABEL} for ${order.customerName} (${order.customerPhone})? ${cod}`, {
      confirmLabel: "Book courier",
      tone: "default",
      title: "Book courier",
      details: <p className="text-xs text-ink-500">A pre-shipment order moves to Packed once booked. Name, address and price lock until the booking is unlinked.</p>,
    });
    if (ok) bookMutation.mutate(order);
  }
  async function bulkBook(orders: OrderRef[]) {
    const ok = await confirm(`Book ${orders.length} order(s) with ${COURIER_PROVIDER_LABEL}? Orders already booked, closed or in Trash are skipped and reported.`, {
      confirmLabel: "Book courier",
      tone: "default",
      title: "Book courier",
    });
    if (ok) bulkBookMutation.mutate(orders);
  }
  async function unlinkCourier(order: OrderRef) {
    const ok = await confirm(
      `Unlink the courier booking of ${order.orderNumber}? Only do this if the consignment was cancelled or deleted in the courier's own panel — nothing is cancelled on the courier's side; the link here is cleared so the order can be booked again.`,
      { confirmLabel: "Unlink booking", title: "Unlink courier booking" },
    );
    if (ok) unlinkMutation.mutate(order);
  }

  function printLabels(ids: string[]) {
    sessionStorage.setItem(adminOrdersApi.PRINT_LABEL_ORDER_IDS_KEY, JSON.stringify(ids));
    router.push("/admin/orders/print-labels");
  }

  const dialogs: ReactNode = (
    <>
      {confirmDialog}
      <StatusChangeDialog
        request={statusRequest}
        pending={statusMutation.isPending || bulkStatusMutation.isPending}
        onCancel={() => setStatusRequest(null)}
        onConfirm={confirmStatusChange}
      />
      <BulkResultDialog result={bulkResult} onClose={() => setBulkResult(null)} onOpenOrder={(id) => onOpenOrder?.(id)} />
    </>
  );

  return {
    dialogs,
    confirm,
    requestStatusChange,
    trash,
    restore,
    purge,
    bulkTrash,
    bulkRestore,
    bulkPurge,
    bookCourier,
    bulkBook,
    syncCourier: (order: OrderRef) => syncMutation.mutate(order),
    bulkSync: (orders: OrderRef[]) => bulkSyncMutation.mutate(orders),
    unlinkCourier,
    checkDeliveryScore: (orders: OrderRef[], quiet = false) => scoreMutation.mutate({ orders, quiet }),
    printLabels,
    pending: {
      status: statusMutation.isPending || bulkStatusMutation.isPending,
      trash: trashMutation.isPending || bulkTrashMutation.isPending,
      restore: restoreMutation.isPending || bulkRestoreMutation.isPending,
      purge: purgeMutation.isPending || bulkPurgeMutation.isPending,
      book: bookMutation.isPending || bulkBookMutation.isPending,
      sync: syncMutation.isPending || bulkSyncMutation.isPending,
      unlink: unlinkMutation.isPending,
      score: scoreMutation.isPending,
      /** The single order whose delivery score is being checked, for a per-row spinner. */
      scoreOrderId: scoreMutation.isPending && scoreMutation.variables?.orders.length === 1 ? scoreMutation.variables.orders[0]!.id : null,
    },
  };
}

export type OrderCommands = ReturnType<typeof useOrderCommands>;
