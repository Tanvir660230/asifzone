"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { AccountEmptyState } from "@/components/account/account-empty-state";
import { listMyReturnRequests } from "@/lib/api/return-requests";

export default function AccountReturnsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["my-return-requests"], queryFn: () => listMyReturnRequests() });

  return (
    <div>
      <AccountPageHeader title="Returns & Refunds" description="Requests you've submitted for returns and exchanges." />

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="animate-pulse rounded-lg border border-ink-100 p-4">
              <div className="flex items-center justify-between">
                <div className="h-3.5 w-24 rounded bg-ink-100" />
                <div className="h-4 w-16 rounded-full bg-ink-100" />
              </div>
              <div className="mt-2 h-3 w-40 rounded bg-ink-100" />
            </div>
          ))}
        </div>
      )}
      {!isLoading && data?.items.length === 0 && (
        <AccountEmptyState
          icon={RotateCcw}
          title="No return requests yet"
          description="Returns and exchanges you request from an order will appear here."
        />
      )}

      <div className="space-y-3">
        {data?.items.map((request) => (
          <div key={request.id} className="rounded-lg border border-ink-100 p-4 text-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {request.order ? (
                  <Link href={`/account/orders/${request.orderId}`} className="font-medium text-ink-900 hover:text-brass-600">
                    {request.order.orderNumber}
                  </Link>
                ) : (
                  <span className="font-medium text-ink-900">Order</span>
                )}
                <span className="text-xs text-ink-400">{request.type === "EXCHANGE" ? "Exchange" : "Return"}</span>
              </div>
              <Badge className={request.status === "APPROVED" ? "bg-success-100 text-success-700" : request.status === "REJECTED" ? "bg-danger-100 text-danger-700" : ""}>
                {request.status}
              </Badge>
            </div>
            {request.type === "EXCHANGE" && request.originalSizeSnapshot && (
              <p className="mt-1 text-ink-600">
                {request.originalSizeSnapshot}/{request.originalColorSnapshot} → {request.requestedSizeSnapshot}/
                {request.requestedColorSnapshot}
              </p>
            )}
            <p className="mt-1 text-ink-600">Reason: {request.reason}</p>
            {request.note && <p className="text-ink-500">{request.note}</p>}
            {request.status === "APPROVED" && request.type === "RETURN" && request.order && (
              <p className="mt-1 text-ink-500">Refund status: {request.order.status}</p>
            )}
            {request.status === "APPROVED" && request.type === "EXCHANGE" && (
              <p className="mt-1 text-ink-500">
                {request.exchangeOrder ? (
                  <>
                    Replacement order:{" "}
                    <Link href={`/account/orders/${request.exchangeOrder.id}`} className="text-brass-600 hover:underline">
                      {request.exchangeOrder.orderNumber}
                    </Link>
                  </>
                ) : (
                  "Your replacement order is being set up."
                )}
              </p>
            )}
            {request.status === "REJECTED" && request.adminNote && (
              <p className="mt-1 text-ink-500">Note from support: {request.adminNote}</p>
            )}
            <p className="mt-2 text-xs text-ink-400">Requested {new Date(request.createdAt).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
