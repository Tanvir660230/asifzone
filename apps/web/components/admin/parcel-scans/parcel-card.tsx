"use client";

import Link from "next/link";
import { PARCEL_STATE_LABELS, PARCEL_MONEY_REASON_LABELS, type ParcelMoneyReason, type ParcelState, type ParcelView } from "@clothing-brand/shared";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { formatPrice, formatStoreDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The parcel the scanner opened (both modes): who it is for, where it stands, and every line with its counts. */

const STATE_TONE: Record<ParcelState, NonNullable<BadgeProps["variant"]>> = {
  READY_FOR_DISPATCH: "info",
  ALREADY_DISPATCHED: "success",
  NOT_BOOKED: "warning",
  NOT_CONFIRMED: "warning",
  CANCELLED: "danger",
  DELIVERED: "success",
  PARTIALLY_DELIVERED: "warning",
  RETURNED: "neutral",
  IN_TRASH: "danger",
};

export function ParcelStateBadge({ state }: { state: ParcelState }) {
  return (
    <Badge variant={STATE_TONE[state]} dot data-testid="parcel-state" data-state={state}>
      {PARCEL_STATE_LABELS[state]}
    </Badge>
  );
}

export function ParcelHeader({ parcel, compact = false }: { parcel: ParcelView; compact?: boolean }) {
  const c = parcel.courier;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/orders?open=${parcel.orderId}`} className="text-lg font-semibold tracking-tight text-fg hover:underline" data-testid="parcel-order-number">
          {parcel.orderNumber}
        </Link>
        <ParcelStateBadge state={parcel.state} />
        {c.courierStatus && <span className="text-xs text-fg-muted">Steadfast: {c.courierStatus.replace(/_/g, " ")}</span>}
      </div>
      <p className="text-sm text-fg">
        <span className="font-medium">{parcel.customerName}</span>
        <span className="text-fg-muted"> · {parcel.customerPhone}</span>
      </p>
      {!compact && <p className="text-sm text-fg-muted">{parcel.address}</p>}
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        {c.consignmentId && (
          <div>
            <dt className="inline">Consignment </dt>
            <dd className="inline font-mono text-fg">{c.consignmentId}</dd>
          </div>
        )}
        {c.trackingNumber && (
          <div>
            <dt className="inline">Label </dt>
            <dd className="inline font-mono text-fg">{c.trackingNumber}</dd>
          </div>
        )}
        {parcel.handedOver && (
          <div>
            <dt className="inline">Handed over </dt>
            <dd className="inline text-fg">
              {formatStoreDateTime(parcel.handedOver.at)}
              {parcel.handedOver.by ? ` · ${parcel.handedOver.by}` : ""}
            </dd>
          </div>
        )}
        {parcel.receivedBack && (
          <div>
            <dt className="inline">Back in hand </dt>
            <dd className="inline text-fg">
              {formatStoreDateTime(parcel.receivedBack.at)}
              {parcel.receivedBack.by ? ` · ${parcel.receivedBack.by}` : ""}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "warn" | "muted" }) {
  return (
    <span className={cn("whitespace-nowrap", tone === "warn" && value > 0 ? "font-medium text-warning-800" : tone === "muted" || value === 0 ? "text-fg-subtle" : "text-fg-muted")}>
      {label} <span className="tabular-nums">{value}</span>
    </span>
  );
}

/** The lines as read-only counts (dispatch, and the return card before anything is entered). */
export function ParcelLinesList({ parcel, checked }: { parcel: ParcelView; checked?: Map<string, number> }) {
  return (
    <ul className="divide-y divide-line-subtle" data-testid="parcel-lines">
      {parcel.lines.map((l) => {
        const done = checked?.get(l.orderItemId) ?? 0;
        return (
          <li key={l.orderItemId} className="py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{l.name}</p>
                <p className="truncate text-xs text-fg-muted">
                  <span className="font-mono">{l.sku}</span>
                  {[l.size, l.color].filter(Boolean).length ? ` · ${[l.size, l.color].filter(Boolean).join(", ")}` : ""}
                </p>
              </div>
              {checked ? (
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", done >= l.ordered ? "bg-success-100 text-success-800" : "bg-ink-100 text-ink-700")} data-testid="content-check-count">
                  {done} / {l.ordered}
                </span>
              ) : (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">× {l.ordered}</span>
              )}
            </div>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              <Count label="Delivered" value={l.delivered} />
              <Count label="Returned" value={l.returned} />
              <Count label="Received" value={l.received} />
              <Count label="Waiting" value={l.awaiting} tone="warn" />
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** Earlier receipts, corrections and scans of this parcel — newest first. */
export function ParcelHistory({ parcel, onCorrect }: { parcel: ParcelView; onCorrect?: (receiptId: string) => void }) {
  const names = new Map(parcel.lines.map((l) => [l.orderItemId, l.name]));
  if (!parcel.receipts.length && !parcel.scans.length) return <p className="text-sm text-fg-muted">No earlier scans or receipts.</p>;
  return (
    <ol className="space-y-2.5 text-sm" data-testid="parcel-history">
      {parcel.receipts.map((r) => {
        const parts = r.lines
          .map((l) =>
            r.kind === "CORRECTION"
              ? `${l.quantity} × ${names.get(l.orderItemId) ?? "item"}: ${String(l.from).toLowerCase()} → ${String(l.to).toLowerCase()}`
              : [
                  l.kept ? `${l.kept} kept` : "",
                  l.good ? `${l.good} good` : "",
                  l.damaged ? `${l.damaged} damaged` : "",
                  l.missing ? `${l.missing} missing` : "",
                  l.wrong ? `${l.wrong} wrong item` : "",
                  l.other ? `${l.other} other` : "",
                ]
                  .filter(Boolean)
                  .join(", ")
                  .replace(/^/, `${names.get(l.orderItemId) ?? "item"}: `),
          )
          .filter((s) => !s.endsWith(": "));
        return (
          <li key={r.id} className="rounded-xl bg-surface-muted px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-fg">
                {r.kind === "CORRECTION" ? "Correction" : r.outcome === "FULL_RETURN" ? "Received — customer kept nothing" : r.outcome === "PARTIAL" ? "Received — partly delivered" : "Received"}
              </span>
              <span className="text-xs text-fg-muted">
                {formatStoreDateTime(r.createdAt)}
                {r.by ? ` · ${r.by}` : ""}
              </span>
            </div>
            {parts.length > 0 && <p className="mt-0.5 text-xs text-fg-muted">{parts.join(" · ")}</p>}
            {r.actualCollected !== null && (
              <p className="mt-0.5 text-xs text-fg-muted">
                Courier handed over {formatPrice(r.actualCollected)}
                {r.courierCharge !== null ? ` · charge ${formatPrice(r.courierCharge)}` : ""}
                {r.reason ? ` · ${PARCEL_MONEY_REASON_LABELS[r.reason as ParcelMoneyReason] ?? r.reason}` : ""}
              </p>
            )}
            {r.note && <p className="mt-0.5 text-xs text-fg-muted">“{r.note}”</p>}
            {onCorrect && r.kind === "RECEIPT" && (
              <button type="button" className="mt-1 text-xs font-medium text-fg underline-offset-2 hover:underline" onClick={() => onCorrect(r.id)}>
                Correct this receipt
              </button>
            )}
          </li>
        );
      })}
      {parcel.scans.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 text-xs text-fg-muted">
          <span>
            {s.kind === "DISPATCH" ? "Dispatch scan" : "Return scan"} · <span className="font-mono">{s.code.length > 32 ? `${s.code.slice(0, 32)}…` : s.code}</span>
          </span>
          <span>
            {formatStoreDateTime(s.at)}
            {s.by ? ` · ${s.by}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}
