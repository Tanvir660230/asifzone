"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search, Trash2 } from "lucide-react";
import type { FeedbackStatusFilter } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { Pagination } from "@/components/admin/pagination";
import * as adminFeedbackApi from "@/lib/api/admin-feedback";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";

const PAGE_SIZE = 20;

const STATUS_TABS: { value: FeedbackStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
];

export default function AdminFeedbackPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<FeedbackStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-feedback", { page, pageSize, status, search }],
    queryFn: () => adminFeedbackApi.listFeedback({ page, pageSize, status, search: search || undefined }),
  });

  const markReadMutation = useMutation({
    mutationFn: adminFeedbackApi.markFeedbackRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-feedback"] }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update feedback"),
  });

  const deleteMutation = useMutation({
    mutationFn: adminFeedbackApi.deleteFeedback,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-feedback"] });
      toast.success("Feedback deleted");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to delete feedback"),
  });

  async function handleDelete(id: string, subject: string) {
    if (!(await confirm(`Delete the feedback "${subject}"? This can't be undone.`))) return;
    deleteMutation.mutate(id);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Feedback" description="Messages submitted from the storefront contact widget." />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-full border border-ink-200 p-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => {
                  setStatus(tab.value);
                  setPage(1);
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-sm transition-colors duration-150 ease-smooth",
                  status === tab.value ? "bg-ink-900 text-cream-50" : "text-ink-600 hover:bg-ink-50",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Search size={16} className="shrink-0 text-ink-400" />
            <Input
              placeholder="Search name, email, subject…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full sm:w-64"
            />
          </div>
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
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={6} cols={6} />}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-400">
                    No feedback yet.
                  </td>
                </tr>
              )}
              {data?.items.map((f) => (
                <tr key={f.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                  <td className="px-4 py-3 font-medium">
                    {f.name}
                    {(f.email || f.phone) && (
                      <div className="text-xs font-normal text-ink-400">{[f.email, f.phone].filter(Boolean).join(" · ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{f.subject}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-ink-500" title={f.message}>
                    {f.message}
                  </td>
                  <td className="px-4 py-3 text-ink-500">{new Date(f.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <Badge className={f.readAt ? "" : "bg-sale-50 text-sale-600"}>{f.readAt ? "Read" : "Unread"}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      {!f.readAt && (
                        <button
                          onClick={() => markReadMutation.mutate(f.id)}
                          className="text-ink-400 hover:text-ink-900"
                          aria-label="Mark as read"
                          title="Mark as read"
                        >
                          <Check size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(f.id, f.subject)}
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
