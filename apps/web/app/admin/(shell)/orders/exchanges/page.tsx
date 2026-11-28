"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight } from "lucide-react";
import type { SwapStatusValue } from "@clothing-brand/shared";
import { ListPage } from "@/components/admin/patterns/list-page";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { listDoorSwaps, type DoorSwapBoardRow } from "@/lib/api/door-swap";
import { formatPrice, formatStoreDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS: Record<SwapStatusValue, { label: string; variant: "success" | "warning" | "neutral" | "danger" | "info" }> = {
  AWAITING_SWAP: { label: "Waiting for swap", variant: "warning" },
  SWAPPED: { label: "Old item on its way back", variant: "info" },
  KEPT_BOTH: { label: "Kept both (sold)", variant: "neutral" },
  REFUSED: { label: "Refused", variant: "danger" },
  OLD_RECEIVED: { label: "Old item received", variant: "success" },
  OLD_MISSING: { label: "Old item not back", variant: "danger" },
  CANCELLED: { label: "Called off", variant: "neutral" },
};

/** Most urgent first: a person must decide, the old item is late, then the rest by age. */
function rank(r: DoorSwapBoardRow) {
  if (r.needsCheck) return 0;
  if (r.swapStatus === "OLD_MISSING") return 1;
  if (r.swapStatus === "SWAPPED") return 2;
  if (r.swapStatus === "AWAITING_SWAP") return 3;
  return 4;
}

/**
 * Exchanges (door swaps) across all orders: which are still at the customer's door, which old items are on their way back
 * or late, and which need a person to decide (delivered at the full price: kept both, or the rider forgot to lower the COD).
 */
export default function ExchangesPage() {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const list = useQuery({ queryKey: ["door-swaps", filter], queryFn: ({ signal }) => listDoorSwaps(filter, { signal }) });
  const rows = [...(list.data?.items ?? [])].sort((a, b) => rank(a) - rank(b) || (a.createdAt < b.createdAt ? 1 : -1));
  const counts = {
    check: rows.filter((r) => r.needsCheck).length,
    late: rows.filter((r) => r.swapStatus === "OLD_MISSING").length,
  };

  return (
    <ListPage
      eyebrow="Orders"
      title="Exchanges"
      description="Size and colour swaps at the customer's door. Open each order to set what happened."
      className="mx-auto max-w-3xl"
      tabs={false}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Show">
        {(["open", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn("min-h-10 rounded-full border px-4 text-sm", filter === f ? "border-ink-900 bg-ink-900 text-cream-50" : "border-line-strong bg-surface hover:border-ink-400")}
          >
            {f === "open" ? "Needs attention" : "All exchanges"}
          </button>
        ))}
        {(counts.check > 0 || counts.late > 0) && (
          <p className="ml-auto text-sm text-fg-muted" data-testid="exchange-board-counts">
            {counts.check > 0 && `${counts.check} to check`}
            {counts.check > 0 && counts.late > 0 && " · "}
            {counts.late > 0 && `${counts.late} old item${counts.late === 1 ? "" : "s"} late`}
          </p>
        )}
      </div>

      {list.isError ? (
        <ErrorState description="The exchanges didn't load." onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-ink-900/[0.04]" aria-busy="true" aria-label="Loading" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={filter === "open" ? "No exchange needs attention" : "No exchanges yet"}
          description="Start one from a delivered order: Problems & exchanges › Exchange."
        />
      ) : (
        <ul className="space-y-2" data-testid="exchange-board">
          {rows.map((r) => (
            <li key={r.id} className={cn("rounded-2xl bg-surface p-4 ring-1 ring-inset", r.needsCheck || r.swapStatus === "OLD_MISSING" ? "ring-warning-200" : "ring-line-subtle")}>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/admin/orders/${r.order.id}`} className="font-medium text-fg underline-offset-2 hover:underline">
                  {r.order.orderNumber}
                </Link>
                {r.swapStatus && (
                  <Badge variant={r.needsCheck ? "warning" : STATUS[r.swapStatus].variant} dot>
                    {r.needsCheck ? "Check: kept both?" : STATUS[r.swapStatus].label}
                  </Badge>
                )}
                <span className="ml-auto text-xs text-fg-muted">{formatStoreDate(r.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm text-fg">
                {r.order.customerName} <span className="text-fg-muted">· {r.order.customerPhone}</span>
              </p>
              <p className="text-sm text-fg-muted">
                {r.item}: {r.from} → {r.to} · {r.reasonLabel}
                {r.total !== null && r.protectedCod !== null && <span className="tabular-nums"> · {r.total > 0 ? formatPrice(r.total) : "free"} with the old item, {formatPrice(r.protectedCod)} if kept</span>}
              </p>
              {r.swapNote && <p className={cn("mt-1 text-xs", r.needsCheck ? "font-medium text-warning-700" : "text-fg-muted")}>{r.swapNote}</p>}
              {r.exchangeOrder && (
                <p className="mt-1 text-xs text-fg-muted">
                  Replacement{" "}
                  <Link href={`/admin/orders/${r.exchangeOrder.id}`} className="font-medium text-fg underline-offset-2 hover:underline">
                    {r.exchangeOrder.orderNumber}
                  </Link>
                  {r.exchangeOrder.courierStatus ? ` · Steadfast: ${r.exchangeOrder.courierStatus.replace(/_/g, " ")}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </ListPage>
  );
}
