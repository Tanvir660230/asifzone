"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, PackageX, Sparkles } from "lucide-react";
import { formatVariantLabel, guessPartialReturn, type Order } from "@clothing-brand/shared";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { UnitStepper } from "@/components/admin/orders/detail/unit-stepper";
import { useCapability } from "@/hooks/use-capability";
import { ApiError } from "@/lib/api-client";
import { getOrder, listOrders, reconcilePartialDelivery } from "@/lib/api/admin-orders";
import { formatPrice } from "@/lib/format";

/**
 * Settle part deliveries (order-outcomes programme, PR 5): the courier delivered part of the parcel, and someone must say
 * which units came back before stock and the books are right. One order at a time — what was ordered, what the courier
 * collected, a suggestion when that money fits exactly one split — then Record & next. The units return to stock only
 * when the parcel is received (owner decision M2), as on the order page.
 */
export default function SettlePartialsPage() {
  const canManage = useCapability("orders.manage");
  const queryClient = useQueryClient();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [done, setDone] = useState(0);

  const list = useQuery({
    queryKey: ["orders", "partials-to-settle"],
    queryFn: ({ signal }) => listOrders({ exception: "partialToReconcile", pageSize: 100, sortBy: "createdAt", sortDir: "asc" }, { signal }),
  });
  const queue = useMemo(() => (list.data?.items ?? []).filter((o) => !skipped.includes(o.id)), [list.data, skipped]);
  const current = queue[0];
  const detail = useQuery({ queryKey: ["order", current?.id], queryFn: () => getOrder(current!.id), enabled: Boolean(current) });

  async function settled() {
    setDone((d) => d + 1);
    await queryClient.invalidateQueries({ queryKey: ["orders", "partials-to-settle"] });
  }

  const remaining = queue.length;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="Orders"
        title="Settle part deliveries"
        description="The courier delivered part of these parcels. Say what came back for each — stock and the books follow. Units go back on the shelf when you receive the parcel."
      />
      {list.isError ? (
        <ErrorState description="The part deliveries didn't load." onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="h-80 animate-pulse rounded-2xl bg-ink-900/[0.04]" aria-busy="true" aria-label="Loading" />
      ) : !current ? (
        <EmptyState
          icon={CheckCircle2}
          title={done ? `All settled — ${done} done` : "Nothing to settle"}
          description={skipped.length ? `${skipped.length} skipped for now. Reload to see them again.` : "Every part delivery has its returns recorded."}
          action={
            <Link href="/admin/orders" className="text-sm font-medium text-fg underline underline-offset-4">
              Back to orders
            </Link>
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-fg-muted" data-testid="partials-progress">
            {remaining} to settle{done ? ` · ${done} done` : ""}
          </p>
          {detail.isError ? (
            <ErrorState description="This order didn't load." onRetry={() => void detail.refetch()} />
          ) : !detail.data ? (
            <div className="h-72 animate-pulse rounded-2xl bg-ink-900/[0.04]" aria-busy="true" aria-label="Loading" />
          ) : (
            <SettleCard key={detail.data.order.id} order={detail.data.order} canManage={canManage} onDone={settled} onSkip={() => setSkipped((s) => [...s, detail.data!.order.id])} />
          )}
        </>
      )}
    </div>
  );
}

function SettleCard({ order, canManage, onDone, onSkip }: { order: Order; canManage: boolean; onDone: () => Promise<void>; onSkip: () => void }) {
  const lines = order.items.map((i) => ({ id: i.id, quantity: i.quantity, unitPrice: Number(i.priceSnapshot) }));
  // What the courier collected; before Steadfast reports it, the money already received on the order (the payout).
  const paid = order.payment?.paid ?? 0;
  const collected = order.courierCollectedAmount != null ? Number(order.courierCollectedAmount) : paid > 0 ? paid : null;
  const delivery = order.shippingWaived ? 0 : Number(order.shippingFee);
  const guess = useMemo(() => guessPartialReturn(lines, collected, delivery), [order.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [returned, setReturned] = useState<Record<string, number>>(guess?.returned ?? {});
  const [busy, setBusy] = useState(false);
  useEffect(() => setReturned(guess?.returned ?? {}), [guess]);

  async function record() {
    setBusy(true);
    try {
      await reconcilePartialDelivery(order.id, { items: order.items.map((i) => ({ orderItemId: i.id, returnedQuantity: returned[i.id] ?? 0 })) });
      toast.success(`${order.orderNumber} settled`);
      await onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't record it — try again");
    } finally {
      setBusy(false);
    }
  }

  const backUnits = Object.values(returned).reduce((s, n) => s + n, 0);
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-6" data-testid="settle-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/admin/orders/${order.id}`} className="font-medium text-fg underline-offset-2 hover:underline">
          {order.orderNumber}
        </Link>
        <span className="text-sm text-fg-muted">{order.customerName}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-ink-900/[0.03] p-3 text-sm">
        <div>
          <dt className="text-fg-muted">Order total</dt>
          <dd className="font-medium tabular-nums text-fg">{formatPrice(Number(order.total))}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Money received</dt>
          <dd className="font-medium tabular-nums text-fg" data-testid="settle-collected">
            {collected != null ? formatPrice(collected) : "Not known yet"}
          </dd>
        </div>
      </dl>

      {guess ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-fg" data-testid="settle-guess">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          Filled in from the money: what the customer kept adds up to the {formatPrice(collected!)} collected{guess.withDelivery ? " (delivery included)" : ""}. Check it, then record.
        </p>
      ) : (
        <p className="mt-3 flex items-start gap-2 text-sm text-fg-muted">
          <PackageX size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          Enter how many of each came back; leave 0 for what the customer kept.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {order.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-line-subtle p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg sm:truncate">{item.productNameSnapshot}</p>
              <p className="text-xs text-fg-muted">
                {[formatVariantLabel(item.sizeSnapshot, item.colorSnapshot, "/"), `Ordered ${item.quantity}`, formatPrice(Number(item.priceSnapshot))].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <span className="text-xs text-fg-muted">Came back</span>
              <UnitStepper label={`${item.productNameSnapshot} came back`} value={returned[item.id] ?? 0} max={item.quantity} onChange={(v) => setReturned({ ...returned, [item.id]: v })} />
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onSkip} disabled={busy} data-testid="settle-skip">
          Skip for now
        </Button>
        <Button onClick={record} loading={busy} disabled={!canManage} data-testid="settle-record">
          {backUnits ? `Record ${backUnits} back & next` : "Nothing came back — record & next"}
        </Button>
      </div>
      {!canManage && <p className="mt-2 text-right text-xs text-fg-muted">Recording needs the Manage orders permission.</p>}
    </div>
  );
}
