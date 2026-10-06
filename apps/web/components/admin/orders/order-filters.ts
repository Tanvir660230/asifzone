import {
  BD_DISTRICTS_BY_DIVISION,
  BD_DIVISIONS,
  COURIER_DELIVERY_STATUSES,
  ORDER_QUEUE_IDS,
  orderStatusEnum,
  paymentMethodEnum,
  paymentStatusEnum,
  type BdDivision,
  type OrderQueueId,
} from "@clothing-brand/shared";
import type { FilterDefinition } from "@/lib/admin/filters";
import { courierStatusLabel, orderStatusShortLabel, paymentStatusLabel } from "@/lib/format";

/**
 * The Orders list's filters in the filter-definition format (lib/admin/filters.ts) — the first module adapted (P1.8).
 * The Orders list state reads its chip wording and `?queue=` / `?status=` deep links from here; when Orders moves to
 * URL state (P3) these keys are its query string and the aliases keep the old links working.
 */

export const ORDER_QUEUE_LABELS: Record<OrderQueueId, string> = {
  followUpDue: "Follow-up due",
  unpaid: "Unpaid",
  cod: "COD",
  courierIssue: "Courier issues",
  cancelledButPaid: "Cancelled but paid",
  refundDue: "Returned · refund due",
  cancelledReturned: "Cancelled / Returned",
};

export const ALL_BD_DISTRICTS = Array.from(new Set(Object.values(BD_DISTRICTS_BY_DIVISION).flat())).sort();

export function paymentMethodLabel(method: string): string {
  return method === "COD" ? "Cash on delivery" : method === "SSLCOMMERZ" ? "SSLCommerz" : "EPS";
}

export const ORDER_FILTERS: readonly FilterDefinition[] = [
  { key: "f.queue", label: "Queue", kind: "select", placement: "quick", options: ORDER_QUEUE_IDS.map((id) => ({ value: id, label: ORDER_QUEUE_LABELS[id] })), chip: (label) => label },
  { key: "f.status", label: "Status", kind: "multi", placement: "quick", options: orderStatusEnum.options.map((s) => ({ value: s, label: orderStatusShortLabel(s) })) },
  { key: "f.payment", label: "Payment status", kind: "select", options: paymentStatusEnum.options.map((s) => ({ value: s, label: paymentStatusLabel(s) })), chip: (label) => `Payment: ${label}` },
  {
    key: "f.method",
    label: "Payment method",
    kind: "select",
    options: paymentMethodEnum.options.map((m) => ({ value: m, label: paymentMethodLabel(m) })),
    chip: (_label, value) => `Method: ${value === "COD" ? "COD" : value}`,
  },
  {
    key: "f.courier",
    label: "Courier",
    kind: "boolean",
    trueLabel: "Booked",
    falseLabel: "Not booked",
    chip: (_label, value) => (value === "true" ? "Courier: booked" : "Courier: not booked"),
  },
  { key: "f.delivery", label: "Delivery status", kind: "select", options: COURIER_DELIVERY_STATUSES.map((s) => ({ value: s, label: courierStatusLabel(s) })), chip: (label) => `Delivery: ${label}` },
  { key: "f.division", label: "Division", kind: "select", options: BD_DIVISIONS.map((d) => ({ value: d, label: d })) },
  {
    key: "f.district",
    label: "District",
    kind: "select",
    dependsOn: "f.division",
    options: (values) => {
      const division = values["f.division"];
      const list = typeof division === "string" && division ? (BD_DISTRICTS_BY_DIVISION[division as BdDivision] ?? []) : ALL_BD_DISTRICTS;
      return list.map((d) => ({ value: d, label: d }));
    },
  },
  { key: "from", label: "Placed from", kind: "date", chip: (label) => `From ${label}` },
  { key: "to", label: "Placed to", kind: "date", chip: (label) => `To ${label}` },
];

/** Deep links that predate the URL-state grammar — the dashboard's Action Center links `?queue=` and `?status=`. */
export const ORDER_FILTER_URL_ALIASES = { "f.queue": "queue", "f.status": "status" } as const;
