"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter, usePathname } from "next/navigation";
import { BellRing, BellOff } from "lucide-react";
import { subscribeStockAlert, unsubscribeStockAlert } from "@/lib/api/cart";
import { ApiError } from "@/lib/api-client";

interface StockAlertButtonProps {
  variantId: string;
}

/** "Notify me when back in stock" — only rendered when the selected variant is out of stock.
 * Guests get redirected to log in first (unlike WishlistButton, which now works without an
 * account) since the alert has to be tied to a real, emailable account. */
export function StockAlertButton({ variantId }: StockAlertButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [subscribed, setSubscribed] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (subscribed) await unsubscribeStockAlert(variantId);
      else await subscribeStockAlert(variantId);
    },
    onSuccess: () => setSubscribed((v) => !v),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/account/login?next=${encodeURIComponent(pathname)}`);
      }
    },
  });

  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-ink-900 text-sm font-medium text-ink-900 transition-colors duration-150 ease-smooth hover:bg-ink-900 hover:text-cream-50 disabled:opacity-50"
      data-testid="stock-alert"
      data-fab-collision
    >
      {subscribed ? <BellOff size={16} aria-hidden="true" /> : <BellRing size={16} aria-hidden="true" />}
      {subscribed ? "We'll email you — click to cancel" : "Notify me when back in stock"}
    </button>
  );
}
