"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { estimateDelivery, type Order } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { OrderSummaryCard } from "@/components/storefront/order-summary-card";
import { trackOrder, retryPayment } from "@/lib/api/orders";
import { ApiError } from "@/lib/api-client";
import { formatDateShort } from "@/lib/format";
import { pixelPurchase } from "@/lib/meta-pixel";
import { useCartStore } from "@/store/cart";

const SESSION_KEY = "lastOrderPhone";
const PIXEL_PURCHASE_KEY = "pixelPurchaseTracked";
const PAYMENT_TOAST_KEY = "paymentSuccessToastShown";

function needsPaymentRetry(order: Order) {
  return order.paymentMethod !== "COD" && order.paymentStatus !== "PAID" && order.status === "PENDING";
}

function isCancelledUnpaid(order: Order) {
  return order.paymentMethod !== "COD" && order.paymentStatus !== "PAID" && order.status === "CANCELLED";
}

export default function OrderConfirmationPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [phone, setPhone] = useState("");
  const [confirmedPhone, setConfirmedPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const clearCart = useCartStore((s) => s.clear);

  async function attempt(candidatePhone: string) {
    setError(null);
    try {
      const { order: found } = await trackOrder(orderNumber, candidatePhone);
      setOrder(found);
      setConfirmedPhone(candidatePhone);

      // Only a gateway-settled order reaches this page already PAID (COD gets its own "Order
      // placed!" toast + cart clear on the checkout page itself, before the redirect here — see
      // checkout/page.tsx's onSubmit). The digital-payment checkout never clears the client cart
      // before redirecting to the gateway (a failed/cancelled attempt must leave it untouched for
      // retry), so this is the one place a *settled* payment's cart finally gets cleared. Same
      // sessionStorage dedupe shape as the pixel-purchase guard below, so a refresh doesn't re-fire
      // either of these.
      if (found.paymentMethod !== "COD" && found.paymentStatus === "PAID") {
        const toastKey = `${PAYMENT_TOAST_KEY}:${found.orderNumber}`;
        if (!sessionStorage.getItem(toastKey)) {
          sessionStorage.setItem(toastKey, "1");
          toast.success("Payment Successful");
          clearCart();
        }
      }

      // Guards against double-counting the same order as a Purchase on a page refresh or a
      // second phone-lookup submit — sessionStorage, not a ref, since a fresh mount (refresh)
      // would otherwise re-fire it.
      const trackedKey = `${PIXEL_PURCHASE_KEY}:${found.orderNumber}`;
      if (!sessionStorage.getItem(trackedKey)) {
        sessionStorage.setItem(trackedKey, "1");
        pixelPurchase({
          contentIds: found.items.map((i) => i.variantId),
          value: Number(found.total),
          numItems: found.items.reduce((sum, i) => sum + i.quantity, 0),
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not find this order");
    }
  }

  useEffect(() => {
    const remembered = sessionStorage.getItem(SESSION_KEY);
    if (remembered) {
      attempt(remembered).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await attempt(phone);
  }

  async function handleRetry() {
    if (!order) return;
    setRetryError(null);
    setRetrying(true);
    try {
      const { gatewayUrl } = await retryPayment(order.orderNumber, confirmedPhone);
      window.location.href = gatewayUrl;
    } catch (err) {
      setRetryError(err instanceof ApiError ? err.message : "Could not start a new payment attempt");
      setRetrying(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl animate-pulse px-4 py-16 text-center sm:px-6 lg:px-8">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-ink-100" />
        <div className="mx-auto h-8 w-64 rounded bg-ink-100" />
        <div className="mx-auto mt-3 h-4 w-48 rounded bg-ink-100" />
        <div className="mx-auto mt-8 h-48 rounded-lg border border-ink-100 bg-ink-50" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-sm px-4 py-24 sm:px-6 lg:px-8">
        <h1 className="mb-2 font-display text-2xl text-ink-900">Find your order</h1>
        <p className="mb-6 text-sm text-ink-500">
          Enter the phone number used for order <span className="text-ink-900">{orderNumber}</span>.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="phone">Phone number</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" />
          </div>
          {error && <p className="text-sm text-danger-600">{error}</p>}
          <Button type="submit" variant="brass" className="w-full">
            View order
          </Button>
        </form>
      </div>
    );
  }

  if (isCancelledUnpaid(order)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <XCircle className="mx-auto mb-4 text-ink-400" size={48} />
        <h1 className="font-display text-3xl text-ink-900">This order was cancelled</h1>
        <p className="mt-2 text-ink-500">
          Order <span className="text-ink-900">{order.orderNumber}</span> was cancelled before payment completed.
        </p>
        <Link href="/">
          <Button variant="brass" className="mt-8">
            Continue Shopping
          </Button>
        </Link>
      </div>
    );
  }

  if (needsPaymentRetry(order)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <Clock3 className="mx-auto mb-4 text-amber-500" size={48} />
        <h1 className="font-display text-3xl text-ink-900">Payment incomplete</h1>
        <p className="mt-2 text-ink-500">
          Order <span className="text-ink-900">{order.orderNumber}</span> was placed, but we haven&apos;t received
          payment for it yet.
        </p>

        <div className="mt-8">
          <OrderSummaryCard order={order} />
        </div>

        {retryError && <p className="mt-4 text-sm text-danger-600">{retryError}</p>}
        <Button variant="brass" className="mt-8" onClick={handleRetry} disabled={retrying}>
          {retrying ? "Redirecting…" : "Retry payment"}
        </Button>
      </div>
    );
  }

  const deliveryEstimate = estimateDelivery(order.shippingDivision, new Date(order.createdAt));

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <CheckCircle2 className="mx-auto mb-4 text-brass-500" size={48} />
      <h1 className="font-display text-3xl text-ink-900">Thank you, {order.customerName.split(" ")[0]}!</h1>
      <p className="mt-2 text-ink-500">
        Your order <span className="text-ink-900">{order.orderNumber}</span> has been placed.
      </p>
      <p className="mt-1 text-sm text-ink-500">
        Estimated delivery: {formatDateShort(deliveryEstimate.minDate)} – {formatDateShort(deliveryEstimate.maxDate)}
      </p>

      <div className="mt-8">
        <OrderSummaryCard order={order} />
      </div>

      <Link href="/">
        <Button variant="outline" className="mt-8">
          Continue Shopping
        </Button>
      </Link>
    </div>
  );
}
