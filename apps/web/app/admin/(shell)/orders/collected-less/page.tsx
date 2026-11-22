"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { DoorShortfallCard } from "@/components/admin/orders/door-shortfall-card";
import { ListPage } from "@/components/admin/patterns/list-page";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { useCapability } from "@/hooks/use-capability";
import { listDoorShortfalls } from "@/lib/api/admin-orders";
import { formatStoreDate } from "@/lib/format";

/**
 * Collected less (docs/PAYMENT_LEDGER.md §5d): delivered parcels whose courier collected less than the order says. One at a
 * time; nothing changes until someone says why. Older orders, still booked in full, are listed from Steadfast's own messages.
 */
export default function CollectedLessPage() {
  const canPrice = useCapability("orders.adjustPrice");
  const canPay = useCapability("payments.record");
  const queryClient = useQueryClient();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [done, setDone] = useState(0);
  const list = useQuery({ queryKey: ["orders", "door-shortfalls"], queryFn: ({ signal }) => listDoorShortfalls({ signal }) });
  const queue = useMemo(() => (list.data?.items ?? []).filter((o) => !skipped.includes(o.orderId)), [list.data, skipped]);
  const current = queue[0];

  return (
    <ListPage
      eyebrow="Orders"
      title="Collected less"
      description="The courier collected less than these orders say. Say why for each: the order's total, payment and the books follow."
      className="mx-auto max-w-2xl"
      tabs={false}
    >
      {list.isError ? (
        <ErrorState description="The list didn't load." onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="h-80 animate-pulse rounded-2xl bg-ink-900/[0.04]" aria-busy="true" aria-label="Loading" />
      ) : !current ? (
        <EmptyState
          icon={CheckCircle2}
          title={done ? `All decided: ${done} done` : "Nothing to decide"}
          description={skipped.length ? `${skipped.length} skipped for now. Reload to see them again.` : "Every delivered parcel's money matches its order."}
          action={
            <Link href="/admin/orders" className="text-sm font-medium text-fg underline underline-offset-4">
              Back to orders
            </Link>
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-fg-muted" data-testid="door-progress">
            {queue.length} to decide{done ? ` · ${done} done` : ""}
          </p>
          <div className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-6">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/admin/orders/${current.orderId}`} className="font-medium text-fg underline-offset-2 hover:underline">
                {current.orderNumber}
              </Link>
              <span className="min-w-0 truncate text-sm text-fg-muted">
                {current.customerName} · {formatStoreDate(current.deliveredAt)}
              </span>
            </div>
            {!current.recorded && (
              <Badge variant="neutral" className="mb-3">
                Booked in full until you decide
              </Badge>
            )}
            <DoorShortfallCard
              key={current.orderId}
              orderId={current.orderId}
              expected={current.expected}
              collected={current.collected}
              paidOut={current.paidOut}
              canDecide={canPrice && canPay}
              onDone={async () => {
                setDone((d) => d + 1);
                await queryClient.invalidateQueries({ queryKey: ["orders", "door-shortfalls"] });
              }}
              onSkip={() => setSkipped((s) => [...s, current.orderId])}
            />
          </div>
        </>
      )}
    </ListPage>
  );
}
