import { Check } from "lucide-react";
import type { Order, OrderStatus } from "@clothing-brand/shared";
import { formatStoreDateTime, orderStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The fulfilment path an order walks, with the statuses that count as having reached each step. */
const STEPS: { label: string; reachedBy: OrderStatus[] }[] = [
  { label: "Placed", reachedBy: [] },
  { label: "Confirmed", reachedBy: ["CONFIRMED", "PROCESSING"] },
  { label: "Packed", reachedBy: ["PACKED"] },
  { label: "Shipped", reachedBy: ["SHIPPED"] },
  { label: "Delivered", reachedBy: ["DELIVERED", "PARTIALLY_DELIVERED"] },
];

const CLOSED: OrderStatus[] = ["CANCELLED", "RETURNED", "REFUNDED"];

function stepIndex(status: OrderStatus): number {
  if (status === "PENDING") return 0;
  return STEPS.findIndex((s) => s.reachedBy.includes(status));
}

/**
 * Where the order is on its way to the customer (Blueprint V2 §K3): five steps with the time each was first reached,
 * read from the status history. A closed order (cancelled, returned, refunded) shows that outcome instead of a path it
 * left. Display only — which moves are allowed is the shared state machine's call.
 */
export function OrderProgress({ order }: { order: Order }) {
  const history = [...(order.statusHistory ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (CLOSED.includes(order.status)) {
    const closedAt = [...history].reverse().find((h) => h.status === order.status)?.createdAt;
    return (
      <div className="flex flex-wrap items-center gap-x-2 rounded-xl border border-line bg-surface px-5 py-3.5 text-[13px] shadow">
        <span className={cn("h-2 w-2 rounded-full", order.status === "RETURNED" ? "bg-danger-500" : "bg-ink-400")} aria-hidden />
        <span className="font-semibold text-fg">{orderStatusLabel(order.status)}</span>
        {closedAt && <span className="text-fg-muted">· {formatStoreDateTime(closedAt)}</span>}
      </div>
    );
  }

  const current = stepIndex(order.status);
  const reachedAt = (index: number): string | undefined => {
    if (index === 0) return order.createdAt;
    return history.find((h) => STEPS[index]!.reachedBy.includes(h.status))?.createdAt;
  };

  return (
    <nav aria-label="Order progress" className="overflow-x-auto rounded-xl border border-line bg-surface px-5 py-4 shadow">
      <ol className="flex min-w-[560px] items-start">
        {STEPS.map((step, i) => {
          const done = i < current;
          const here = i === current;
          const at = i <= current ? reachedAt(i) : undefined;
          return (
            <li key={step.label} className="relative flex flex-1 flex-col items-center text-center" aria-current={here ? "step" : undefined}>
              {i > 0 && (
                <span className={cn("absolute right-1/2 top-[11px] h-0.5 w-full", i <= current ? "bg-accent" : "bg-line")} aria-hidden />
              )}
              <span
                className={cn(
                  "relative z-[1] flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                  done && "bg-accent text-accent-fg",
                  here && "bg-surface text-accent ring-2 ring-accent",
                  !done && !here && "bg-surface text-fg-subtle ring-1 ring-line-strong",
                )}
              >
                {done ? <Check size={13} strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              <span className={cn("mt-2 text-[13px]", here ? "font-semibold text-fg" : done ? "font-medium text-fg" : "text-fg-subtle")}>
                {i === 4 && order.status === "PARTIALLY_DELIVERED" ? "Partly delivered" : step.label}
              </span>
              <span className="mt-0.5 text-xs text-fg-subtle">{at ? formatStoreDateTime(at) : " "}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
