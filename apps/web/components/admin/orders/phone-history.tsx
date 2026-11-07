"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { formatStoreDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { phoneKey, summarizePhoneHistory, type PhoneHistory } from "@/lib/admin/phone-history";

export type { PhoneHistory };

/**
 * Typing a full phone number on a new order looks the number up: a repeat customer is recognised at once (with how
 * their earlier parcels went), and their name and last address go in with one tap instead of being asked again on the
 * call. Nothing is filled until staff choose to.
 */
export function PhoneHistoryCard({ phone, onUse }: { phone: string; onUse: (h: PhoneHistory) => void }) {
  const [history, setHistory] = useState<PhoneHistory | null>(null);
  const [used, setUsed] = useState(false);
  const key = phoneKey(phone ?? "");
  const complete = /^01\d{9}$/.test(key);

  useEffect(() => {
    setHistory(null);
    setUsed(false);
    if (!complete) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      adminOrdersApi
        .listOrders({ search: key, pageSize: 20 }, { signal: ctrl.signal })
        .then((res) => setHistory(summarizePhoneHistory(res.items, key)))
        .catch(() => setHistory(null));
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [key, complete]);

  if (!history) return null;
  const { last } = history;
  return (
    <div
      className={cn("mt-2 rounded-xl border p-3 text-sm", history.refused ? "border-warning-200 bg-warning-50" : "border-line-subtle bg-surface-muted")}
      data-testid="phone-history"
    >
      <p className="flex items-start gap-1.5 font-medium text-fg">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
        <span>
          Ordered before: {history.orders} {history.orders === 1 ? "order" : "orders"}
          <span className="font-normal text-fg-muted">
            {" "}· {history.delivered} delivered{history.refused ? ` · ${history.refused} refused` : ""}
          </span>
        </span>
      </p>
      <p className="mt-1 text-fg-muted">
        {last.customerName} · {[last.shippingAddressLine, last.shippingArea, last.shippingDistrict].filter(Boolean).join(", ")}
        <span className="block text-xs">Last order {formatStoreDate(last.createdAt)}</span>
      </p>
      {used ? (
        <p className="mt-2 text-xs font-medium text-success-700">Name and address filled in — check them with the customer.</p>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => {
            onUse(history);
            setUsed(true);
          }}
          data-testid="phone-history-use"
        >
          Use this name &amp; address
        </Button>
      )}
    </div>
  );
}
