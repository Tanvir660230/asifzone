import { Check } from "lucide-react";
import type { Order } from "@clothing-brand/shared";
import { Money } from "@/components/ui/money";
import { formatDateShort } from "@/lib/format";

/**
 * The order, placed (the tahafi preset's confirmation page): one white card like an iPhone's success screen — the olive
 * tick, the thanks, and what the shopper wants to keep: the order number, when it arrives and what to pay. Every value
 * is the order's own.
 */
export function TahafiOrderTag({ order, arrives }: { order: Order; arrives: { minDate: Date; maxDate: Date } }) {
  const firstName = order.customerName.split(" ")[0];
  return (
    <div className="mx-auto mb-8 max-w-md rounded-[1.75rem] bg-surface px-6 pb-6 pt-8 text-center shadow-[var(--panel-shadow)] sm:mb-10">
      <span aria-hidden="true" className="glossy mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sale-500 text-white">
        <Check size={28} strokeWidth={2.5} />
      </span>
      <h1 className="mt-4 font-display text-[1.75rem] leading-tight text-fg">Thank you, {firstName}</h1>
      <p className="mt-1 text-[0.9375rem] text-fg-muted">Your order is placed.</p>
      <dl className="mt-6 divide-y divide-line-subtle rounded-[1.125rem] bg-canvas text-left text-[0.9375rem]">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <dt className="text-fg-muted">Order</dt>
          <dd className="font-semibold tabular-nums text-fg">{order.orderNumber}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <dt className="text-fg-muted">Arrives</dt>
          <dd className="font-semibold text-fg">
            {formatDateShort(arrives.minDate)} – {formatDateShort(arrives.maxDate)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <dt className="text-fg-muted">{order.paymentMethod === "COD" ? "Pay on delivery" : "Total"}</dt>
          <dd className="font-semibold tabular-nums text-fg">
            <Money value={order.total} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
