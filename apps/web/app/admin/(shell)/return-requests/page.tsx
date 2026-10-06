"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RotateCcw, X } from "lucide-react";
import type { ReturnCompensation, ReturnRequest, ReturnRequestStatus } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedControl } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { TableSkeleton } from "@/components/ui/table";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { OrdersSubNav } from "@/components/admin/orders-subnav";
import { ExchangeReview } from "@/components/admin/orders/exchange-review";
import { invalidateOrderQueries, useOrderPermissions } from "@/components/admin/orders/order-domain";
import * as returnRequestsApi from "@/lib/api/admin-return-requests";
import { approvalStatusBadgeVariant, formatPrice, formatStoreDate, orderStatusLabel } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

const PAGE_SIZE = 20;
type StatusFilter = ReturnRequestStatus | "ALL";
const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "PENDING", label: "To review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ALL", label: "All" },
];

interface Review {
  request: ReturnRequest;
  decision: "APPROVED" | "REJECTED";
}

/** What approving does — performed by the server in one transaction (return-request.service reviewReturnRequest): a
 * return moves the order to RETURNED through the order state machine (restock, refund-due alert when paid); an exchange
 * restocks the original item, takes the requested variant and creates a replacement order priced by the D6 rule. */
function approvalEffects(r: ReturnRequest): string[] {
  if (r.type === "EXCHANGE") return [];
  return [
    "The order moves to Returned — its units go back into stock as a customer return.",
    "Loyalty points earned on the order are reversed.",
    "If the customer paid, a refund becomes due (record it on the order once sent).",
  ];
}

export default function AdminReturnRequestsPage() {
  const queryClient = useQueryClient();
  const perms = useOrderPermissions();
  const [status, setStatus] = useState<StatusFilter>("PENDING");
  const [page, setPage] = useState(1);
  const [review, setReview] = useState<Review | null>(null);
  const [note, setNote] = useState("");
  /** Exchange downgrade / approved return: where the money owed back goes (server default when not chosen). */
  const [compensation, setCompensation] = useState<ReturnCompensation | undefined>(undefined);
  const [exchangeReady, setExchangeReady] = useState(false);

  // ?status=PENDING|APPROVED|REJECTED|ALL deep link (e.g. from an order's "Review" link).
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s && STATUS_FILTERS.some((f) => f.value === s)) setStatus(s as StatusFilter);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-return-requests", { status, page }],
    queryFn: () => returnRequestsApi.listReturnRequests({ page, pageSize: PAGE_SIZE, status: status === "ALL" ? undefined : status }),
    placeholderData: (prev) => prev,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, decision, adminNote }: { id: string; decision: "APPROVED" | "REJECTED"; adminNote: string | null }) =>
      returnRequestsApi.reviewReturnRequest(id, { status: decision, adminNote, ...(decision === "APPROVED" && compensation ? { compensation } : {}) }),
    onSuccess: (_, { decision }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-return-requests"] });
      invalidateOrderQueries(queryClient, review?.request.orderId);
      setReview(null);
      toast.success(decision === "APPROVED" ? "Request approved" : "Request rejected");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update the request"),
  });

  function openReview(request: ReturnRequest, decision: Review["decision"]) {
    setNote("");
    setCompensation(undefined);
    setExchangeReady(false);
    setReview({ request, decision });
  }

  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const canReview = (r: ReturnRequest) => perms.returns && r.status === "PENDING" && Boolean(r.order);

  const actions = (r: ReturnRequest) =>
    canReview(r) ? (
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => openReview(r, "REJECTED")}>
          <X size={14} /> Reject
        </Button>
        <Button size="sm" onClick={() => openReview(r, "APPROVED")}>
          <Check size={14} /> Approve
        </Button>
      </div>
    ) : null;

  const orderLink = (r: ReturnRequest) =>
    r.order ? (
      <Link href={`/admin/orders/${r.order.id}`} className="font-medium text-ink-900 hover:text-info-700 hover:underline">
        {r.order.orderNumber}
      </Link>
    ) : (
      <span className="text-ink-400">—</span>
    );

  const typeCell = (r: ReturnRequest) => (
    <>
      {r.type === "EXCHANGE" ? "Exchange" : "Return"}
      {r.type === "EXCHANGE" && r.originalSizeSnapshot && (
        <span className="block text-xs text-ink-400">
          {r.originalSizeSnapshot}/{r.originalColorSnapshot} → {r.requestedSizeSnapshot}/{r.requestedColorSnapshot}
        </span>
      )}
      {r.exchangeOrder && (
        <Link href={`/admin/orders/${r.exchangeOrder.id}`} className="block text-xs text-info-700 hover:underline">
          Replacement {r.exchangeOrder.orderNumber}
        </Link>
      )}
    </>
  );

  const empty = (
    <EmptyState
      icon={RotateCcw}
      title={status === "PENDING" ? "Nothing to review" : "No requests here"}
      description={status === "PENDING" ? "New return and exchange requests from customers appear here." : "Try another filter."}
    />
  );

  return (
    <div>
      <PageHeader title="Return Requests" description="Review customer returns and exchanges. Approving runs the return or exchange on the order." />
      <OrdersSubNav />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Filter by review status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={STATUS_FILTERS}
        />
        {data && <span className="text-xs tabular-nums text-ink-400">{data.total} request(s)</span>}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-line-subtle bg-surface shadow-sm md:block">
        <HScrollShadow className="overflow-x-auto" edgeFrom="from-surface">
          <table className="ui-table">
            <thead className="ui-table-head">
              <tr>
                <th scope="col" className="px-4 py-3">Order</th>
                <th scope="col" className="px-4 py-3">Customer</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Reason</th>
                <th scope="col" className="px-4 py-3">Requested</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={5} cols={7} />}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={7}>{empty}</td>
                </tr>
              )}
              {items.map((r) => (
                <tr key={r.id} className="ui-table-row">
                  <td className="px-4 py-3">
                    {orderLink(r)}
                    {r.order && (
                      <span className="block text-xs text-ink-400">
                        {formatPrice(r.order.total)} · {orderStatusLabel(r.order.status)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-600">
                    {r.customer?.name}
                    <span className="block text-xs text-ink-400">{r.customer?.email}</span>
                  </td>
                  <td className="px-4 py-3 text-ink-600">{typeCell(r)}</td>
                  <td className="max-w-xs px-4 py-3 text-ink-600">
                    {r.reason}
                    {r.note && <span className="block text-xs text-ink-400">{r.note}</span>}
                    {r.adminNote && <span className="block text-xs text-ink-500">Staff: {r.adminNote}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">{formatStoreDate(r.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={approvalStatusBadgeVariant(r.status)} dot>
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{actions(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScrollShadow>
      </div>

      <div className="space-y-3 md:hidden">
        {isLoading && Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-36 rounded-xl ui-skeleton" aria-hidden="true" />)}
        {!isLoading && items.length === 0 && <div className="rounded-xl border border-line-subtle bg-surface">{empty}</div>}
        {items.map((r) => (
          <article key={r.id} className="space-y-2 rounded-xl border border-line-subtle bg-surface p-3.5 text-sm shadow-sm" aria-label={`Request on ${r.order?.orderNumber ?? "order"}`}>
            <div className="flex items-center justify-between gap-2">
              {orderLink(r)}
              <Badge variant={approvalStatusBadgeVariant(r.status)} dot>
                {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
              </Badge>
            </div>
            <p className="text-ink-600">{typeCell(r)}</p>
            <p className="text-ink-700">{r.reason}</p>
            {r.note && <p className="text-xs text-ink-500">{r.note}</p>}
            {r.adminNote && <p className="text-xs text-ink-500">Staff: {r.adminNote}</p>}
            <p className="text-xs text-ink-400">
              {r.customer?.name} · {formatStoreDate(r.createdAt)}
            </p>
            {actions(r)}
          </article>
        ))}
      </div>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      <Modal
        open={Boolean(review)}
        onClose={() => setReview(null)}
        title={review ? `${review.decision === "APPROVED" ? "Approve" : "Reject"} ${review.request.type === "EXCHANGE" ? "exchange" : "return"} — ${review.request.order?.orderNumber ?? ""}` : ""}
        widthClassName={review?.decision === "APPROVED" && review.request.type === "EXCHANGE" ? "max-w-xl" : "max-w-md"}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button
              variant={review?.decision === "REJECTED" ? "destructive" : "primary"}
              size="sm"
              loading={reviewMutation.isPending}
              disabled={review?.decision === "APPROVED" && review.request.type === "EXCHANGE" && !exchangeReady}
              onClick={() => review && reviewMutation.mutate({ id: review.request.id, decision: review.decision, adminNote: note.trim() || null })}
            >
              {review?.decision === "APPROVED" ? "Approve" : "Reject"}
            </Button>
          </>
        }
      >
        {review && (
          <div className="space-y-4">
            <p className="text-sm text-ink-700">
              <span className="font-medium">Reason:</span> {review.request.reason}
              {review.request.note && <span className="block text-ink-500">{review.request.note}</span>}
            </p>
            {review.decision === "APPROVED" && review.request.type === "EXCHANGE" ? (
              <ExchangeReview request={review.request} compensation={compensation} onCompensation={setCompensation} onReady={setExchangeReady} />
            ) : review.decision === "APPROVED" ? (
              <div className="space-y-3">
              <div className="rounded-xl border border-line-subtle bg-surface-muted p-3.5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">What happens</p>
                <ul className="list-disc space-y-1 pl-4 text-sm text-ink-700">
                  {approvalEffects(review.request).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <label className="flex min-h-11 items-start gap-2.5 rounded-xl border border-line-subtle p-3 text-sm text-ink-700">
                <input type="checkbox" className="mt-1" checked={compensation === "STORE_CREDIT"} onChange={(e) => setCompensation(e.target.checked ? "STORE_CREDIT" : undefined)} />
                <span>
                  Give what was paid back as Store Balance now
                  <span className="block text-xs text-ink-500">Otherwise it stays as a refund due, to record once you&apos;ve sent the money.</span>
                </span>
              </label>
              </div>
            ) : (
              <p className="text-sm text-ink-600">The order is left unchanged. The customer can see the decision on their order.</p>
            )}
            <Field htmlFor="review-note" label="Note (optional)" hint="Saved on the request.">
              <Textarea id="review-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
