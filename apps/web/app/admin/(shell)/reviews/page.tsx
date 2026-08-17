"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, X } from "lucide-react";
import type { ReviewStatus } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { Pagination } from "@/components/admin/pagination";
import { StarRating } from "@/components/storefront/star-rating";
import { cn } from "@/lib/utils";
import * as adminReviewsApi from "@/lib/api/admin-reviews";
import { ApiError } from "@/lib/api-client";

const PAGE_SIZE = 20;

const STATUS_BADGE: Record<ReviewStatus, string> = {
  PENDING: "",
  APPROVED: "bg-success-100 text-success-700",
  REJECTED: "bg-danger-100 text-danger-700",
};

const TABS: Array<{ label: string; value: ReviewStatus | "ALL" }> = [
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Rejected", value: "REJECTED" },
  { label: "All", value: "ALL" },
];

export default function AdminReviewsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ReviewStatus | "ALL">("PENDING");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-reviews", tab, page, pageSize],
    queryFn: () => adminReviewsApi.listReviewsAdmin({ status: tab === "ALL" ? undefined : tab, page, pageSize }),
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  const moderateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) =>
      adminReviewsApi.moderateReview(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
      toast.success("Review updated");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update review"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminReviewsApi.deleteReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
      toast.success("Review deleted");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to delete review"),
  });

  async function handleApprove(id: string) {
    moderateMutation.mutate({ id, status: "APPROVED" });
  }

  async function handleReject(id: string) {
    moderateMutation.mutate({ id, status: "REJECTED" });
  }

  async function handleDelete(id: string) {
    if (!(await confirm("Permanently delete this review? This can't be undone."))) return;
    deleteMutation.mutate(id);
  }

  return (
    <div>
      <PageHeader title="Reviews" description="Moderate customer product reviews before they go live." />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-ink-100">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => {
                setTab(t.value);
                setPage(1);
              }}
              className={cn(
                "border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-150 ease-smooth",
                tab === t.value ? "border-ink-900 text-ink-900" : "border-transparent text-ink-400 hover:text-ink-700",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <PageSizeSelect
          value={pageSize}
          onChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <HScrollShadow className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Rating</th>
                <th className="px-4 py-3">Review</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={5} cols={7} />}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-400">
                    No reviews here.
                  </td>
                </tr>
              )}
              {data?.items.map((review) => (
                <tr key={review.id} className="border-t border-ink-100 align-top transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                  <td className="px-4 py-3 font-medium">{review.product?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-500">
                    {review.customerName}
                    {review.isVerifiedPurchase && <div className="text-xs text-brass-600">Verified purchase</div>}
                  </td>
                  <td className="px-4 py-3">
                    <StarRating value={review.rating} />
                  </td>
                  <td className="px-4 py-3 max-w-xs text-ink-500">
                    {review.title && <p className="font-medium text-ink-700">{review.title}</p>}
                    <p className="line-clamp-3">{review.body}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-ink-500">{new Date(review.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <Badge className={STATUS_BADGE[review.status]}>{review.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      {review.status !== "APPROVED" && (
                        <button
                          onClick={() => handleApprove(review.id)}
                          className="text-ink-400 hover:text-success-600"
                          aria-label="Approve"
                          title="Approve"
                        >
                          <Check size={16} />
                        </button>
                      )}
                      {review.status !== "REJECTED" && (
                        <button
                          onClick={() => handleReject(review.id)}
                          className="text-ink-400 hover:text-danger-600"
                          aria-label="Reject"
                          title="Reject"
                        >
                          <X size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(review.id)}
                        className="text-ink-400 hover:text-danger-600"
                        aria-label="Delete"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScrollShadow>
      </div>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      {confirmDialog}
    </div>
  );
}
