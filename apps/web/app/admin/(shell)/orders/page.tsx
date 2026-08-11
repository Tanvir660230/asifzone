"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, RotateCcw } from "lucide-react";
import type { OrderStatus } from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { Pagination } from "@/components/admin/pagination";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

const PAGE_SIZE = 20;
const STATUS_OPTIONS: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
];

const STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING: "bg-warning-100 text-warning-700",
  CONFIRMED: "bg-info-100 text-info-700",
  PROCESSING: "bg-info-100 text-info-700",
  PACKED: "bg-info-100 text-info-700",
  SHIPPED: "bg-info-100 text-info-700",
  DELIVERED: "bg-success-100 text-success-700",
  CANCELLED: "bg-danger-100 text-danger-700",
  RETURNED: "bg-warning-100 text-warning-700",
  REFUNDED: "bg-ink-200 text-ink-700",
};

export default function OrdersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showDeleted, setShowDeleted] = useState(false);
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";

  const { data, isLoading } = useQuery({
    queryKey: ["admin-orders", { page, pageSize, search, status, showDeleted }],
    queryFn: () =>
      adminOrdersApi.listOrders({
        page,
        pageSize,
        search: search || undefined,
        status: status || undefined,
        deleted: showDeleted,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: adminOrdersApi.deleteOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      toast.success("Order deleted");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to delete order"),
  });

  const restoreMutation = useMutation({
    mutationFn: adminOrdersApi.restoreOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      toast.success("Order restored");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to restore order"),
  });

  async function handleDelete(orderNumber: string, id: string) {
    if (!(await confirm(`Delete order ${orderNumber}? Stock will be restored — you can undo this from "Show deleted".`)))
      return;
    deleteMutation.mutate(id);
  }

  async function handleRestore(orderNumber: string, id: string) {
    if (!(await confirm(`Restore order ${orderNumber}?`))) return;
    restoreMutation.mutate(id);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Orders" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Search size={16} className="shrink-0 text-ink-400" />
            <Input
              placeholder="Search order #, name, phone…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full sm:w-64"
            />
          </div>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as OrderStatus | "");
              setPage(1);
            }}
            className="w-44"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          {isOwner && (
            <label className="flex items-center gap-2 text-sm text-ink-600">
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(e) => {
                  setShowDeleted(e.target.checked);
                  setPage(1);
                }}
              />
              Show deleted
            </label>
          )}
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
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Placed</th>
              {isOwner && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={6} cols={isOwner ? 7 : 6} />}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={isOwner ? 7 : 6} className="px-4 py-6 text-center text-ink-400">
                  {showDeleted ? "No deleted orders." : "No orders yet."}
                </td>
              </tr>
            )}
            {data?.items.map((order) => (
              <tr key={order.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                <td className="px-4 py-3">
                  <Link href={`/admin/orders/${order.id}`} className="text-brass-600 hover:underline">
                    {order.orderNumber}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div>{order.customerName}</div>
                  <div className="text-xs text-ink-400">{order.customerPhone}</div>
                </td>
                <td className="px-4 py-3">
                  {order.paymentMethod === "COD" ? "COD" : "Online"}
                  {order.paymentStatus === "PAID" && <span className="ml-1 text-xs text-success-600">(paid)</span>}
                </td>
                <td className="px-4 py-3">{formatPrice(order.total)}</td>
                <td className="px-4 py-3">
                  <Badge className={STATUS_COLORS[order.status]}>{order.status}</Badge>
                </td>
                <td className="px-4 py-3 text-ink-500">{new Date(order.createdAt).toLocaleDateString()}</td>
                {isOwner && (
                  <td className="px-4 py-3 text-right">
                    {order.deletedAt ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={restoreMutation.isPending}
                        onClick={() => handleRestore(order.orderNumber, order.id)}
                      >
                        <RotateCcw size={14} /> Restore
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={deleteMutation.isPending}
                        onClick={() => handleDelete(order.orderNumber, order.id)}
                      >
                        <Trash2 size={14} /> Delete
                      </Button>
                    )}
                  </td>
                )}
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
