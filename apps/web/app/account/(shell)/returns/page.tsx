"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { listMyReturnRequests } from "@/lib/api/return-requests";

export default function AccountReturnsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["my-return-requests"], queryFn: () => listMyReturnRequests() });

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-ink-900">Returns &amp; Refunds</h1>

      {isLoading && <p className="text-ink-400">Loading…</p>}
      {!isLoading && data?.items.length === 0 && <p className="text-ink-400">No return requests yet.</p>}

      <div className="space-y-3">
        {data?.items.map((request) => (
          <div key={request.id} className="border border-ink-100 p-4 text-sm">
            <div className="flex items-center justify-between">
              {request.order ? (
                <Link href={`/account/orders/${request.orderId}`} className="font-medium text-ink-900 hover:text-brass-600">
                  {request.order.orderNumber}
                </Link>
              ) : (
                <span className="font-medium text-ink-900">Order</span>
              )}
              <Badge className={request.status === "APPROVED" ? "bg-success-100 text-success-700" : request.status === "REJECTED" ? "bg-danger-100 text-danger-700" : ""}>
                {request.status}
              </Badge>
            </div>
            <p className="mt-1 text-ink-600">Reason: {request.reason}</p>
            {request.note && <p className="text-ink-500">{request.note}</p>}
            {request.status === "APPROVED" && request.order && (
              <p className="mt-1 text-ink-500">Refund status: {request.order.status}</p>
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
