"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AdjustOrderPriceInput,
  ReconcilePartialDeliveryInput,
  RecordPaymentInput,
  RecordRefundInput,
  UpdateOrderDetailsInput,
} from "@clothing-brand/shared";
import { toast } from "@/components/ui/toast";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as paymentsAdminApi from "@/lib/api/payments-admin";
import { ApiError } from "@/lib/api-client";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { invalidateOrderQueries } from "../order-domain";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** The commands only the order detail issues (details, follow-up, price, reconciliation, refunds, payments). Each one calls
 * its API endpoint and refreshes the order — validation, guards and amounts are the server's. */
export function useOrderDetailCommands(orderId: string) {
  const queryClient = useQueryClient();
  const refresh = () => invalidateOrderQueries(queryClient, orderId);
  const fail = (fallback: string) => (err: unknown) => toast.error(errorText(err, fallback));

  const details = useMutation({
    mutationFn: (input: UpdateOrderDetailsInput) => adminOrdersApi.updateOrderDetails(orderId, input),
    onSuccess: () => {
      refresh();
      toast.success("Order updated");
    },
    onError: fail("Failed to save"),
  });
  const hold = useMutation({
    mutationFn: ({ followUpAt, note }: { followUpAt: Date; note?: string }) => adminOrdersApi.holdOrder(orderId, followUpAt.toISOString(), note),
    onSuccess: () => {
      refresh();
      toast.success("Follow-up scheduled");
    },
    onError: fail("Failed to schedule the follow-up"),
  });
  const clearHold = useMutation({
    mutationFn: () => adminOrdersApi.clearOrderHold(orderId),
    onSuccess: () => {
      refresh();
      toast.success("Follow-up cleared");
    },
    onError: fail("Failed to clear the follow-up"),
  });
  const price = useMutation({
    mutationFn: (input: AdjustOrderPriceInput) => adminOrdersApi.adjustOrderPrice(orderId, input),
    onSuccess: () => {
      refresh();
      toast.success("Price adjusted");
    },
    onError: fail("Failed to adjust the price"),
  });
  const reconcile = useMutation({
    mutationFn: (input: ReconcilePartialDeliveryInput) => adminOrdersApi.reconcilePartialDelivery(orderId, input),
    onSuccess: () => {
      refresh();
      toast.success("Partial delivery reconciled");
    },
    onError: fail("Failed to reconcile"),
  });
  // Money-creating commands carry an Idempotency-Key: a retry of the same submission is recorded once (Phase 9).
  const refund = useMutation({
    mutationFn: (input: RecordRefundInput) => paymentsAdminApi.createRefund(orderId, input, idempotencyKeyFor(`refund:${orderId}`, input)),
    onSuccess: () => {
      settleIdempotencyKey(`refund:${orderId}`);
      refresh();
      toast.success("Refund recorded");
    },
    onError: fail("Failed to record the refund"),
  });
  // Moves money owed back to the customer's store balance (docs/ORDER_ADJUSTMENTS.md §4) — idempotent like a refund.
  const storeCredit = useMutation({
    mutationFn: (input: { amount?: number; reason: string }) =>
      paymentsAdminApi.creditToStoreBalance(orderId, input, idempotencyKeyFor(`store-credit:${orderId}`, input)),
    onSuccess: () => {
      settleIdempotencyKey(`store-credit:${orderId}`);
      refresh();
      toast.success("Added to the customer's store balance");
    },
    onError: fail("Failed to add store credit"),
  });
  const completeRefund = useMutation({
    mutationFn: (refundId: string) => paymentsAdminApi.completeRefund(orderId, refundId, {}),
    onSuccess: () => {
      refresh();
      toast.success("Refund marked as paid out");
    },
    onError: fail("Failed to complete the refund"),
  });
  const payment = useMutation({
    mutationFn: (input: RecordPaymentInput) => paymentsAdminApi.recordPayment(orderId, input, idempotencyKeyFor(`payment:${orderId}`, input)),
    onSuccess: () => {
      settleIdempotencyKey(`payment:${orderId}`);
      refresh();
      toast.success("Payment recorded");
    },
    onError: fail("Failed to record the payment"),
  });

  return { details, hold, clearHold, price, reconcile, refund, completeRefund, payment, storeCredit };
}

export type OrderDetailCommands = ReturnType<typeof useOrderDetailCommands>;
