"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Truck } from "lucide-react";
import type { OrderStatus, UpdateOrderDetailsInput } from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [statusNote, setStatusNote] = useState("");
  const [tracking, setTracking] = useState<{ trackingNumber: string; carrier: string } | null>(null);
  const [adminNotes, setAdminNotes] = useState<string | null>(null);

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
      toast.success("Order updated");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to save"),
  });

  if (isLoading || !data) return <p className="text-ink-400">Loading…</p>;

  const { order } = data;
  const trackingValue = tracking ?? { trackingNumber: order.trackingNumber ?? "", carrier: order.carrier ?? "" };
  const notesValue = adminNotes ?? order.adminNotes ?? "";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{order.orderNumber}</h1>
          <p className="text-sm text-ink-500">Placed {new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/admin/orders/${id}/invoice`} target="_blank">
            <Button variant="outline" size="sm">
              <Printer size={14} /> Invoice
            </Button>
          </Link>
          <button onClick={() => router.push("/admin/orders")} className="text-sm text-ink-500 hover:text-ink-900">
            Back to orders
          </button>
        </div>
      </div>

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
              disabled={statusMutation.isPending}
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
              className="max-w-xs"
            />
          </div>

          <ol className="mt-4 space-y-3 border-l border-ink-100 pl-4">
            {order.statusHistory.map((entry) => (
              <li key={entry.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brass-400" />
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
            <Truck size={16} className="text-brass-500" /> Shipping & Tracking
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="carrier">Carrier</Label>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-ink-700">
            <p>{order.customerName}</p>
            <p>{order.customerPhone}</p>
            {order.customerEmail && <p>{order.customerEmail}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shipping Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-ink-700">
            <p>{order.shippingAddressLine}</p>
            <p>
              {order.shippingArea}, {order.shippingDistrict}
            </p>
            <p>{order.shippingDivision}</p>
          </CardContent>
        </Card>
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
                    {item.productNameSnapshot}
                    <span className="text-ink-400"> ({item.sizeSnapshot}/{item.colorSnapshot})</span>
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
    </div>
  );
}
