"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Gift } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import * as adminCustomersApi from "@/lib/api/admin-customers";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pointsDelta, setPointsDelta] = useState("");
  const [pointsReason, setPointsReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-customer", id],
    queryFn: () => adminCustomersApi.getCustomer(id),
  });

  const adjustMutation = useMutation({
    mutationFn: () => adminCustomersApi.adjustPoints(id, Number(pointsDelta), pointsReason || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-customer", id] });
      toast.success("Points adjusted");
      setPointsDelta("");
      setPointsReason("");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to adjust points"),
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

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-ink-700">
            <p>Name: {customer.name}</p>
            <p>Email: {customer.email}</p>
            <p>Phone: {customer.phone ?? "—"}</p>
            <p>Total spent: <span className="font-medium text-ink-900">{formatPrice(customer.totalSpent)}</span></p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift size={16} className="text-brass-500" /> Reward Points
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-2xl font-display text-ink-900">{customer.rewardPoints.toLocaleString()}</p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="+/- points"
                value={pointsDelta}
                onChange={(e) => setPointsDelta(e.target.value)}
                className="w-28"
              />
              <Input
                placeholder="Reason"
                value={pointsReason}
                onChange={(e) => setPointsReason(e.target.value)}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!pointsDelta || Number(pointsDelta) === 0 || adjustMutation.isPending}
                onClick={() => adjustMutation.mutate()}
              >
                Apply
              </Button>
            </div>
            {customer.pointsLedger.length > 0 && (
              <ul className="max-h-32 space-y-1 overflow-y-auto border-t border-ink-100 pt-2 text-xs text-ink-500">
                {customer.pointsLedger.map((entry) => (
                  <li key={entry.id} className="flex justify-between">
                    <span>{entry.reason}</span>
                    <span className={entry.points >= 0 ? "text-success-600" : "text-danger-600"}>
                      {entry.points >= 0 ? "+" : ""}
                      {entry.points}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

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
