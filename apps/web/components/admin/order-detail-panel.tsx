"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchX } from "lucide-react";
import { ErrorState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { ApiError } from "@/lib/api-client";
import { orderAttention, orderKeys, useOrderPermissions } from "@/components/admin/orders/order-domain";
import { useOrderCommands } from "@/components/admin/orders/use-order-commands";
import { useOrderDetailCommands } from "@/components/admin/orders/detail/use-order-detail-commands";
import { DetailHeader } from "@/components/admin/orders/detail/detail-header";
import { CustomerSection } from "@/components/admin/orders/detail/customer-section";
import { ItemsSection } from "@/components/admin/orders/detail/items-section";
import { PaymentsSection } from "@/components/admin/orders/detail/payments-section";
import { DeliverySection } from "@/components/admin/orders/detail/delivery-section";
import { FollowUpSection } from "@/components/admin/orders/detail/follow-up-section";
import { ActivityTimeline } from "@/components/admin/orders/detail/activity-timeline";
import { AttentionPanel, NotesSection, ReturnsSection } from "@/components/admin/orders/detail/notes-returns";
import { ChangesSection } from "@/components/admin/orders/detail/changes-section";
import { ModifyOrderDialog } from "@/components/admin/orders/detail/modify-order-dialog";
import { ItemReturnDialog } from "@/components/admin/orders/detail/item-return-dialog";

interface OrderDetailPanelProps {
  orderId: string;
  /** "Back to orders" (page) / drawer close (drawer) — also called after a permanent delete. */
  onClose: () => void;
  /** "page": the standalone /admin/orders/[id] route, two columns on wide screens. "drawer": the list's slide-in, one column. */
  variant?: "page" | "drawer";
}

/** The one order-detail implementation, shared by the orders list's drawer and the full /admin/orders/[id] page. It
 * fetches the order (GET /api/orders/:id — auto-syncs a stale courier status, carries the payment ledger, returns,
 * courier losses) and lays out the sections; each section renders server data and issues commands. */
export function OrderDetailPanel({ orderId, onClose, variant = "page" }: OrderDetailPanelProps) {
  const perms = useOrderPermissions();
  const commands = useOrderCommands({ onPurged: onClose });
  const detail = useOrderDetailCommands(orderId);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: orderKeys.detail(orderId), queryFn: () => adminOrdersApi.getOrder(orderId) });
  // Order-adjustment dialogs (docs/ORDER_ADJUSTMENTS.md): change the order / record an item-level return.
  const [dialog, setDialog] = useState<"modify" | "return" | null>(null);
  useEffect(() => setDialog(null), [orderId]);

  const outer = variant === "page" ? "mx-auto max-w-6xl space-y-5" : "space-y-4 p-4 sm:p-5";

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className={outer}>
        {notFound ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <SearchX size={28} className="text-ink-300" aria-hidden="true" />
            <p className="text-sm text-ink-600">This order no longer exists — it may have been permanently deleted.</p>
            <Button variant="outline" size="sm" onClick={onClose}>
              Back to orders
            </Button>
          </div>
        ) : (
          <ErrorState description="The order couldn't be loaded." onRetry={() => refetch()} />
        )}
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className={outer} aria-busy="true" aria-label="Loading order">
        <div className="space-y-4">
          <div className="h-20 rounded-xl ui-skeleton" />
          <div className="h-32 rounded-xl ui-skeleton" />
          <div className="h-48 rounded-xl ui-skeleton" />
        </div>
      </div>
    );
  }

  const { order } = data;
  const attention = orderAttention(order);
  const sections = {
    customer: <CustomerSection order={order} detail={detail} perms={perms} stacked={variant === "page"} />,
    items: <ItemsSection order={order} detail={detail} perms={perms} />,
    payments: <PaymentsSection order={order} detail={detail} perms={perms} confirm={commands.confirm} />,
    delivery: <DeliverySection order={order} commands={commands} detail={detail} perms={perms} />,
    followUp: <FollowUpSection order={order} detail={detail} perms={perms} />,
    timeline: <ActivityTimeline order={order} />,
    notes: <NotesSection order={order} detail={detail} perms={perms} />,
    returns: <ReturnsSection order={order} perms={perms} />,
    changes: <ChangesSection order={order} perms={perms} onModify={() => setDialog("modify")} onReturn={() => setDialog("return")} />,
  };

  return (
    <div className={outer} data-testid="order-detail">
      <DetailHeader order={order} variant={variant} commands={commands} perms={perms} onClose={onClose} />
      <AttentionPanel items={attention} />

      {variant === "page" ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
          <div className="min-w-0 space-y-5">
            {sections.items}
            {sections.changes}
            {sections.payments}
            {sections.delivery}
            {sections.timeline}
          </div>
          <aside className="min-w-0 space-y-5" aria-label="Customer, follow-up and notes">
            {sections.customer}
            {sections.followUp}
            {sections.notes}
            {sections.returns}
          </aside>
        </div>
      ) : (
        <div className="space-y-4">
          {sections.customer}
          {sections.followUp}
          {sections.items}
          {sections.changes}
          {sections.payments}
          {sections.delivery}
          {sections.timeline}
          {sections.notes}
          {sections.returns}
        </div>
      )}

      {commands.dialogs}
      <ModifyOrderDialog order={order} open={dialog === "modify"} onClose={() => setDialog(null)} />
      <ItemReturnDialog order={order} open={dialog === "return"} onClose={() => setDialog(null)} />
    </div>
  );
}
