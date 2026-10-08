"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AccountTitle } from "@/components/account/account-ui";
import { AccountPageSkeleton } from "@/components/account/account-skeleton";
import { ErrorState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { RETURN_STATUS_LABEL } from "@/lib/account";
import { AccountEmptyState } from "@/components/account/account-empty-state";
import { listMyReturnRequests } from "@/lib/api/return-requests";
import { approvalStatusBadgeVariant, formatStoreDate, orderStatusLabel } from "@/lib/format";

export default function AccountReturnsPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["my-return-requests"], queryFn: () => listMyReturnRequests() });

  return (
    <div>
      <AccountTitle title="Returns" description="Returns and exchanges you've asked for, and what happened with each." />

      {isLoading ? (
        <AccountPageSkeleton header={false} />
      ) : isError ? (
        <ErrorState variant="bordered" title="Your returns didn't load" onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <AccountEmptyState
          icon={RotateCcw}
          title="No returns or exchanges"
          description="To return or exchange something, open the order and choose Return or exchange."
          action={
            <Link href="/account/orders" className={buttonVariants({ size: "sm", variant: "outline" })}>
              Go to orders
            </Link>
          }
        />
      ) : (
        <ul className="space-y-4">
          {data.items.map((request) => (
            <li key={request.id} className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-fg">
                    {request.type === "EXCHANGE" ? "Exchange" : "Return"}
                    {request.order && (
                      <>
                        {" for "}
                        <Link href={`/account/orders/${request.orderId}`} className="underline underline-offset-2 hover:text-ink-700">
                          {request.order.orderNumber}
                        </Link>
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-fg-muted">Requested {formatStoreDate(request.createdAt, { day: "numeric", month: "long", year: "numeric" })}</p>
                </div>
                <Badge variant={approvalStatusBadgeVariant(request.status)} dot>
                  {RETURN_STATUS_LABEL[request.status] ?? request.status}
                </Badge>
              </div>

              <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-line-subtle pt-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
                {request.type === "EXCHANGE" && request.originalSizeSnapshot && (
                  <>
                    <dt className="text-fg-muted">Swap</dt>
                    <dd className="text-fg">
                      {request.originalSizeSnapshot}/{request.originalColorSnapshot} to {request.requestedSizeSnapshot}/{request.requestedColorSnapshot}
                    </dd>
                  </>
                )}
                <dt className="text-fg-muted">Reason</dt>
                <dd className="text-fg">
                  {request.reason}
                  {request.note && <span className="block text-fg-muted">{request.note}</span>}
                </dd>
                {request.status === "APPROVED" && request.type === "RETURN" && request.order && (
                  <>
                    <dt className="text-fg-muted">Refund</dt>
                    <dd className="text-fg">{orderStatusLabel(request.order.status)}</dd>
                  </>
                )}
                {request.status === "APPROVED" && request.type === "EXCHANGE" && (
                  <>
                    <dt className="text-fg-muted">Replacement</dt>
                    <dd className="text-fg">
                      {request.exchangeOrder ? (
                        <Link href={`/account/orders/${request.exchangeOrder.id}`} className="underline underline-offset-2 hover:text-ink-700">
                          Order {request.exchangeOrder.orderNumber}
                        </Link>
                      ) : (
                        "Being set up"
                      )}
                    </dd>
                  </>
                )}
                {request.adminNote && (
                  <>
                    <dt className="text-fg-muted">From our team</dt>
                    <dd className="text-fg">{request.adminNote}</dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
