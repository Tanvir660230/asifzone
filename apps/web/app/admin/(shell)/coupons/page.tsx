"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, RotateCcw, ArchiveX, Pencil, Copy, CopyPlus } from "lucide-react";
import type { Coupon, CreateCouponInput } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { PromotionsSubNav } from "@/components/admin/promotions-subnav";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { CouponForm } from "@/components/admin/coupon-form";
import * as couponsApi from "@/lib/api/admin-coupons";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

function statusOf(c: Coupon): { label: string; className: string } {
  if (!c.isActive) return { label: "Inactive", className: "bg-ink-200 text-ink-700" };
  const now = Date.now();
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return { label: "Scheduled", className: "bg-info-100 text-info-700" };
  if (c.expiresAt && new Date(c.expiresAt).getTime() < now) return { label: "Expired", className: "bg-ink-200 text-ink-700" };
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return { label: "Exhausted", className: "bg-danger-100 text-danger-700" };
  return { label: "Active", className: "bg-success-100 text-success-700" };
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
  const [tab, setTab] = useState<"active" | "trash">("active");
  const { data, isLoading } = useQuery({
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

      <PromotionsSubNav />

      <div className="mb-4 flex items-center gap-1 border-b border-ink-100">
        {(["active", "trash"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors",
              tab === t ? "border-ink-900 text-ink-900" : "border-transparent text-ink-400 hover:text-ink-600",
            )}
          >
            {t === "trash" ? "Trash" : "Active"}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <HScrollShadow className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Applies to</th>
                <th className="px-4 py-3">Usage</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={5} cols={7} />}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-400">
                    {tab === "trash" ? (
                      <span className="flex flex-col items-center gap-2">
                        <ArchiveX size={24} className="text-ink-300" />
                        Trash is empty.
                      </span>
                    ) : (
                      "No coupons yet."
                    )}
                  </td>
                </tr>
              )}
              {data?.items.map((c) => {
                const status = statusOf(c);
                return (
                  <tr key={c.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                    <td className="px-4 py-3 font-medium">
                      <button
                        onClick={() => handleCopyCode(c.code)}
                        className="inline-flex items-center gap-1.5 hover:text-brass-600"
                        title="Copy code"
                      >
                        {c.code}
                        <Copy size={12} className="text-ink-300" />
                      </button>
                    </td>
                    <td className="px-4 py-3">{discountLabel(c)}</td>
                    <td className="px-4 py-3 text-ink-500">{targetLabel(c)}</td>
                    <td className="px-4 py-3">
                      <UsageCell used={c.usedCount} limit={c.usageLimit} />
                    </td>
                    <td className="px-4 py-3 text-ink-500">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3">
                      <Badge className={status.className}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-3">
                        {tab === "trash" ? (
                          <>
                            <button
                              onClick={() => restoreMutation.mutate(c.id)}
                              className="text-ink-500 hover:text-ink-900"
                              aria-label="Restore"
                              title="Restore"
                            >
                              <RotateCcw size={16} />
                            </button>
                            <button
                              onClick={() => handlePermanentDelete(c)}
                              className="text-ink-500 hover:text-danger-600"
                              aria-label="Delete permanently"
                              title="Delete permanently"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => openEdit(c)} className="text-ink-400 hover:text-ink-900" aria-label="Edit" title="Edit">
                              <Pencil size={16} />
                            </button>
                            <button
                              onClick={() => openDuplicate(c)}
                              className="text-ink-400 hover:text-ink-900"
                              aria-label="Duplicate"
                              title="Duplicate"
                            >
                              <CopyPlus size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(c)}
                              className="text-ink-400 hover:text-danger-600"
                              aria-label="Move to trash"
                              title="Move to trash"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </HScrollShadow>
      </div>

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
