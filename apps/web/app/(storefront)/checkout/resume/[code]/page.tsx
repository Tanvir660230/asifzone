"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StorefrontPage, StorefrontPageHeader } from "@/components/storefront/storefront-page";
import { resumeCheckoutLead } from "@/lib/api/checkout-leads";
import { saveCheckoutPrefill } from "@/lib/checkout-prefill";
import { useCartStore } from "@/store/cart";

/**
 * An incomplete order's resume link (docs/INCOMPLETE_ORDERS.md), sent by staff on WhatsApp: the shopper's bag and the
 * details they typed come back, and checkout opens with them filled in. Items that sold out or were removed are left
 * out — the checkout's own quote prices and checks the rest.
 */
export default function ResumeCheckoutPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resumeCheckoutLead(code)
      .then(({ lead }) => {
        if (cancelled) return;
        if (lead.items.length === 0) return setFailed(true);
        useCartStore.setState({ items: lead.items, lastActivityAt: Date.now() });
        saveCheckoutPrefill({
          customerName: lead.name ?? undefined,
          customerPhone: lead.phone,
          customerEmail: lead.email ?? undefined,
          shippingDistrict: lead.shippingDistrict ?? undefined,
          shippingArea: lead.shippingArea ?? undefined,
          shippingAddressLine: lead.shippingAddressLine ?? undefined,
        });
        router.replace("/checkout");
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [code, router]);

  return (
    <StorefrontPage>
      <StorefrontPageHeader title={failed ? "This link has expired" : "Getting your bag ready"} />
      {failed ? (
        <div className="space-y-4">
          <p className="text-fg-muted">The items may have sold out, or the link is too old. You can still order from the shop.</p>
          <Link href="/" className={buttonVariants({ variant: "primary" })}>
            Continue shopping
          </Link>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-fg-muted" role="status">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Opening checkout with your details…
        </p>
      )}
    </StorefrontPage>
  );
}
