"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { getOrderRisk } from "@/lib/api/admin-analytics";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

/** This phone's earlier orders at this store and what became of them, with the COD-risk reasons (§4.8). Renders nothing
 * while loading, on error, or for a first order with nothing to flag — it's context for the call, not a gate. */
export function StoreHistory({ orderId }: { orderId: string }) {
  const { data } = useQuery({ queryKey: ["order-risk", [orderId]], queryFn: () => getOrderRisk([orderId]), staleTime: 60_000 });
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
    <div className={cn("rounded-lg border px-3 py-2 text-[13px] leading-snug", tone)}>
      <p className="flex items-start gap-1.5">
        <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">{parts.length ? "Earlier orders here: " : "First order from this number"}</span>
          {parts.join(" · ")}
          {risk.trusted && " — a known good customer"}
        </span>
      </p>
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
