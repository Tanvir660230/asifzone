"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import type { ReturnRequestStatus } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import * as returnRequestsApi from "@/lib/api/admin-return-requests";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

const STATUS_BADGE: Record<ReturnRequestStatus, string> = {
  PENDING: "",
  APPROVED: "bg-success-100 text-success-700",
  REJECTED: "bg-danger-100 text-danger-700",
};

export default function AdminReturnRequestsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-return-requests"], queryFn: () => returnRequestsApi.listReturnRequests() });
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) =>
      returnRequestsApi.reviewReturnRequest(id, { status, adminNote: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-return-requests"] });
      toast.success("Return request updated");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update return request"),
  });

  async function handleApprove(id: string, orderNumber: string) {
    if (!(await confirm(`Approve the return for order ${orderNumber}? This marks the order as Returned.`))) return;
    reviewMutation.mutate({ id, status: "APPROVED" });
  }

  async function handleReject(id: string, orderNumber: string) {
    if (!(await confirm(`Reject the return request for order ${orderNumber}?`))) return;
    reviewMutation.mutate({ id, status: "REJECTED" });
  }

  return (
    <div>
      <PageHeader title="Return Requests" />

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <HScrollShadow className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={5} cols={6} />}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-400">
                    No return requests yet.
                  </td>
                </tr>
              )}
              {data?.items.map((r) => (
                <tr key={r.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                  <td className="px-4 py-3 font-medium">
                    {r.order?.orderNumber ?? "—"}
                    {r.order && <div className="text-xs text-ink-400">{formatPrice(r.order.total)}</div>}
                  </td>
                  <td className="px-4 py-3 text-ink-500">
                    {r.customer?.name}
                    <div className="text-xs text-ink-400">{r.customer?.email}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-500">
                    {r.reason}
                    {r.note && <div className="text-xs text-ink-400">{r.note}</div>}
                  </td>
                  <td className="px-4 py-3 text-ink-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <Badge className={STATUS_BADGE[r.status]}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {r.status === "PENDING" && r.order && (
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => handleApprove(r.id, r.order!.orderNumber)}
                          className="text-ink-400 hover:text-success-600"
                          aria-label="Approve"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={() => handleReject(r.id, r.order!.orderNumber)}
                          className="text-ink-400 hover:text-danger-600"
                          aria-label="Reject"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScrollShadow>
      </div>
      {confirmDialog}
    </div>
  );
}
