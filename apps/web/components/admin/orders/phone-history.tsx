"use client";

import { useEffect, useRef, useState } from "react";
import { Check, History, MapPin } from "lucide-react";
import { PHONE_REGEX } from "@clothing-brand/shared";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as adminCustomersApi from "@/lib/api/admin-customers";
import { formatStoreDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { phoneKey, summarizePhoneHistory, withSavedAddresses, type PastAddress, type PhoneHistory } from "@/lib/admin/phone-history";

export type { PastAddress, PhoneHistory };

interface Props {
  phone: string;
  /** A customer linked from the search: their saved account addresses are offered too. */
  customerId?: string | null;
  /** True while staff have typed no name and no address yet — then the latest address goes in by itself. */
  isFormEmpty: () => boolean;
  onUse: (address: PastAddress) => void;
}

/**
 * Typing a full phone number on a new order (or linking a customer from the search) looks the number up: a repeat
 * customer is recognised at once, with how their earlier parcels went. When the form is still blank their name and
 * latest address go in by themselves; every other address they have used is one tap away. Anything staff already typed
 * is never overwritten without a tap.
 */
export function PhoneHistoryCard({ phone, customerId, isFormEmpty, onUse }: Props) {
  const [history, setHistory] = useState<PhoneHistory | null>(null);
  const [addresses, setAddresses] = useState<PastAddress[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [autoFilled, setAutoFilled] = useState(false);
  const key = phoneKey(phone ?? "");
  const complete = PHONE_REGEX.test(key);
  // Read the latest callbacks inside the lookup without re-running it on every render.
  const latest = useRef({ isFormEmpty, onUse });
  latest.current = { isFormEmpty, onUse };

  useEffect(() => {
    setHistory(null);
    setAddresses([]);
    setChosen(null);
    setAutoFilled(false);
    if (!complete && !customerId) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const [ordersRes, customerRes] = await Promise.all([
        complete ? adminOrdersApi.listOrders({ search: key, pageSize: 30 }, { signal: ctrl.signal }).catch(() => null) : null,
        customerId ? adminCustomersApi.getCustomer(customerId).catch(() => null) : null,
      ]);
      if (ctrl.signal.aborted) return;
      const h = ordersRes ? summarizePhoneHistory(ordersRes.items, key) : null;
      const list = withSavedAddresses(h, customerRes?.customer.addresses ?? []);
      setHistory(h);
      setAddresses(list);
      if (list.length && latest.current.isFormEmpty()) {
        latest.current.onUse(list[0]!);
        setChosen(0);
        setAutoFilled(true);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [key, complete, customerId]);

  if (!history && !addresses.length) return null;

  return (
    <div
      className={cn("mt-2 rounded-xl border p-3 text-sm", history?.refused ? "border-warning-200 bg-warning-50" : "border-line-subtle bg-surface-muted")}
      data-testid="phone-history"
    >
      <p className="flex items-start gap-1.5 font-medium text-fg">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
        {history ? (
          <span>
            Ordered before: {history.orders} {history.orders === 1 ? "order" : "orders"}
            <span className="font-normal text-fg-muted">
              {" "}· {history.delivered} delivered{history.refused ? ` · ${history.refused} refused` : ""}
              {" "}· last {formatStoreDate(history.last.createdAt)}
            </span>
          </span>
        ) : (
          <span>Saved addresses</span>
        )}
      </p>

      {addresses.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-label="Previous addresses">
          {addresses.map((a, i) => {
            const selected = chosen === i;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    onUse(a);
                    setChosen(i);
                    setAutoFilled(false);
                  }}
                  aria-pressed={selected}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                    selected ? "border-success-300 bg-success-50" : "border-line-subtle bg-surface hover:border-ink-300",
                  )}
                  data-testid="phone-history-address"
                >
                  {selected ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-700" aria-hidden="true" />
                  ) : (
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-fg">
                      {[a.shippingAddressLine, a.shippingArea, a.shippingDistrict].filter(Boolean).join(", ")}
                    </span>
                    <span className="block text-xs text-fg-muted">
                      {a.customerName}
                      {a.times > 0
                        ? ` · ${a.times} ${a.times === 1 ? "order" : "orders"}${a.delivered ? `, ${a.delivered} delivered` : ""}`
                        : " · saved in account"}
                    </span>
                  </span>
                  {!selected && <span className="ml-auto shrink-0 text-xs font-medium text-fg-muted">Use</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {chosen !== null && (
        <p className="mt-2 text-xs font-medium text-success-700" data-testid="phone-history-filled">
          {autoFilled ? "Filled from the last order" : "Name and address filled in"} — check them with the customer.
        </p>
      )}
    </div>
  );
}
