"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Send, ShieldCheck } from "lucide-react";
import type { Order } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { getOrderRisk } from "@/lib/api/admin-analytics";
import { createPaymentLink, listPaymentLinks } from "@/lib/api/payments-admin";
import { formatPrice } from "@/lib/format";
import { orderKeys } from "../order-domain";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

/** This phone's earlier orders at this store and what became of them, with the COD-risk reasons (§4.8). Renders nothing
 * while loading, on error, or for a first order with nothing to flag — it's context for the call, not a gate. */
/** The order's delivery charge can be asked for up front: a COD order not yet booked, delivery not free, nothing paid. */
function advanceCharge(order: Order): number {
  if (order.paymentMethod !== "COD" || order.courierConsignmentId || !["PENDING", "CONFIRMED"].includes(order.status)) return 0;
  if ((order.payment?.paid ?? 0) > 0 || order.shippingWaived) return 0;
  return Number(order.shippingFee) || 0;
}

/** `advance`: the order, when the viewer may take payments — a customer who refused parcels before can be sent a link for
 * just the delivery charge (staff decide; owner 2026-11-09). Paid, the courier collects the rest. */
export function StoreHistory({ orderId, advance = null }: { orderId: string; advance?: Order | null }) {
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const { data } = useQuery({ queryKey: ["order-risk", [orderId]], queryFn: () => getOrderRisk([orderId]), staleTime: 60_000 });
  // An advance link already out (shared with the Payment links panel's query): say so instead of offering a second one.
  const { data: links } = useQuery({ queryKey: orderKeys.paymentLinks(orderId), queryFn: () => listPaymentLinks(orderId), enabled: Boolean(advance) });
  const advanceOut = links?.links.find((l) => l.purpose === "DELIVERY_ADVANCE" && (l.status === "ACTIVE" || l.status === "USED"));
  const risk = data?.orders[orderId];
  if (!risk) return null;
  const h = risk.history;
  const parts = [
    h.delivered && `${formatCount(h.delivered)} delivered`,
    h.partial && `${formatCount(h.partial)} part delivered`,
    h.refused && `${formatCount(h.refused)} refused`,
    h.cancelledBeforeBooking && `${formatCount(h.cancelledBeforeBooking)} cancelled`,
    h.open && `${formatCount(h.open)} open`,
  ].filter(Boolean);
  if (!parts.length && risk.level === "low") return null;

  const tone = risk.level === "high" ? "border-danger-100 bg-danger-50/60 text-danger-700" : risk.level === "medium" ? "border-warning-100 bg-warning-50/60 text-warning-700" : "border-line bg-ink-900/[0.02] text-fg-muted";
  const Icon = risk.level === "low" ? ShieldCheck : AlertTriangle;
  return (
    <div className={cn("rounded-lg border px-3 py-2 text-sm leading-snug", tone)}>
      <p className="flex items-start gap-1.5">
        <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">{parts.length ? "Earlier orders here: " : "First order from this number"}</span>
          {parts.join(" · ")}
          {risk.trusted && " — a known good customer"}
        </span>
      </p>
      {advance && h.refused > 0 && advanceCharge(advance) > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-current/10 pt-2" data-testid="advance-ask">
          {advanceOut ? (
            <span data-testid="advance-out">
              {advanceOut.status === "USED"
                ? `Delivery charge paid in advance (${formatPrice(advanceOut.amount)}) — the courier collects the rest.`
                : `Delivery-charge link for ${formatPrice(advanceOut.amount)} sent — waiting for the customer to pay.`}
            </span>
          ) : (
          <>
          <span>Ask for the delivery charge first — paid, the courier collects the rest.</span>
          <Button
            size="sm"
            variant="outline"
            loading={sending}
            data-testid="advance-send"
            onClick={async () => {
              setSending(true);
              try {
                await createPaymentLink(advance.id, { expiresInHours: 48, send: ["SMS"], purpose: "DELIVERY_ADVANCE" });
                toast.success(`Link for ${formatPrice(advanceCharge(advance))} sent by SMS`);
                await queryClient.invalidateQueries({ queryKey: orderKeys.paymentLinks(advance.id) });
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Couldn't send the link — try again");
              } finally {
                setSending(false);
              }
            }}
          >
            <Send size={14} aria-hidden="true" />
            Send {formatPrice(advanceCharge(advance))} link
          </Button>
          </>
          )}
        </div>
      )}
      {risk.reasons.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-6">
          {risk.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
