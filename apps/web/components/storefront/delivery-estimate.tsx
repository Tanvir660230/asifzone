"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { estimateDelivery } from "@clothing-brand/shared";
import { formatPrice, formatStoreDate } from "@/lib/format";

const DAY: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };

interface DeliveryEstimateProps {
  /** The store's delivery fees (StoreSetting.shippingFeeDhaka / OutsideDhaka, the mirrors of its two delivery zones). Shown
   * beside each area so the fee is known before checkout; the checkout's server quote stays the amount actually charged. */
  fees?: { insideDhaka: string; elsewhere: string };
  /** The product ships free (shown instead of the fee). */
  freeDelivery?: boolean;
  /** Inside a card of the caller's own (Tahafi's hang-tag): no box or icon of its own. */
  bare?: boolean;
}

/** "Order today, arrives Tue 14 - Wed 15 Oct inside Dhaka, Thu 16 - Sat 18 Oct elsewhere", each with its delivery fee: the
 * same estimate the checkout shows once a district is chosen (shared `estimateDelivery`), given up front on the product
 * page. Dates are worked out after mount, from the viewer's today, so the server's clock never disagrees with the page;
 * the rows keep their height meanwhile, so nothing shifts when they fill in. */
export function DeliveryEstimate({ fees, freeDelivery = false, bare = false }: DeliveryEstimateProps) {
  const [lines, setLines] = useState<{ inside: string; outside: string } | null>(null);

  useEffect(() => {
    const range = (district: string) => {
      const { minDate, maxDate } = estimateDelivery(district);
      return `${formatStoreDate(minDate, DAY)} - ${formatStoreDate(maxDate, DAY)}`;
    };
    setLines({ inside: range("Dhaka"), outside: range("Chattogram") });
  }, []);

  const fee = (amount: string | undefined) => {
    if (freeDelivery) return "Free delivery";
    if (amount === undefined) return null;
    return Number(amount) === 0 ? "Free delivery" : `${formatPrice(amount)} delivery`;
  };
  const rows = [
    { label: "Inside Dhaka", dates: lines?.inside, fee: fee(fees?.insideDhaka) },
    { label: "Elsewhere", dates: lines?.outside, fee: fee(fees?.elsewhere) },
  ];

  return (
    <div className={bare ? "flex items-start" : "flex items-start gap-3 rounded-xl bg-surface-muted px-4 py-3.5"} data-testid="delivery-estimate">
      {!bare && <CalendarClock size={18} className="mt-0.5 shrink-0 text-ink-900" aria-hidden="true" />}
      <div className="min-w-0 flex-1 text-sm leading-5">
        <p className="font-medium text-ink-900">Order today, estimated delivery</p>
        {/* One row per area: the area and its fee on the left, the dates on the right; narrow enough for a phone. */}
        <dl className="mt-2 space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-3">
              <dt className="text-ink-600">
                {row.label}
                {row.fee && (
                  <span className="block text-xs text-ink-500" data-testid="delivery-fee">
                    {row.fee}
                  </span>
                )}
              </dt>
              <dd className="min-h-5 text-right font-medium tabular-nums text-ink-900">
                {row.dates ?? <span className="ui-skeleton inline-block h-3.5 w-32 align-middle" />}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
