"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { createCouponSchema, type Coupon, type CreateCouponInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import * as couponsApi from "@/lib/api/admin-coupons";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

export default function CouponsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-coupons"], queryFn: () => couponsApi.listCoupons() });
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: couponsApi.createCoupon,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-coupons"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: couponsApi.deleteCoupon,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      toast.success("Coupon deleted");
    },
  });
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCouponInput>({
    resolver: zodResolver(createCouponSchema),
    defaultValues: { type: "PERCENTAGE", isActive: true },
  });

  async function onSubmit(values: CreateCouponInput) {
    setError(null);
    try {
      await createMutation.mutateAsync(values);
      setShowCreate(false);
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create coupon");
    }
  }

  async function handleDelete(coupon: Coupon) {
    if (!(await confirm(`Delete coupon "${coupon.code}"?`))) return;
    await deleteMutation.mutateAsync(coupon.id);
  }

  return (
    <div>
      <PageHeader
        title="Coupons"
        action={
          <Button variant="brass" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Add coupon
          </Button>
        }
      />

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Min order</th>
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
                  No coupons yet.
                </td>
              </tr>
            )}
            {data?.items.map((c) => (
              <tr key={c.id} className="border-t border-ink-100">
                <td className="px-4 py-3 font-medium">{c.code}</td>
                <td className="px-4 py-3">{c.type === "PERCENTAGE" ? `${c.value}%` : formatPrice(c.value)}</td>
                <td className="px-4 py-3 text-ink-500">{c.minOrderAmount ? formatPrice(c.minOrderAmount) : "—"}</td>
                <td className="px-4 py-3 text-ink-500">
                  {c.usedCount}
                  {c.usageLimit ? ` / ${c.usageLimit}` : ""}
                </td>
                <td className="px-4 py-3 text-ink-500">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3">
                  <Badge className={c.isActive ? "bg-success-100 text-success-700" : ""}>{c.isActive ? "Active" : "Inactive"}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <button onClick={() => handleDelete(c)} className="text-ink-400 hover:text-danger-600">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add coupon">
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="code">Code</Label>
            <Input id="code" placeholder="EID2026" {...register("code")} />
            {errors.code && <p className="mt-1 text-xs text-danger-600">{errors.code.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="type">Type</Label>
              <Select id="type" {...register("type")}>
                <option value="PERCENTAGE">Percentage</option>
                <option value="FIXED">Fixed amount</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="value">Value</Label>
              <Input id="value" type="number" step="0.01" {...register("value", { valueAsNumber: true })} />
              {errors.value && <p className="mt-1 text-xs text-danger-600">{errors.value.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="minOrderAmount">Min order (optional)</Label>
              <Input id="minOrderAmount" type="number" step="0.01" {...register("minOrderAmount", { valueAsNumber: true })} />
            </div>
            <div>
              <Label htmlFor="maxDiscountAmount">Max discount cap (optional)</Label>
              <Input id="maxDiscountAmount" type="number" step="0.01" {...register("maxDiscountAmount", { valueAsNumber: true })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="usageLimit">Usage limit (optional)</Label>
              <Input id="usageLimit" type="number" {...register("usageLimit", { valueAsNumber: true })} />
            </div>
            <div>
              <Label htmlFor="expiresAt">Expires (optional)</Label>
              <Input id="expiresAt" type="date" {...register("expiresAt")} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brass" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Create coupon"}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
