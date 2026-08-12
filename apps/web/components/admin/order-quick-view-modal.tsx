"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderStatus } from "@clothing-brand/shared";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

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

interface OrderQuickViewModalProps {
  orderId: string | null;
  onClose: () => void;
}

/** A fast "glance and triage" view for the orders list — customer/items/status only. Deliberately
 * excludes courier booking, tracking fields, admin notes, and the invoice link, which stay
 * detail-page-only so this doesn't become a second copy of that page. */
export function OrderQuickViewModal({ orderId, onClose }: OrderQuickViewModalProps) {
  const queryClient = useQueryClient();
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | "">("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-order", orderId],
    queryFn: () => adminOrdersApi.getOrder(orderId!),
    enabled: Boolean(orderId),
  });

  const statusMutation = useMutation({
    mutationFn: (status: OrderStatus) => adminOrdersApi.updateOrderStatus(orderId!, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-order-stats"] });
      setPendingStatus("");
      toast.success("Order status updated");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update status"),
  });

  const order = data?.order;

  return (
    <Modal open={Boolean(orderId)} onClose={onClose} title={order?.orderNumber ?? "Order"} widthClassName="max-w-2xl">
      {isLoading || !order ? (
        <p className="py-6 text-center text-sm text-ink-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm text-ink-700">
              <p className="font-medium text-ink-900">{order.customerName}</p>
              <p>{order.customerPhone}</p>
              <p className="text-ink-500">
                {order.shippingArea}, {order.shippingDistrict}, {order.shippingDivision}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge>{order.paymentMethod === "COD" ? "COD" : "Online"}</Badge>
              <Badge className={order.paymentStatus === "PAID" ? "bg-success-100 text-success-700" : ""}>
                {order.paymentStatus}
              </Badge>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-ink-100">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} className="border-t border-ink-100">
                    <td className="px-3 py-2">
                      {item.productNameSnapshot}
                      <span className="text-ink-400">
                        {" "}
                        ({item.sizeSnapshot}/{item.colorSnapshot})
                      </span>
                    </td>
                    <td className="px-3 py-2">{item.quantity}</td>
                    <td className="px-3 py-2 text-right">{formatPrice(Number(item.priceSnapshot) * item.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-500">Total</span>
            <span className="text-base font-semibold text-ink-900">{formatPrice(order.total)}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
            <Select
              value={pendingStatus || order.status}
              onChange={(e) => setPendingStatus(e.target.value as OrderStatus)}
              disabled={statusMutation.isPending || Boolean(order.deletedAt)}
              className="w-44"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              disabled={!pendingStatus || pendingStatus === order.status || statusMutation.isPending}
              onClick={() => pendingStatus && statusMutation.mutate(pendingStatus)}
            >
              Update status
            </Button>
            <Link href={`/admin/orders/${order.id}`} className="ml-auto text-sm text-brass-600 hover:underline">
              View full order →
            </Link>
          </div>
        </div>
      )}
    </Modal>
  );
}
