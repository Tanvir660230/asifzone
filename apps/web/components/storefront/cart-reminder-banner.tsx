"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, ShoppingBag } from "lucide-react";
import { useCartStore } from "@/store/cart";

const REMINDER_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes of inactivity
const DISMISSED_KEY = "cart-reminder-dismissed";

/** A passive, honest nudge — no server round-trip, just the shopper's own real cart state and
 * their own real inactivity. Never shown twice in the same browser session once dismissed. */
export function CartReminderBanner() {
  const items = useCartStore((s) => s.items);
  const lastActivityAt = useCartStore((s) => s.lastActivityAt);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Zustand's persist middleware hydrates from localStorage asynchronously, so `items`/
    // `lastActivityAt` start out as the default empty state and update once real data loads —
    // this effect must re-run on that update, not just once at mount.
    if (items.length === 0) return;
    if (window.sessionStorage.getItem(DISMISSED_KEY)) return;
    if (Date.now() - lastActivityAt < REMINDER_THRESHOLD_MS) return;
    setVisible(true);
  }, [items.length, lastActivityAt]);

  function dismiss() {
    setVisible(false);
    window.sessionStorage.setItem(DISMISSED_KEY, "1");
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-full border border-ink-200 bg-cream-50 px-4 py-3 shadow-floatLg animate-fade-in sm:left-auto sm:right-4 sm:translate-x-0">
      <ShoppingBag size={18} className="shrink-0 text-brass-500" />
      <p className="flex-1 text-sm text-ink-700">
        Still interested?{" "}
        <Link href="/cart" onClick={dismiss} className="font-medium underline hover:text-brass-600">
          Your cart is waiting
        </Link>
      </p>
      <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-ink-400 hover:text-ink-700">
        <X size={16} />
      </button>
    </div>
  );
}
