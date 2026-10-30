import type { Order } from "@clothing-brand/shared";
import { Money } from "@/components/ui/money";
import { formatDateShort } from "@/lib/format";
import { TwinDiamonds } from "./twin-diamonds";

/**
 * The order, placed: a large hang-tag on a sage thread at the top of the confirmation page (the tahafi preset), carrying
 * what the shopper wants to keep — the order number, when it arrives and what to pay. Every value is the order's own.
 */
export function TahafiOrderTag({ order, arrives }: { order: Order; arrives: { minDate: Date; maxDate: Date } }) {
  const firstName = order.customerName.split(" ")[0];
  return (
    <div className="mb-10 flex flex-col items-center sm:mb-14">
      <span aria-hidden="true" className="h-14 w-px bg-[color:var(--tag-thread)] sm:h-20" />
      <div className="ui-hang-tag ui-tag-sway relative -mt-px w-full max-w-[19rem] origin-top -rotate-2 bg-surface px-6 pb-6 pt-10 text-center shadow-[0_18px_40px_-24px_rgb(28_28_26/0.45)]">
        <span aria-hidden="true" className="absolute left-1/2 top-4 h-3 w-3 -translate-x-1/2 rounded-full bg-ink-950" />
        <TwinDiamonds className="mx-auto w-7 text-sale-500" />
        <h1 className="mt-3 font-display text-[2.25rem] leading-none text-fg">Thank you, {firstName}</h1>
        <p className="mt-2 text-sm text-fg-muted">Your order is placed</p>
        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-left text-sm">
          <dt className="text-fg-muted">Order</dt>
          <dd className="whitespace-nowrap text-right text-[0.8125rem] font-medium tabular-nums text-fg">{order.orderNumber}</dd>
          <dt className="text-fg-muted">Arrives</dt>
          <dd className="text-right font-medium text-fg">
            {formatDateShort(arrives.minDate)} – {formatDateShort(arrives.maxDate)}
          </dd>
          <dt className="text-fg-muted">{order.paymentMethod === "COD" ? "Pay on delivery" : "Total"}</dt>
          <dd className="text-right font-medium tabular-nums text-fg">
            <Money value={order.total} />
          </dd>
        </dl>
      </div>
    </div>
  );
}
