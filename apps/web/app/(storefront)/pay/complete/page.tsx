"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";

/** Where the gateway returns the customer after a payment-link / order-change payment. The server has already recorded the
 * outcome (and the gateway's own server notification is authoritative); this page only tells the customer. */
function Result() {
  const params = useSearchParams();
  const ok = params.get("status") === "success";
  const order = params.get("order");
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center" data-testid="pay-complete">
      <span className={`mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full ${ok ? "bg-success-100 text-success-600" : "bg-danger-100 text-danger-600"}`}>
        {ok ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
      </span>
      <h1 className="mb-2 font-display text-2xl text-ink-900">{ok ? "Payment received" : "Payment not completed"}</h1>
      <p className="mb-6 text-sm text-ink-500">
        {ok
          ? `Thank you — your payment${order ? ` for order ${order}` : ""} has been received.`
          : "No money was taken. You can open the payment link again to retry, or contact us."}
      </p>
      {order && (
        <Link href={`/order-confirmation/${encodeURIComponent(order)}`} className="text-sm font-medium text-brass-700 underline">
          View order
        </Link>
      )}
    </div>
  );
}

export default function PayCompletePage() {
  return (
    <Suspense fallback={null}>
      <Result />
    </Suspense>
  );
}
