"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StorefrontPage, StorefrontPageHeader } from "@/components/storefront/storefront-page";

/** Where the gateway returns the customer after a payment-link / order-change payment. The server has already recorded the
 * outcome (and the gateway's own server notification is authoritative); this page only tells the customer. */
function Result() {
  const params = useSearchParams();
  const ok = params.get("status") === "success";
  const order = params.get("order");
  return (
    <StorefrontPage>
      <div data-testid="pay-complete">
        <StorefrontPageHeader
          eyebrow={
            <span className={`inline-flex items-center gap-1.5 ${ok ? "text-success-700" : "text-danger-600"}`}>
              {ok ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
              {ok ? "Paid" : "Not paid"}
            </span>
          }
          title={ok ? "Payment received" : "Payment not completed"}
          description={
            ok
              ? `Thank you — your payment${order ? ` for order ${order}` : ""} has been received.`
              : "No money was taken. You can open the payment link again to retry, or contact us."
          }
        />
        {order && (
          <Link href={`/order-confirmation/${encodeURIComponent(order)}`} className={buttonVariants({ variant: "primary", size: "lg" })}>
            View order
          </Link>
        )}
      </div>
    </StorefrontPage>
  );
}

export default function PayCompletePage() {
  return (
    <Suspense fallback={null}>
      <Result />
    </Suspense>
  );
}
