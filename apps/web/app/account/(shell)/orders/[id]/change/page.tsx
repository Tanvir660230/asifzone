"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { customerCancelBlocker, orderModificationBlocker, type Order } from "@clothing-brand/shared";
import { BackLink } from "@/components/ui/back-link";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { ChangeOrderForm } from "@/components/orders/adjustments/change-order-form";
import { useModificationFlow } from "@/components/orders/adjustments/use-modification-flow";
import { applyMyOrderChange, getMyOrder, previewMyOrderChange } from "@/lib/api/customers";
import { formatPrice } from "@/lib/format";

/** Customer "Change order" (docs/ORDER_ADJUSTMENTS.md §3, §18): edit the order while it hasn't been prepared yet, see
 * the store's summary of what changes and what it costs, confirm. The store prices everything. */
export default function ChangeOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({ queryKey: ["my-order", id], queryFn: () => getMyOrder(id) });

  if (isError) {
    return (
      <div className="space-y-6">
        <BackLink href="/account/orders" label="Back to Orders" />
        <p className="text-sm text-ink-600">This order doesn&apos;t exist, or isn&apos;t linked to your account.</p>
      </div>
    );
  }
  if (isLoading || !data) return <div className="h-64 animate-pulse rounded-2xl bg-ink-50" aria-busy="true" aria-label="Loading order" />;
  return <ChangeOrder order={data.order} />;
}

function ChangeOrder({ order }: { order: Order }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const back = `/account/orders/${order.id}`;
  const blocker = orderModificationBlocker(order, "CUSTOMER");
  const flow = useModificationFlow({
    order,
    adapter: {
      preview: (input) => previewMyOrderChange(order.id, input),
      apply: (input, key) => applyMyOrderChange(order.id, input, key),
    },
    onApplied: ({ modification }) => {
      void queryClient.invalidateQueries({ queryKey: ["my-order", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["my-order-changes", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["my-store-credit"] });
      toast.success(
        modification.status === "AWAITING_PAYMENT"
          ? `Almost done — pay ${formatPrice(modification.amountDue)} to complete your change`
          : modification.amountCredited > 0
            ? `Order updated — ${formatPrice(modification.amountCredited)} was added to your Store Balance`
            : "Your order has been updated",
      );
      router.push(back);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: "Account", href: "/account" }, { label: "Orders", href: "/account/orders" }, { label: order.orderNumber, href: back }, { label: "Change" }]} />
        <BackLink href={back} label="Back to order" />
      </div>
      <AccountPageHeader title={`Change order ${order.orderNumber}`} description="Add or remove items, change sizes or quantities, or update where it's delivered." />
      {blocker ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-line-subtle bg-surface p-5" data-testid="change-not-allowed">
          <p className="flex items-start gap-2 text-sm text-ink-700">
            <Lock size={16} className="mt-0.5 shrink-0 text-ink-500" aria-hidden="true" />
            {blocker}
          </p>
          {!customerCancelBlocker(order) && <p className="text-sm text-ink-500">You can still cancel it from the order page.</p>}
          <Link href={back}>
            <Button variant="outline" size="sm">
              Back to order
            </Button>
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-line-subtle bg-surface p-4 sm:p-6">
          <ChangeOrderForm flow={flow} audience="customer" paymentMethod={order.paymentMethod} onCancel={() => router.push(back)} idPrefix="my-change" />
        </div>
      )}
    </div>
  );
}
