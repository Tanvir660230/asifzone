"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PackageOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { DataTable } from "@/components/admin/data-table";
import type { DataTableColumn } from "@/components/admin/data-table/types";
import { EmptyState } from "@/components/admin/empty-state";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import type { ParcelToReceive } from "@/lib/api/admin-orders";
import { formatStoreDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Parcels to receive (blueprint P1.5, under today's rule): orders cancelled after they shipped whose units are still out
 * with the courier. Their stock comes back only when someone receives the parcel on the order (good, damaged or lost) —
 * never at the cancellation. One past the store's follow-up days (owner decision Q-B; 14 by default) is marked overdue.
 */
export function ParcelsToReceive() {
  const q = useQuery({ queryKey: ["orders", "parcels-to-receive"], queryFn: adminOrdersApi.listParcelsToReceive });
  const columns: DataTableColumn<ParcelToReceive>[] = [
    {
      id: "order",
      header: "Order",
      card: "title",
      cell: (p) => (
        <span className="block min-w-0">
          <Link href={`/admin/orders/${p.orderId}`} className="font-medium text-fg hover:text-accent hover:underline">{p.orderNumber}</Link>
          <span className="block truncate text-xs text-fg-muted">{p.customerName} · {p.customerPhone}</span>
        </span>
      ),
    },
    { id: "tracking", header: "Tracking", cell: (p) => <span className="font-mono text-xs text-fg-muted">{p.trackingNumber ?? "—"}</span> },
    { id: "units", header: "Units out", align: "right", cell: (p) => <span className="tabular-nums">{p.units}</span> },
    { id: "value", header: "Value", align: "right", cell: (p) => <Money value={p.value} /> },
    {
      id: "out",
      header: "Out since",
      label: "Out since",
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-fg">{p.cancelledAt ? formatStoreDate(p.cancelledAt, { day: "numeric", month: "short" }) : "—"}</span>
          {p.daysOut !== null && <Badge variant={p.overdue ? "warning" : "neutral"}>{p.daysOut} day{p.daysOut === 1 ? "" : "s"}</Badge>}
        </span>
      ),
    },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      label: "Action",
      hideable: false,
      align: "right",
      cell: (p) => <Link href={`/admin/orders/${p.orderId}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Receive parcel</Link>,
    },
  ];
  return (
    <div className="space-y-3">
      {q.data && q.data.overdue > 0 && (
        <p className="text-sm text-warning-700" data-testid="parcels-overdue">
          {q.data.overdue} parcel{q.data.overdue === 1 ? " has" : "s have"} been out more than {q.data.followUpDays} days — chase the courier, or record them as lost when you receive the order.
        </p>
      )}
      <DataTable
        caption="Parcels to receive"
        columns={columns}
        rows={q.data?.parcels}
        getRowId={(p) => p.orderId}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        cardBelow="md"
        empty={<EmptyState icon={PackageOpen} title="No parcels on their way back" description="An order cancelled after it shipped shows here until its parcel is received." />}
      />
    </div>
  );
}
