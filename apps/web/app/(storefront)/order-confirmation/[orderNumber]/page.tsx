"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { estimateDelivery, type Order } from "@clothing-brand/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { StorefrontPage, StorefrontPageHeader } from "@/components/storefront/storefront-page";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { OrderSummaryCard } from "@/components/storefront/order-summary-card";
import { InstallAppCard } from "@/components/storefront/install-app-card";
import { trackOrder, retryPayment } from "@/lib/api/orders";
import { ApiError } from "@/lib/api-client";
import { formatDateShort } from "@/lib/format";
import { pixelPurchase } from "@/lib/pixels";
import { useCartStore } from "@/store/cart";
import { sessionGet, sessionSet } from "@/lib/safe-storage";
import { storeLayout } from "@/lib/theme-layout";
import { TahafiOrderTag } from "@/components/storefront/presets/tahafi/order-tag";

const SESSION_KEY = "lastOrderPhone";
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
      // sessionStorage dedupe, so a refresh doesn't re-fire it.
      if (found.paymentMethod !== "COD" && found.paymentStatus === "PAID") {
        const toastKey = `${PAYMENT_TOAST_KEY}:${found.orderNumber}`;
        if (!sessionGet(toastKey)) {
          sessionSet(toastKey, "1");
          toast.success("Payment Successful");
          clearCart();
        }
      }

      // `found` is the order as the backend has it — pixelPurchase itself decides whether it's a real
      // completed purchase (not an unpaid/cancelled online attempt, not an old order looked up
      // again) and guards against refreshes; the API already sent the server-side twin.
      pixelPurchase(found);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not find this order");
    }
  }

  useEffect(() => {
    const remembered = sessionGet(SESSION_KEY);
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
      <StorefrontPage>
        <StorefrontPageHeader eyebrow="Your order" title={orderNumber} />
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
          <div className="ui-skeleton h-72 rounded-2xl" />
        </div>
      </StorefrontPage>
    );
  }

  if (!order) {
    return (
      <StorefrontPage>
        <StorefrontPageHeader
          eyebrow="Your order"
          title="Find your order"
          description={
            <>
              Enter the phone number used for order <span className="text-ink-900">{orderNumber}</span>.
            </>
          }
        />
        <form onSubmit={handleSubmit} className="max-w-[26rem] space-y-4 rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-8">
          <div>
            <Label htmlFor="phone">Phone number</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" />
          </div>
          {error && <p className="text-sm text-danger-600">{error}</p>}
          <Button type="submit" variant="brass" className="w-full">
            View order
          </Button>
        </form>
      </StorefrontPage>
    );
  }

  if (isCancelledUnpaid(order)) {
    return (
      <StorefrontPage>
        <StorefrontPageHeader
          eyebrow={<StatusLabel icon={<XCircle size={14} aria-hidden="true" />} text="Cancelled" />}
          title="This order was cancelled"
          description={
            <>
              Order <span className="text-ink-900">{order.orderNumber}</span> was cancelled before payment completed.
            </>
          }
        />
        <Link href="/" className={buttonVariants({ variant: "primary", size: "lg" })}>
          Continue shopping
        </Link>
      </StorefrontPage>
    );
  }

  if (needsPaymentRetry(order)) {
    return (
      <StorefrontPage>
        <StorefrontPageHeader
          eyebrow={<StatusLabel icon={<Clock3 size={14} aria-hidden="true" />} text="Waiting for payment" />}
          title="Payment incomplete"
          description={
            <>
              Order <span className="text-ink-900">{order.orderNumber}</span> was placed, but we haven&apos;t received payment for it yet.
            </>
          }
        />
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
          <OrderSummaryCard order={order} />
          <aside className="space-y-3">
            {retryError && <p className="text-sm text-danger-600">{retryError}</p>}
            <Button variant="brass" size="lg" className="w-full" onClick={handleRetry} disabled={retrying}>
              {retrying ? "Redirecting…" : "Retry payment"}
            </Button>
          </aside>
        </div>
      </StorefrontPage>
    );
  }

  const deliveryEstimate = estimateDelivery(order.shippingDistrict, new Date(order.createdAt));

  return (
    <StorefrontPage>
      {/* Tahafi: the order on a hang-tag (presets/tahafi/order-tag.tsx) in place of the page heading. */}
      {storeLayout() === "tahafi" ? (
        <TahafiOrderTag order={order} arrives={deliveryEstimate} />
      ) : (
      <StorefrontPageHeader
        eyebrow={<StatusLabel icon={<CheckCircle2 size={14} aria-hidden="true" />} text="Order placed" tone="success" />}
        title={<>Thank you, {order.customerName.split(" ")[0]}!</>}
        description={
          <>
            Your order <span className="text-ink-900">{order.orderNumber}</span> is in. Estimated delivery {formatDateShort(deliveryEstimate.minDate)} –{" "}
            {formatDateShort(deliveryEstimate.maxDate)}.
          </>
        }
      />
      )}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
        <OrderSummaryCard order={order} />
        <aside className="space-y-4">
          <Link href="/" className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })}>
            Continue shopping
          </Link>
          <Link href="/track-order" className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })}>
            Track an order
          </Link>
          {/* Right after an order is when a home-screen shortcut is most useful: tracking it, and coming back. */}
          <InstallAppCard />
        </aside>
      </div>
    </StorefrontPage>
  );
}

/** The order's state above its title: an icon and a word, in the state's colour. */
function StatusLabel({ icon, text, tone = "muted" }: { icon: React.ReactNode; text: string; tone?: "muted" | "success" }) {
  return (
    <span className={tone === "success" ? "inline-flex items-center gap-1.5 text-success-700" : "inline-flex items-center gap-1.5 text-ink-500"}>
      {icon}
      {text}
    </span>
  );
}
