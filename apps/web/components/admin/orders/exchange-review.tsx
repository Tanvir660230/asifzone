"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, PackageCheck, PackageX } from "lucide-react";
import type { ReturnCompensation, ReturnRequest } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { MoneyOutcome } from "@/components/orders/adjustments/money-outcome";
import * as adjustmentsApi from "@/lib/api/admin-order-adjustments";
import { formatPrice } from "@/lib/format";
import { adjustmentErrorOf } from "@/lib/order-adjustment-errors";
import { cn } from "@/lib/utils";

/**
 * What approving an exchange will do, from the server's exchange preview (the same D6 pricing approval uses): what the
 * customer paid for the original units, the replacement at today's price, the difference and where it goes, and whether
 * the replacement is in stock. When money is owed back staff choose Store Balance (default) or a refund, where allowed.
 */
export function ExchangeReview({
  request,
  compensation,
  onCompensation,
  onReady,
}: {
  request: ReturnRequest;
  compensation: ReturnCompensation | undefined;
  onCompensation: (c: ReturnCompensation) => void;
  /** Whether approval can go ahead (the preview loaded and the replacement is in stock). */
  onReady: (ready: boolean) => void;
}) {
  const { data, error, isLoading } = useQuery({ queryKey: ["exchange-preview", request.id], queryFn: () => adjustmentsApi.getExchangePreview(request.id), retry: false });
  const p = data?.preview;
  useEffect(() => onReady(Boolean(p?.replacement.inStock)), [p, onReady]);
  useEffect(() => {
    if (p && p.amountOwedBack > 0 && !compensation) onCompensation(p.canCredit ? "STORE_CREDIT" : "REFUND");
  }, [p, compensation, onCompensation]);

  if (isLoading) return <div className="h-32 rounded-xl ui-skeleton" aria-busy="true" aria-label="Loading the exchange" />;
  if (error || !p) return <Alert variant="danger" title="Can't approve this exchange">{adjustmentErrorOf(error, "The exchange couldn't be priced").message}</Alert>;

  const kind = p.amountDue > 0 ? "collect" : p.amountOwedBack > 0 ? (compensation === "REFUND" ? "refund" : "credit") : "none";
  const amount = p.amountDue > 0 ? p.amountDue : p.amountOwedBack;
  return (
    <div className="space-y-3" data-testid="exchange-review">
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-line-subtle p-3 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div>
          <p className="text-xs text-ink-500">Customer returns</p>
          <p className="font-medium text-ink-900">
            {p.original.productName} · {[p.original.size, p.original.color].filter(Boolean).join(" / ")} ×{p.quantity}
          </p>
          <p className="text-xs text-ink-500">Paid {formatPrice(p.original.paidValue)}</p>
        </div>
        <ArrowRight size={16} className="hidden text-ink-400 sm:block" aria-label="exchanged for" />
        <div>
          <p className="text-xs text-ink-500">Customer receives</p>
          <p className="font-medium text-ink-900">
            {p.replacement.productName} · {[p.replacement.size, p.replacement.color].filter(Boolean).join(" / ")} ×{p.quantity}
          </p>
          <p className="text-xs text-ink-500">Today&apos;s price {formatPrice(p.replacement.value)}</p>
        </div>
      </div>
      <p className={cn("flex items-center gap-2 text-sm", p.replacement.inStock ? "text-ink-600" : "text-danger-700")}>
        {p.replacement.inStock ? <PackageCheck size={16} aria-hidden="true" /> : <PackageX size={16} aria-hidden="true" />}
        {p.replacement.inStock
          ? `The returned item goes back into stock; ${p.quantity} × the replacement is taken from stock.`
          : "The replacement is out of stock — it can't be approved until it's restocked."}
      </p>
      <MoneyOutcome kind={kind} amount={amount} audience="staff" />
      {p.amountDue > 0 && <p className="text-xs text-ink-500">A replacement order is created for this difference (or send a payment link for it).</p>}
      {p.amountOwedBack > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-ink-500">Give the difference back as</legend>
          {(
            [
              { value: "STORE_CREDIT", label: "Store Balance", hint: "For the customer's future orders.", allowed: p.canCredit },
              { value: "REFUND", label: "Refund owed", hint: "You pay it out and mark it paid.", allowed: p.canRefund },
            ] as const
          ).map((o) => (
            <label key={o.value} className={cn("flex min-h-11 items-start gap-3 rounded-xl border p-3 text-sm", compensation === o.value ? "border-ink-900" : "border-line-subtle", !o.allowed && "opacity-50")}>
              <input type="radio" name="exchange-compensation" className="mt-1" disabled={!o.allowed} checked={compensation === o.value} onChange={() => onCompensation(o.value)} />
              <span>
                <span className="font-medium text-ink-900">{o.label}</span>
                <span className="block text-xs text-ink-500">{o.allowed ? o.hint : "Not available for this order."}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
