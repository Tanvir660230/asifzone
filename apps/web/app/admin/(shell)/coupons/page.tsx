"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, RotateCcw, ArchiveX, Pencil, Copy, CopyPlus, TicketPercent } from "lucide-react";
import type { Coupon, CreateCouponInput } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/tabs";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { DataTable, type DataTableColumn, type DataTableRowAction } from "@/components/admin/data-table";
import { CouponForm } from "@/components/admin/coupon-form";
import * as couponsApi from "@/lib/api/admin-coupons";
import { formatPrice, formatStoreDate } from "@/lib/format";
import { ApiError } from "@/lib/api-client";
import { adminCan } from "@/lib/auth";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { cn } from "@/lib/utils";

function statusOf(c: Coupon): { label: string; variant: "neutral" | "success" | "info" | "warning" | "danger" | "accent" } {
  if (!c.isActive) return { label: "Inactive", variant: "neutral" };
  const now = Date.now();
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return { label: "Scheduled", variant: "info" };
  if (c.expiresAt && new Date(c.expiresAt).getTime() < now) return { label: "Expired", variant: "neutral" };
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return { label: "Exhausted", variant: "danger" };
  return { label: "Active", variant: "success" };
}

function discountLabel(c: Coupon): string {
  if (c.type === "FREE_SHIPPING") return "Free shipping";
  if (c.type === "PERCENTAGE") return `${c.value}%`;
  return formatPrice(c.value ?? 0);
}

function targetLabel(c: Coupon): string {
  if (c.scope === "SPECIFIC_PRODUCTS") return `${c.products.length} product${c.products.length === 1 ? "" : "s"}`;
  if (c.scope === "SPECIFIC_CATEGORIES") return `${c.categories.length} categor${c.categories.length === 1 ? "y" : "ies"}`;
  return "All products";
}

function UsageCell({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) return <span className="text-ink-500">{used}</span>;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const barColor = pct >= 100 ? "bg-danger-500" : pct >= 75 ? "bg-brass-500" : "bg-success-500";
  return (
    <div className="w-24">
      <span className="text-xs text-ink-500">
        {used}/{limit}
      </span>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
        <div className={cn("h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

type FormMode = "create" | "edit";

export default function CouponsPage() {
  const queryClient = useQueryClient();
  const { data: currentAdmin } = useCurrentAdmin();
  const canPurge = adminCan(currentAdmin?.admin, "promotions.purge"); // PD-10.1: permanent delete is OWNER-only
  const [tab, setTab] = useState<"active" | "trash">("active");
  const { data, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["admin-coupons", tab],
    queryFn: () => couponsApi.listCoupons({ trashed: tab === "trash" }),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formSeed, setFormSeed] = useState<Coupon | null>(null);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
  }

  const createMutation = useMutation({
    mutationFn: couponsApi.createCoupon,
    onSuccess: () => {
      invalidateAll();
      toast.success("Coupon created");
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateCouponInput }) => couponsApi.updateCoupon(id, input),
    onSuccess: () => {
      invalidateAll();
      toast.success("Coupon updated");
    },
  });
  const deleteMutation = useMutation({
    mutationFn: couponsApi.deleteCoupon,
    onSuccess: () => {
      invalidateAll();
      toast.success("Moved to Trash");
    },
  });
  const restoreMutation = useMutation({
    mutationFn: couponsApi.restoreCoupon,
    onSuccess: () => {
      invalidateAll();
      toast.success("Coupon restored");
    },
  });
  const permanentDeleteMutation = useMutation({
    mutationFn: couponsApi.permanentlyDeleteCoupon,
    onSuccess: () => {
      invalidateAll();
      toast.success("Coupon permanently deleted");
    },
  });
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  function openCreate() {
    setFormMode("create");
    setEditingId(null);
    setFormSeed(null);
    setFormOpen(true);
  }

  function openEdit(coupon: Coupon) {
    setFormMode("edit");
    setEditingId(coupon.id);
    setFormSeed(coupon);
    setFormOpen(true);
  }

  function openDuplicate(coupon: Coupon) {
    setFormMode("create");
    setEditingId(null);
    setFormSeed({ ...coupon, code: `${coupon.code}-COPY`, usedCount: 0 });
    setFormOpen(true);
  }

  async function handleFormSubmit(values: CreateCouponInput) {
    if (formMode === "edit" && editingId) {
      await updateMutation.mutateAsync({ id: editingId, input: values });
    } else {
      await createMutation.mutateAsync(values);
    }
    setFormOpen(false);
  }

  async function handleCopyCode(code: string) {
    await navigator.clipboard.writeText(code);
    toast.success(`Copied "${code}"`);
  }

  async function handleDelete(coupon: Coupon) {
    if (!(await confirm(`Move coupon "${coupon.code}" to Trash?`))) return;
    await deleteMutation.mutateAsync(coupon.id);
  }

  async function handlePermanentDelete(coupon: Coupon) {
    if (!(await confirm(`Permanently delete coupon "${coupon.code}"? This cannot be undone.`))) return;
    try {
      await permanentDeleteMutation.mutateAsync(coupon.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to permanently delete coupon");
    }
  }

  const columns: DataTableColumn<Coupon>[] = [
    {
      id: "code",
      header: "Code",
      card: "title",
      // plain text: on a phone the whole card is a button, so the copy action lives in the row menu
      cell: (c) => <span className="font-medium text-ink-900">{c.code}</span>,
    },
    { id: "discount", header: "Discount", cell: (c) => discountLabel(c) },
    { id: "target", header: "Applies to", cell: (c) => <span className="text-ink-500">{targetLabel(c)}</span> },
    { id: "usage", header: "Usage", cell: (c) => <UsageCell used={c.usedCount} limit={c.usageLimit} /> },
    { id: "expires", header: "Expires", cell: (c) => <span className="text-ink-500">{c.expiresAt ? formatStoreDate(c.expiresAt) : "—"}</span> },
    {
      id: "status",
      header: "Status",
      cell: (c) => {
        const status = statusOf(c);
        return <Badge variant={status.variant}>{status.label}</Badge>;
      },
    },
  ];
  const rowActions = (c: Coupon): DataTableRowAction<Coupon>[] =>
    tab === "trash"
      ? [
          { label: "Restore", icon: RotateCcw, onSelect: () => restoreMutation.mutate(c.id) },
          ...(canPurge ? [{ label: "Delete permanently", icon: Trash2, destructive: true, onSelect: () => void handlePermanentDelete(c) }] : []),
        ]
      : [
          { label: "Copy code", icon: Copy, onSelect: () => void handleCopyCode(c.code) },
          { label: "Edit", icon: Pencil, onSelect: () => openEdit(c) },
          { label: "Duplicate", icon: CopyPlus, onSelect: () => openDuplicate(c) },
          { label: "Move to trash", icon: Trash2, destructive: true, onSelect: () => void handleDelete(c) },
        ];

  return (
    <div>
      <PageHeader
        title="Coupons"
        action={
          tab === "active" && (
            <Button variant="brass" onClick={openCreate}>
              <Plus size={16} /> Add coupon
            </Button>
          )
        }
      />

      <ModuleTabs />

      <div className="mb-4">
        <SegmentedControl
          aria-label="Coupons or Trash"
          value={tab}
          onChange={setTab}
          options={[
            { value: "active", label: "Coupons" },
            { value: "trash", label: "Trash" },
          ]}
        />
      </div>

      <DataTable<Coupon>
        caption="Coupons"
        columns={columns}
        rows={isLoading ? undefined : data?.items}
        getRowId={(row) => row.id}
        loading={isLoading}
        error={loadError}
        onRetry={() => void refetch()}
        empty={tab === "trash" ? (
            <EmptyState icon={ArchiveX} title="Trash is empty" variant="bordered" />
          ) : (
            <EmptyState icon={TicketPercent} title="No coupons yet" description="A coupon gives a discount or free delivery when a customer types its code." variant="bordered" />
          )}
        density="dense"
        onRowOpen={tab === "trash" ? undefined : openEdit}
        rowActions={rowActions}
      />

      <CouponForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={formMode === "edit" ? "Edit coupon" : "Add coupon"}
        submitLabel={formMode === "edit" ? "Save changes" : "Create coupon"}
        seed={formSeed}
        onSubmit={handleFormSubmit}
      />
      {confirmDialog}
    </div>
  );
}
