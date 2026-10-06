import { AlertTriangle, ExternalLink, ShieldCheck } from "lucide-react";
import type { DeliveryScore, Order, OrderStatus } from "@clothing-brand/shared";
import { OrderStatusIcon } from "@/components/admin/order-status-icon";
import {
  courierStatusBadgeClass,
  courierStatusDescription,
  courierStatusLabel,
  deliveryScoreBadgeClass,
  deliveryScoreSummary,
  orderStatusBadgeClass,
  orderStatusLabel,
  orderStatusShortLabel,
  paymentStatusLabel,
  paymentStatusTextClass,
  timeAgo,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/** Order status pill: icon + words, so the state never depends on color alone. Colors stay centralized in lib/format. */
export function OrderStatusBadge({ status, short = false, className }: { status: OrderStatus; short?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium leading-none",
        orderStatusBadgeClass(status),
        className,
      )}
    >
      <OrderStatusIcon status={status} size={12} className="shrink-0" />
      {short ? orderStatusShortLabel(status) : orderStatusLabel(status)}
    </span>
  );
}

export function paymentMethodLabel(method: Order["paymentMethod"]) {
  return method === "COD" ? "COD" : "Online";
}

/** Method chip + ledger-derived payment status, stacked (table) or inline (cards, detail). */
export function PaymentBadges({
  method,
  status,
  layout = "stack",
}: {
  method: Order["paymentMethod"];
  status: Order["paymentStatus"];
  layout?: "stack" | "inline";
}) {
  return (
    <span className={cn("flex", layout === "stack" ? "flex-col items-start gap-1" : "items-center gap-1.5")}>
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
          method === "COD" ? "bg-ink-100 text-ink-700" : "bg-info-100 text-info-700",
        )}
        title={method === "COD" ? "Cash on delivery" : `Paid online (${method})`}
      >
        {paymentMethodLabel(method)}
      </span>
      <span className={cn("text-[11px] font-medium", paymentStatusTextClass(status))}>{paymentStatusLabel(status)}</span>
    </span>
  );
}

type CourierFacts = Pick<Order, "courierConsignmentId" | "courierStatus" | "courierTrackingLink" | "courierSyncError" | "courierStatusSyncedAt">;

/** Courier booking state for a row/card: provider-neutral wording, labels from lib/format. */
export function CourierCell({ order, compact = false }: { order: CourierFacts; compact?: boolean }) {
  if (!order.courierConsignmentId) return <span className="text-xs text-ink-400">Not booked</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <span
          className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", courierStatusBadgeClass(order.courierStatus ?? ""))}
          title={order.courierStatus ? courierStatusDescription(order.courierStatus) : "Booked — status not yet reported"}
        >
          {order.courierStatus ? courierStatusLabel(order.courierStatus) : "Booked"}
        </span>
        {order.courierTrackingLink && (
          <a
            href={order.courierTrackingLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-400 hover:bg-ink-900/[0.05] hover:text-info-600"
            aria-label="Track parcel (opens courier site)"
            title="Track parcel"
          >
            <ExternalLink size={13} />
          </a>
        )}
        {order.courierSyncError && (
          <span className="inline-flex items-center text-danger-600" title={`Sync failed: ${order.courierSyncError}`}>
            <AlertTriangle size={13} aria-hidden="true" />
            <span className="sr-only">Courier sync failed: {order.courierSyncError}</span>
          </span>
        )}
      </span>
      {!compact && (
        <span className="text-[11px] text-ink-400">{order.courierStatusSyncedAt ? `Synced ${timeAgo(order.courierStatusSyncedAt)}` : "Never synced"}</span>
      )}
    </span>
  );
}

/** Cached courier delivery-success score for the customer — or, when never checked, a button to check it. */
export function DeliveryScoreBadge({
  score,
  onCheck,
  checking = false,
}: {
  score: DeliveryScore | null | undefined;
  onCheck?: () => void;
  checking?: boolean;
}) {
  if (!score) {
    if (!onCheck) return <span className="text-[11px] text-ink-400">Score not checked</span>;
    return (
      <button
        type="button"
        disabled={checking}
        onClick={onCheck}
        title="Check this customer's delivery success rate with the courier"
        className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-[1px] text-[10px] font-semibold leading-tight text-ink-500 ring-1 ring-inset ring-ink-200 transition-colors duration-fast ease-smooth hover:text-ink-800 hover:ring-ink-400 disabled:opacity-50"
      >
        <ShieldCheck size={10} aria-hidden="true" />
        {checking ? "Checking…" : "Check score"}
      </button>
    );
  }
  const { successRate, checkedAt } = score;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center rounded px-1.5 py-[1px] text-[10px] font-semibold leading-tight", deliveryScoreBadgeClass(successRate))}
      title={`${deliveryScoreSummary(score)} · checked ${timeAgo(checkedAt)}`}
    >
      <span className="sr-only">Delivery success rate: </span>
      {successRate === null ? "No history" : `${successRate}%`}
    </span>
  );
}
