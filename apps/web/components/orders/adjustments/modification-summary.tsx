import { ArrowRight, MapPin, Minus, Plus, Repeat, Tag, Truck } from "lucide-react";
import type { OrderModificationLineChange, OrderModificationPreview } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MoneyOutcome, type MoneyOutcomeKind } from "./money-outcome";

/** Which outcome the server's preview describes — read from its fields, never recomputed. */
export function modificationOutcome(preview: OrderModificationPreview): { kind: MoneyOutcomeKind; amount: number } {
  if (preview.outcome === "AWAITING_PAYMENT") return { kind: "pay", amount: preview.amountToPay };
  if (preview.amountCredited > 0) return { kind: "credit", amount: preview.amountCredited };
  if (preview.amountToPay > 0) return { kind: "collect", amount: preview.amountToPay };
  return { kind: "none", amount: 0 };
}

const variantLabel = (c: Pick<OrderModificationLineChange, "size" | "color">) => [c.size, c.color].filter(Boolean).join(" / ");

/** A removed line and an added line of the same product read as one variant change ("M → L"). Presentation only. */
function pairVariantChanges(preview: OrderModificationPreview) {
  const removed = [...preview.removed];
  const swaps: Array<{ from: OrderModificationLineChange; to: OrderModificationLineChange }> = [];
  const added: OrderModificationLineChange[] = [];
  for (const a of preview.added) {
    const i = removed.findIndex((r) => r.productName === a.productName);
    if (i >= 0) swaps.push({ from: removed.splice(i, 1)[0]!, to: a });
    else added.push(a);
  }
  return { swaps, added, removed };
}

const WAIVER: Record<NonNullable<OrderModificationPreview["shippingWaivedReason"]>, string> = {
  COUPON: "free with coupon",
  FREE_DELIVERY: "free delivery",
  FREE_OVER: "free over threshold",
};

function Money({ value, signed }: { value: number; signed?: boolean }) {
  if (!signed) return <>{formatPrice(value)}</>;
  if (value === 0) return <span className="text-ink-400">—</span>;
  return (
    <>
      <span aria-hidden="true">{value > 0 ? "+" : "−"}</span>
      <span className="sr-only">{value > 0 ? "plus " : "minus "}</span>
      {formatPrice(Math.abs(value))}
    </>
  );
}

/**
 * What an order change does, exactly as the server priced it (POST …/modifications/preview): every line that changes,
 * the before/after totals with the difference, coupon and shipping effects, what was already paid, and the one money
 * consequence. Shared by the customer and staff flows — `audience` only changes the wording.
 */
export function ModificationSummary({
  preview,
  audience,
  paymentMethod,
}: {
  preview: OrderModificationPreview;
  audience: "customer" | "staff";
  paymentMethod: string;
}) {
  const { swaps, added, removed } = pairVariantChanges(preview);
  const outcome = modificationOutcome(preview);
  const rows: Array<{ label: string; prev: number; next: number; diff: number; note?: string }> = [
    { label: "Items", prev: preview.previous.subtotal, next: preview.next.subtotal, diff: preview.difference.merchandise },
    { label: "Discount", prev: -preview.previous.discount, next: -preview.next.discount, diff: -preview.difference.discount },
    {
      label: "Delivery",
      prev: preview.previous.shippingCharged,
      next: preview.next.shippingCharged,
      diff: preview.difference.shipping,
      note: preview.shippingWaivedReason ? WAIVER[preview.shippingWaivedReason] : undefined,
    },
  ];

  return (
    <div className="space-y-4" data-testid="modification-summary">
      <section aria-labelledby="mod-changes">
        <h3 id="mod-changes" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
          Changes
        </h3>
        <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle text-sm">
          {swaps.map(({ from, to }) => (
            <li key={`s-${to.variantId}`} className="flex items-start gap-3 px-3 py-2.5">
              <Repeat size={16} className="mt-0.5 shrink-0 text-info-700" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900">{to.productName}</p>
                <p className="flex flex-wrap items-center gap-1 text-ink-600">
                  <span className="sr-only">Changed from</span> {variantLabel(from)} ×{from.previousQuantity}
                  <ArrowRight size={12} aria-hidden="true" />
                  <span className="sr-only">to</span> {variantLabel(to)} ×{to.newQuantity}
                </p>
              </div>
              {to.unitPrice !== null && <span className="shrink-0 text-xs text-ink-500">{formatPrice(to.unitPrice)} each</span>}
            </li>
          ))}
          {added.map((c) => (
            <li key={`a-${c.variantId}`} className="flex items-start gap-3 px-3 py-2.5">
              <Plus size={16} className="mt-0.5 shrink-0 text-success-700" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900">
                  <span className="sr-only">Added: </span>
                  {c.productName}
                </p>
                <p className="text-ink-600">
                  {variantLabel(c)} · ×{c.newQuantity}
                </p>
              </div>
              {c.unitPrice !== null && <span className="shrink-0 text-xs text-ink-500">{formatPrice(c.unitPrice)} each</span>}
            </li>
          ))}
          {removed.map((c) => (
            <li key={`r-${c.variantId}`} className="flex items-start gap-3 px-3 py-2.5">
              <Minus size={16} className="mt-0.5 shrink-0 text-danger-600" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900 line-through decoration-ink-300">
                  <span className="sr-only">Removed: </span>
                  {c.productName}
                </p>
                <p className="text-ink-600">
                  {variantLabel(c)} · ×{c.previousQuantity}
                </p>
              </div>
            </li>
          ))}
          {preview.changed.map((c) => (
            <li key={`c-${c.variantId}`} className="flex items-start gap-3 px-3 py-2.5">
              <Repeat size={16} className="mt-0.5 shrink-0 text-ink-500" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900">{c.productName}</p>
                <p className="text-ink-600">
                  {variantLabel(c)} · quantity {c.previousQuantity} <ArrowRight size={12} className="inline" aria-label="to" /> {c.newQuantity}
                </p>
              </div>
              {c.newQuantity > c.previousQuantity && c.unitPrice !== null && <span className="shrink-0 text-xs text-ink-500">{formatPrice(c.unitPrice)} each</span>}
            </li>
          ))}
          {preview.addressChanged && (
            <li className="flex items-start gap-3 px-3 py-2.5">
              <MapPin size={16} className="mt-0.5 shrink-0 text-ink-500" aria-hidden="true" />
              <p className="text-ink-700">Delivery details updated</p>
            </li>
          )}
        </ul>
      </section>

      <section aria-labelledby="mod-totals">
        <h3 id="mod-totals" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
          Totals
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-500">
              <th scope="col" className="pb-1.5 font-medium">
                <span className="sr-only">Line</span>
              </th>
              <th scope="col" className="pb-1.5 text-right font-medium">
                Current
              </th>
              <th scope="col" className="pb-1.5 text-right font-medium">
                New
              </th>
              <th scope="col" className="hidden pb-1.5 text-right font-medium sm:table-cell">
                Difference
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line-subtle">
                <th scope="row" className="py-1.5 text-left font-normal text-ink-600">
                  {r.label}
                  {r.note && (
                    <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-success-700">
                      {r.label === "Delivery" ? <Truck size={11} aria-hidden="true" /> : <Tag size={11} aria-hidden="true" />}
                      {r.note}
                    </span>
                  )}
                </th>
                <td className="py-1.5 text-right text-ink-600">
                  <Money value={r.prev} signed={r.label === "Discount"} />
                </td>
                <td className="py-1.5 text-right text-ink-900">
                  <Money value={r.next} signed={r.label === "Discount"} />
                </td>
                <td className="hidden py-1.5 text-right text-ink-600 sm:table-cell">
                  <Money value={r.diff} signed />
                </td>
              </tr>
            ))}
            <tr className="border-t border-line text-base font-semibold text-ink-900">
              <th scope="row" className="pt-2 text-left">
                Total
              </th>
              <td className="pt-2 text-right font-normal text-ink-500">{formatPrice(preview.previous.total)}</td>
              <td className="pt-2 text-right">{formatPrice(preview.next.total)}</td>
              <td className="hidden pt-2 text-right sm:table-cell">
                <Money value={preview.difference.total} signed />
              </td>
            </tr>
          </tbody>
        </table>
        {preview.coupon.code && (
          <p className={cn("mt-2 flex items-center gap-1.5 text-xs", preview.coupon.kept ? "text-ink-500" : "text-warning-700")}>
            <Tag size={12} aria-hidden="true" />
            Coupon {preview.coupon.code}: {preview.coupon.kept ? "still applied" : (preview.coupon.note ?? "removed")}
          </p>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-surface-muted p-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-500">{audience === "customer" ? "You've paid" : "Paid so far"}</dt>
          <dd className="font-medium tabular-nums text-ink-900">{formatPrice(preview.paid)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">New total</dt>
          <dd className="font-medium tabular-nums text-ink-900">{formatPrice(preview.next.total)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">{preview.amountCredited > 0 ? "To Store Balance" : "Due after this change"}</dt>
          <dd className="font-medium tabular-nums text-ink-900">{formatPrice(preview.amountCredited > 0 ? preview.amountCredited : preview.amountToPay)}</dd>
        </div>
      </dl>

      <MoneyOutcome
        kind={outcome.kind}
        amount={outcome.amount}
        audience={audience}
        testId="modification-outcome"
        extra={
          outcome.kind === "collect" && preview.difference.total !== 0
            ? `The total is ${formatPrice(Math.abs(preview.difference.total))} ${preview.difference.total > 0 ? "more" : "less"} than before.`
            : null
        }
      />
      {outcome.kind === "collect" && paymentMethod !== "COD" && (
        <p className="text-xs text-ink-500">
          {audience === "staff" ? "Applied now; the difference stays due on the order — send a payment link or record the payment." : "This amount stays due on your order."}
        </p>
      )}

      {preview.warnings.length > 0 && (
        <Alert variant="neutral" title="Good to know">
          <ul className="list-disc space-y-0.5 pl-4">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
