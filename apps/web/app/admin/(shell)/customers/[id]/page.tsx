"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import * as adminCustomersApi from "@/lib/api/admin-customers";
import { formatPrice } from "@/lib/format";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-customer", id],
    queryFn: () => adminCustomersApi.getCustomer(id),
  });

  if (isLoading || !data) return <p className="text-ink-400">Loading…</p>;

  const { customer } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{customer.name}</h1>
          <p className="text-sm text-ink-500">
            {customer.email} · Joined {new Date(customer.createdAt).toLocaleDateString()}
          </p>
        </div>
        <button onClick={() => router.push("/admin/customers")} className="text-sm text-ink-500 hover:text-ink-900">
          Back to customers
        </button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-ink-700">
          <p>Name: {customer.name}</p>
          <p>Email: {customer.email}</p>
          <p>Phone: {customer.phone ?? "—"}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Addresses ({customer.addresses.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-ink-700">
          {customer.addresses.length === 0 && <p className="text-ink-400">No saved addresses.</p>}
          {customer.addresses.map((address) => (
            <div key={address.id} className="rounded border border-ink-100 p-3">
              <div className="flex items-center gap-2">
                <p className="font-medium text-ink-900">{address.fullName}</p>
                {address.isDefault && <Badge>Default</Badge>}
              </div>
              <p>{address.phone}</p>
              <p>
                {address.addressLine}, {address.area}, {address.district}, {address.division}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Orders ({customer.orders.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {customer.orders.length === 0 && <p className="text-ink-400">No orders yet.</p>}
          {customer.orders.map((order) => (
            <div key={order.id} className="flex items-center justify-between rounded border border-ink-100 p-3">
              <div>
                <Link href={`/admin/orders/${order.id}`} className="text-brass-600 hover:underline">
                  {order.orderNumber}
                </Link>
                <p className="text-xs text-ink-400">{new Date(order.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <span>{formatPrice(order.total)}</span>
                <Badge>{order.status}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Wishlist ({customer.wishlistItems.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {customer.wishlistItems.length === 0 && <p className="text-ink-400">Empty wishlist.</p>}
          {customer.wishlistItems.map((item) => (
            <p key={item.id}>
              <Link href={`/products/${item.product.slug}`} className="text-brass-600 hover:underline">
                {item.product.name}
              </Link>
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
