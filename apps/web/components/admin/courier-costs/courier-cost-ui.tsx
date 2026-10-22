"use client";

import {
  SHIPMENT_FINANCIAL_STATUS_LABEL,
  SHIPMENT_OPERATIONAL_STATUS_LABEL,
  SHIPMENT_TYPE_LABEL,
  type ShipmentFinancialStatus,
  type ShipmentOperationalStatus,
  type ShipmentType,
} from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Courier cost reconciliation (docs/COURIER_COSTS.md) — the small shared pieces of the order section, the drawer and
 * the report. Status colour carries meaning only: green = settled, amber = someone has to act, red = something disagrees. */

const FINANCIAL_VARIANT: Record<ShipmentFinancialStatus, "neutral" | "success" | "warning" | "danger"> = {
  NOT_DUE: "neutral",
  AWAITING_ACTUAL_CHARGE: "warning",
  AWAITING_CONTRIBUTION: "warning",
  EXCESS_REVIEW: "warning",
  NOT_COVERED: "neutral",
  PARTIALLY_COVERED: "neutral",
  FULLY_COVERED: "success",
  RECONCILED: "success",
  NEEDS_REVIEW: "danger",
};

export function FinancialStatusBadge({ status }: { status: ShipmentFinancialStatus }) {
  return <Badge variant={FINANCIAL_VARIANT[status]}>{SHIPMENT_FINANCIAL_STATUS_LABEL[status]}</Badge>;
}

export function OperationalStatusText({ status }: { status: ShipmentOperationalStatus }) {
  return <span className="text-xs text-fg-muted">{SHIPMENT_OPERATIONAL_STATUS_LABEL[status]}</span>;
}

/** "Return leg", "Delivery", "Replacement" — refused deliveries read as such. */
export function legTitle(type: ShipmentType, status: ShipmentOperationalStatus): string {
  if (type === "OUTBOUND" && status === "RETURNED") return "Delivery — refused, came back";
  if (type === "OUTBOUND" && status === "PARTIALLY_DELIVERED") return "Delivery — partly accepted";
  return SHIPMENT_TYPE_LABEL[type];
}

/** Money or a dash; `provisional` amounts are shown as such, never as confirmed. */
export function Amount({ value, provisional, className }: { value: number | null | undefined; provisional?: boolean; className?: string }) {
  if (value === null || value === undefined) return <span className={cn("text-fg-subtle", className)}>—</span>;
  return (
    <span className={cn("tabular-nums", provisional && "text-fg-muted", className)}>
      {formatPrice(value)}
      {provisional && <span className="sr-only"> (not confirmed)</span>}
    </span>
  );
}

/** The four numbers that tell the story of a leg or an exchange, at a glance. */
export function CostFigures({
  charge,
  paid,
  uncovered,
  excess,
  provisional,
  chargeProvisional,
  paidProvisional,
  chargeLabel = "Actual charge",
  className,
}: {
  charge: number | null;
  paid: number | null;
  uncovered: number | null;
  excess: number | null;
  /** The results (uncovered / excess) rest on something unverified. */
  provisional?: boolean;
  chargeProvisional?: boolean;
  paidProvisional?: boolean;
  chargeLabel?: string;
  className?: string;
}) {
  const cell = (label: string, value: number | null, grey: boolean | undefined, tone?: "attention") => (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-fg-subtle">{label}</dt>
      <dd className={cn("mt-0.5 text-[15px] font-semibold tracking-tight text-fg", tone === "attention" && value && !grey ? "text-warning-700" : "")}>
        <Amount value={value} provisional={grey} />
      </dd>
    </div>
  );
  return (
    <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4", className)}>
      {cell(chargeLabel, charge, chargeProvisional)}
      {cell("Customer paid rider", paid, paidProvisional)}
      {cell("Uncovered", uncovered, provisional, "attention")}
      {cell("Excess", excess, provisional, "attention")}
    </dl>
  );
}
