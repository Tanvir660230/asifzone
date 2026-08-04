"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderStatus } from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { formatPrice } from "@/lib/format";

const STATUS_OPTIONS: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
];

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-order", id],
    queryFn: () => adminOrdersApi.getOrder(id),
  });

  async function handleStatusChange(status: OrderStatus) {
    await adminOrdersApi.updateOrderStatus(id, status);
    queryClient.invalidateQueries({ queryKey: ["admin-order", id] });
    queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
  }

  if (isLoading || !data) return <p className="text-ink-400">Loading…</p>;

  const { order } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{order.orderNumber}</h1>
          <p className="text-sm text-ink-500">Placed {new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <button onClick={() => router.push("/admin/orders")} className="text-sm text-ink-500 hover:text-ink-900">
          Back to orders
        </button>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Status</CardTitle>
          <div className="flex items-center gap-3">
            <Badge>{order.paymentStatus}</Badge>
            <Select value={order.status} onChange={(e) => handleStatusChange(e.target.value as OrderStatus)} className="w-44">
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>
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
              <span className="font-medium text-ink-900">Notes: </span>
              {order.notes}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
