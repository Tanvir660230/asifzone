"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { formatVariantLabel, type Order } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { invalidateOrderQueries, type OrderPermissions } from "../order-domain";
import { DetailSection } from "./detail-section";
import { UnitStepper } from "./unit-stepper";

type Line = { good: number; damaged: number };

/**
 * Blueprint P0.4 (S2–S4, S6): units a return agreed back that are not at the shop yet (Goods awaiting return). They come back
 * into stock only here, when someone has them in hand: per item, how many came back sellable and how many damaged (written
 * off at the line's cost). What isn't received stays waiting; after the store's write-off wait it can be written off as
 * never returned from Returns & refused parcels.
 */
export function AwaitingReturnSection({ order, perms }: { order: Order; perms: OrderPermissions }) {
  const queryClient = useQueryClient();
  const waiting = order.items.map((item) => ({ item, units: item.awaitingReturnQuantity ?? 0 })).filter((l) => l.units > 0);
  const [lines, setLines] = useState<Record<string, Line>>({});
  useEffect(() => setLines({}), [order.id]);
  const receive = useMutation({
    mutationFn: (body: Parameters<typeof adminOrdersApi.receiveAwaitingReturn>[1]) => adminOrdersApi.receiveAwaitingReturn(order.id, body),
    onSuccess: () => {
      toast.success("Return received");
      setLines({});
      invalidateOrderQueries(queryClient, order.id);
      void queryClient.invalidateQueries({ queryKey: ["orders", "parcels-to-receive"] });
    },
    onError: (err) => toast.error(getErrorMessage(err, "The return couldn't be received")),
  });
  if (!waiting.length) return null;

  const lineOf = (id: string, units: number): Line => lines[id] ?? { good: units, damaged: 0 };
  const set = (id: string, units: number, patch: Partial<Line>) => {
    const next = { ...lineOf(id, units), ...patch };
    if (next.good + next.damaged > units) next.good = units - next.damaged;
    setLines({ ...lines, [id]: next });
  };
  const body = waiting.map(({ item, units }) => ({ orderItemId: item.id, ...lineOf(item.id, units) })).filter((l) => l.good + l.damaged > 0);
  const total = waiting.reduce((s, l) => s + l.units, 0);
  const canReceive = perms.returns && !order.deletedAt;

  return (
    <DetailSection title="Waiting to come back" icon={Undo2} testId="awaiting-return">
      <p className="text-sm text-ink-600">
        {total} unit(s) were agreed back and aren&apos;t at the shop yet. They go back into stock when you receive them — damaged ones are written off.
      </p>
      <ul className="space-y-2">
        {waiting.map(({ item, units }) => {
          const l = lineOf(item.id, units);
          const variant = formatVariantLabel(item.sizeSnapshot, item.colorSnapshot, "/");
          return (
            <li key={item.id} className="space-y-2.5 rounded-lg border border-line-subtle bg-surface p-2.5 text-sm" data-testid="awaiting-line">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink-900">{item.productNameSnapshot}</p>
                <p className="text-xs text-ink-500">{[variant, `${units} to come back`].filter(Boolean).join(" · ")}</p>
              </div>
              {canReceive && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-600">
                  <span className="flex items-center gap-2">
                    <span className="w-[4.5rem] sm:w-auto">Good</span>
                    <UnitStepper label={`Good units of ${item.productNameSnapshot} received`} value={l.good} max={units - l.damaged} onChange={(v) => set(item.id, units, { good: v })} />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-[4.5rem] sm:w-auto">Damaged</span>
                    <UnitStepper label={`Damaged units of ${item.productNameSnapshot} received`} value={l.damaged} max={units - l.good} onChange={(v) => set(item.id, units, { damaged: v })} />
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canReceive && (
        <div className="flex justify-end">
          <Button size="sm" disabled={!body.length} loading={receive.isPending} onClick={() => receive.mutate({ lines: body })} data-testid="receive-awaiting">
            Receive return
          </Button>
        </div>
      )}
    </DetailSection>
  );
}
