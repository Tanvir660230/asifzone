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
 * Guests get redirected to log in first, same pattern as WishlistButton, since the alert has
 * to be tied to a real, emailable account. */
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
      className="mt-2 flex items-center gap-2 text-sm text-ink-700 underline decoration-ink-300 underline-offset-2 transition-colors duration-150 ease-smooth hover:text-brass-600 disabled:opacity-50"
    >
      {subscribed ? <BellOff size={14} /> : <BellRing size={14} />}
      {subscribed ? "We'll email you — click to cancel" : "Notify me when back in stock"}
    </button>
  );
}
