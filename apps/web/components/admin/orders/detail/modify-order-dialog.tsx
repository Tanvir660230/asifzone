"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Order } from "@clothing-brand/shared";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { ChangeOrderForm } from "@/components/orders/adjustments/change-order-form";
import { useModificationFlow } from "@/components/orders/adjustments/use-modification-flow";
import * as adjustmentsApi from "@/lib/api/admin-order-adjustments";
import { formatPrice } from "@/lib/format";
import { invalidateOrderQueries } from "../order-domain";

/** Staff change of an order's contents / delivery details (docs/ORDER_ADJUSTMENTS.md §3, §10): the shared change-order
 * flow against the staff endpoints. The server prices it, decides whether it applies now or waits for payment, and
 * refuses it when the order can no longer be changed. */
export function ModifyOrderDialog({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <ModifyOrderDialogBody order={order} onClose={onClose} />;
}

function ModifyOrderDialogBody({ order, onClose }: { order: Order; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [collectLater, setCollectLater] = useState(false);
  const flow = useModificationFlow({
    order,
    extraInput: collectLater ? { collectDifferenceLater: true } : undefined,
    adapter: {
      preview: (input) => adjustmentsApi.previewOrderModification(order.id, input),
      apply: (input, key) => adjustmentsApi.applyOrderModification(order.id, input, key),
    },
    onApplied: (result) => {
      invalidateOrderQueries(queryClient, order.id);
      const m = result.modification;
      toast.success(
        m.status === "AWAITING_PAYMENT"
          ? `Change saved — it applies once ${formatPrice(m.amountDue)} is paid`
          : m.amountCredited > 0
            ? `Order changed — ${formatPrice(m.amountCredited)} added to the customer's Store Balance`
            : "Order changed",
      );
      onClose();
    },
  });
  const waiting = flow.preview?.outcome === "AWAITING_PAYMENT" || collectLater;
  // Re-price whenever the switch changes: the server decides what applying now means (after render, so the new flag is sent).
  const lastCollectLater = useRef(collectLater);
  useEffect(() => {
    if (lastCollectLater.current === collectLater) return; // mount (incl. React's dev double-run): nothing changed
    lastCollectLater.current = collectLater;
    flow.review();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectLater]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Change order ${order.orderNumber}`}
      description={flow.step === "edit" ? "Edit items, quantities, sizes or delivery details. Prices and totals are calculated by the store." : "Review the result before applying it."}
      widthClassName="max-w-2xl"
    >
      <ChangeOrderForm
        flow={flow}
        audience="staff"
        paymentMethod={order.paymentMethod}
        onCancel={onClose}
        idPrefix={`modify-${order.id}`}
        reviewExtras={
          waiting && order.paymentMethod !== "COD" ? (
            <label className="flex items-start gap-2.5 rounded-xl border border-line-subtle p-3 text-sm text-ink-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={collectLater}
                onChange={(e) => setCollectLater(e.target.checked)}
              />
              <span>
                Apply now and collect the difference later
                <span className="block text-xs text-ink-500">
                  Otherwise the change waits until the customer pays the difference (send them a payment link from Payments).
                </span>
              </span>
            </label>
          ) : null
        }
      />
    </Modal>
  );
}
