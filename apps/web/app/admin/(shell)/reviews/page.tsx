"use client";

import { useState } from "react";
import { attentionKeys } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquareText, Trash2, X } from "lucide-react";
import type { ProductReview, ReviewStatus } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { DataTable, type DataTableColumn, type DataTableRowAction } from "@/components/admin/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { StarRating } from "@/components/storefront/star-rating";
import { ReviewPhotoStrip } from "@/components/storefront/review-photos";
import { cn } from "@/lib/utils";
import * as adminReviewsApi from "@/lib/api/admin-reviews";
import { ApiError } from "@/lib/api-client";
import { formatStoreDate, approvalStatusBadgeVariant } from "@/lib/format";

const PAGE_SIZE = 20;

const TABS: Array<{ label: string; value: ReviewStatus | "ALL" }> = [
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Rejected", value: "REJECTED" },
  { label: "All", value: "ALL" },
];

type Review = ProductReview;

export default function AdminReviewsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ReviewStatus | "ALL">("PENDING");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const { data, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["admin-reviews", tab, page, pageSize],
    queryFn: () => adminReviewsApi.listReviewsAdmin({ status: tab === "ALL" ? undefined : tab, page, pageSize }),
  });

  const moderateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) =>
      adminReviewsApi.moderateReview(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
      queryClient.invalidateQueries({ queryKey: attentionKeys.all });
      toast.success("Review updated");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update review"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminReviewsApi.deleteReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
      queryClient.invalidateQueries({ queryKey: attentionKeys.all });
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

  const columns: DataTableColumn<Review>[] = [
    { id: "product", header: "Product", card: "title", className: "w-48", cell: (r) => <span className="font-medium text-ink-900">{r.product?.name ?? "—"}</span> },
    {
      id: "customer",
      header: "Customer",
      cell: (r) => (
        <div className="text-ink-600">
          {r.customerName}
          {r.isVerifiedPurchase && <div className="text-xs text-brass-600">Verified purchase</div>}
        </div>
      ),
    },
    { id: "rating", header: "Rating", cell: (r) => <StarRating value={r.rating} /> },
    {
      id: "review",
      header: "Review",
      className: "min-w-[18rem]",
      cell: (r) => (
        <div className="max-w-md text-ink-500">
          {r.title && <p className="font-medium text-ink-700">{r.title}</p>}
          <p className="line-clamp-2">{r.body}</p>
          {/* Customer photos: checked here before approval, since approving publishes them too. */}
          <ReviewPhotoStrip images={r.images ?? []} author={r.customerName} />
        </div>
      ),
    },
    { id: "date", header: "Date", cell: (r) => <span className="whitespace-nowrap text-ink-500">{formatStoreDate(r.createdAt)}</span> },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <Badge variant={approvalStatusBadgeVariant(r.status)} dot>
          {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
        </Badge>
      ),
    },
  ];
  const rowActions = (r: Review): DataTableRowAction<Review>[] => [
    ...(r.status !== "APPROVED" ? [{ label: "Approve", icon: Check, onSelect: () => void handleApprove(r.id) }] : []),
    ...(r.status !== "REJECTED" ? [{ label: "Reject", icon: X, onSelect: () => void handleReject(r.id) }] : []),
    { label: "Delete", icon: Trash2, destructive: true, onSelect: () => void handleDelete(r.id) },
  ];

  return (
    <div>
      <PageHeader title="Reviews" description="Moderate customer product reviews before they go live." />

      <ModuleTabs />

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

      <DataTable<Review>
        caption="Reviews"
        columns={columns}
        rows={isLoading ? undefined : data?.items}
        getRowId={(row) => row.id}
        loading={isLoading}
        error={loadError}
        onRetry={() => void refetch()}
        empty={<EmptyState icon={MessageSquareText} title={tab === "PENDING" ? "Nothing waiting for review" : "No reviews here"} variant="bordered" />}
        page={page}
        pageSize={pageSize}
        total={data?.total}
        onPageChange={setPage}
        rowActions={rowActions}
      />
      {confirmDialog}
    </div>
  );
}
