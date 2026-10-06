"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getPaymentLink, startPaymentLink } from "@/lib/api/orders";
import { formatPrice, formatStoreDateTime } from "@/lib/format";

const PROVIDER_LABEL = { SSLCOMMERZ: "Card / mobile banking (SSLCommerz)", EPS_PG: "EPS" } as const;

const INACTIVE_TEXT: Record<string, string> = {
  USED: "This payment has already been completed. Thank you!",
  EXPIRED: "This payment link has expired. Please ask us for a new one.",
  CANCELLED: "This payment link is no longer valid. Please ask us for a new one.",
};

/** A payment link (docs/ORDER_ADJUSTMENTS.md §11): shows only what's needed to recognise the order and the amount due —
 * every figure comes from the server — then hands over to the gateway. No account needed; the link is the key. */
export default function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, error: loadError } = useQuery({ queryKey: ["payment-link", token], queryFn: () => getPaymentLink(token), retry: false });
  const link = data?.link;

  async function pay(provider: "SSLCOMMERZ" | "EPS_PG") {
    setError(null);
    setStarting(provider);
    try {
      const { gatewayUrl } = await startPaymentLink(token, provider);
      window.location.href = gatewayUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the payment — please try again");
      setStarting(null);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:py-24">
      <div className="rounded-2xl border border-ink-100 bg-cream-50 p-6 sm:p-8" data-testid="pay-page">
        <span className="glossy mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-brass-100 text-brass-600">
          <CreditCard size={20} />
        </span>
        {isLoading && <p className="text-sm text-ink-500">Loading…</p>}
        {loadError && (
          <>
            <h1 className="mb-2 font-display text-2xl text-ink-900">Link not found</h1>
            <p className="text-sm text-ink-500">This payment link isn&apos;t valid. Please check the link you received, or contact us.</p>
          </>
        )}
        {link && (
          <>
            <h1 className="mb-1 font-display text-2xl text-ink-900">Pay for order {link.orderNumber}</h1>
            <p className="mb-5 text-sm text-ink-500">
              {link.customerFirstName ? `Hi ${link.customerFirstName}, ` : ""}
              {link.purpose === "MODIFICATION" ? "this payment covers the change to your order." : "this is the amount due on your order."}
            </p>
            <ul className="mb-4 divide-y divide-ink-100 rounded-xl border border-ink-100 text-sm">
              {link.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-3 px-3 py-2">
                  <span className="text-ink-700">
                    {item.name}
                    {item.size || item.color ? <span className="text-ink-400"> · {[item.size, item.color].filter(Boolean).join(" / ")}</span> : null}
                  </span>
                  <span className="shrink-0 text-ink-500">×{item.quantity}</span>
                </li>
              ))}
            </ul>
            <div className="mb-5 flex items-baseline justify-between">
              <span className="text-sm text-ink-600">Amount to pay</span>
              <span className="text-2xl font-semibold text-ink-900">{formatPrice(link.amount)}</span>
            </div>
            {link.status === "ACTIVE" ? (
              <>
                <p className="mb-4 text-xs text-ink-400">Valid until {formatStoreDateTime(link.expiresAt)}</p>
                <div className="space-y-2">
                  {link.providers.map((p) => (
                    <Button key={p} variant="brass" className="w-full" loading={starting === p} disabled={Boolean(starting)} onClick={() => pay(p)}>
                      Pay {formatPrice(link.amount)} with {PROVIDER_LABEL[p]}
                    </Button>
                  ))}
                  {link.providers.length === 0 && <p className="text-sm text-ink-500">Online payment is unavailable right now — please contact us.</p>}
                </div>
                {error && <p className="mt-3 text-sm text-danger-600">{error}</p>}
                <p className="mt-5 flex items-center gap-1.5 text-xs text-ink-400">
                  <ShieldCheck size={14} /> You&apos;ll complete the payment on the payment provider&apos;s secure page.
                </p>
              </>
            ) : (
              <p className="rounded-lg bg-ink-50 p-3 text-sm text-ink-600">{INACTIVE_TEXT[link.status] ?? "This payment link can't be used."}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
