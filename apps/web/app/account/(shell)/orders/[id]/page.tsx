"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { getMyOrder } from "@/lib/api/customers";
import { createReturnRequest } from "@/lib/api/return-requests";
import { useCartStore } from "@/store/cart";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

const RETURN_REASONS = [
  "Wrong item received",
  "Item damaged or defective",
  "Item doesn't fit",
  "No longer needed",
  "Other",
];

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending confirmation",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
};

export default function AccountOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const addItem = useCartStore((s) => s.addItem);

  const [showReturnForm, setShowReturnForm] = useState(false);
  const [reason, setReason] = useState(RETURN_REASONS[0]!);
  const [note, setNote] = useState("");
  const [returnError, setReturnError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["my-order", id], queryFn: () => getMyOrder(id) });

  const returnMutation = useMutation({
    mutationFn: () => createReturnRequest({ orderId: id, reason, note: note || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-order", id] });
      setShowReturnForm(false);
      setNote("");
      toast.success("Return request submitted");
    },
    onError: (err) => setReturnError(err instanceof ApiError ? err.message : "Could not submit return request"),
  });

  if (isLoading || !data) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-7 w-40 rounded bg-ink-100" />
            <div className="h-3 w-32 rounded bg-ink-100" />
          </div>
          <div className="h-8 w-24 rounded bg-ink-100" />
        </div>
        <div className="h-32 rounded-lg border border-ink-100 bg-ink-50" />
        <div className="h-40 rounded-lg border border-ink-100 bg-ink-50" />
      </div>
    );
  }

  const { order } = data;
  const latestReturnRequest = order.returnRequests?.[0];
  const canRequestReturn =
    order.status === "DELIVERED" && !order.returnRequests?.some((r) => r.status === "PENDING" || r.status === "APPROVED");

  function handleReorder() {
    const available = order.items.filter((item) => item.live);
    const skipped = order.items.length - available.length;

    for (const item of available) {
      const live = item.live!;
      addItem(
        {
          variantId: item.variantId,
          productId: live.productId,
          productSlug: live.productSlug,
          productName: live.productName,
          sku: item.skuSnapshot,
          size: item.sizeSnapshot,
          color: item.colorSnapshot,
          price: live.price,
          imageUrl: live.imageUrl,
          maxStock: live.maxStock,
        },
        Math.min(item.quantity, live.maxStock),
      );
    }

    if (available.length === 0) {
      toast.error("None of these items are available to reorder right now");
      return;
    }
    toast.success(skipped > 0 ? `Added ${available.length} item(s) — ${skipped} no longer available` : "Added to cart");
    router.push("/cart");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{order.orderNumber}</h1>
          <p className="text-sm text-ink-500">Placed {new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/account/orders/${id}/invoice`} target="_blank">
            <Button variant="outline" size="sm">
              <Printer size={14} /> Invoice
            </Button>
          </Link>
          <Button variant="brass" size="sm" onClick={handleReorder}>
            <RotateCcw size={14} /> Reorder
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Status</CardTitle>
          <Badge>{STATUS_LABELS[order.status] ?? order.status}</Badge>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 border-l border-ink-100 pl-4">
            {order.statusHistory.map((entry) => (
              <li key={entry.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brass-400" />
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink-900">{STATUS_LABELS[entry.status] ?? entry.status}</span>
                  <span className="text-xs text-ink-400">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
                {entry.note && <p className="mt-0.5 text-ink-600">{entry.note}</p>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-ink-900">
                    {item.productNameSnapshot} ({item.sizeSnapshot}/{item.colorSnapshot}) × {item.quantity}
                  </p>
                  {!item.live && <p className="text-xs text-ink-400">No longer available</p>}
                </div>
                <span className="text-ink-600">{formatPrice(Number(item.priceSnapshot) * item.quantity)}</span>
              </div>
            ))}
          </div>

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
        </CardContent>
      </Card>

      {(latestReturnRequest || canRequestReturn) && (
        <Card>
          <CardHeader>
            <CardTitle>Return &amp; Refund</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {latestReturnRequest && (
              <div className="text-sm text-ink-700">
                <p>
                  Return request: <span className="font-medium text-ink-900">{latestReturnRequest.status}</span>
                </p>
                <p className="mt-0.5 text-ink-500">Reason: {latestReturnRequest.reason}</p>
                {latestReturnRequest.status === "APPROVED" && (
                  <p className="mt-0.5 text-ink-500">
                    Refund status follows the order status above — currently{" "}
                    <span className="font-medium">{STATUS_LABELS[order.status] ?? order.status}</span>.
                  </p>
                )}
                {latestReturnRequest.status === "REJECTED" && latestReturnRequest.adminNote && (
                  <p className="mt-0.5 text-ink-500">Note: {latestReturnRequest.adminNote}</p>
                )}
              </div>
            )}

            {canRequestReturn && !showReturnForm && (
              <Button variant="outline" size="sm" onClick={() => setShowReturnForm(true)}>
                Request Return
              </Button>
            )}

            {canRequestReturn && showReturnForm && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="reason">Reason</Label>
                  <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                    {RETURN_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="note">Note (optional)</Label>
                  <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                {returnError && <p className="text-xs text-danger-600">{returnError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowReturnForm(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="brass"
                    size="sm"
                    disabled={returnMutation.isPending}
                    onClick={() => {
                      setReturnError(null);
                      returnMutation.mutate();
                    }}
                  >
                    {returnMutation.isPending ? "Submitting…" : "Submit request"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
