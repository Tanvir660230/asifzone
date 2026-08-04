"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { OrderStatus } from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { formatPrice } from "@/lib/format";

const PAGE_SIZE = 20;
const STATUS_OPTIONS: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
];

const STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING: "bg-warning-100 text-warning-700",
  CONFIRMED: "bg-info-100 text-info-700",
  PROCESSING: "bg-info-100 text-info-700",
  SHIPPED: "bg-info-100 text-info-700",
  DELIVERED: "bg-success-100 text-success-700",
  CANCELLED: "bg-danger-100 text-danger-700",
  REFUNDED: "bg-ink-200 text-ink-700",
};

export default function OrdersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-orders", { page, pageSize, search, status }],
    queryFn: () =>
      adminOrdersApi.listOrders({
        page,
        pageSize,
        search: search || undefined,
        status: status || undefined,
      }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Orders" />

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-ink-400" />
            <Input
              placeholder="Search order #, name, phone…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-64"
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
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Placed</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={6} cols={6} />}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-400">
                  No orders yet.
                </td>
              </tr>
            )}
            {data?.items.map((order) => (
              <tr key={order.id} className="border-t border-ink-100 hover:bg-ink-50">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm text-ink-500">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
