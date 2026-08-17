"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { createCouponSchema, type Coupon, type CreateCouponInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Modal } from "@/components/ui/modal";
import { ProductPicker } from "@/components/admin/product-picker";
import * as categoriesApi from "@/lib/api/categories";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

interface CouponFormProps {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  /** Prefills the form — from an existing coupon when editing, or a modified copy when duplicating. */
  seed?: Coupon | null;
  onSubmit: (values: CreateCouponInput) => Promise<void>;
}

function toDateInputValue(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** RHF's `reset()` sets a native `<input type="date">`'s DOM value directly, which only accepts a
 * "YYYY-MM-DD" string — not a Date object — so startsAt/expiresAt are kept as date-input strings in
 * form state the whole time; zod's `coerce.date()` turns them back into real Dates during submit
 * validation (see createCouponSchema). Hence the loose cast: this shape only matches CreateCouponInput
 * once the resolver has run. */
function toFormValues(coupon?: Coupon | null): CreateCouponInput {
  return {
    code: coupon?.code ?? "",
    type: coupon?.type ?? "PERCENTAGE",
    value: coupon?.value !== undefined && coupon?.value !== null ? Number(coupon.value) : undefined,
    scope: coupon?.scope ?? "ALL_PRODUCTS",
    productIds: coupon?.products.map((p) => p.productId) ?? [],
    categoryIds: coupon?.categories.map((c) => c.categoryId) ?? [],
    minOrderAmount: coupon?.minOrderAmount !== null && coupon?.minOrderAmount !== undefined ? Number(coupon.minOrderAmount) : undefined,
    maxDiscountAmount:
      coupon?.maxDiscountAmount !== null && coupon?.maxDiscountAmount !== undefined ? Number(coupon.maxDiscountAmount) : undefined,
    minQuantity: coupon?.minQuantity ?? undefined,
    usageLimit: coupon?.usageLimit ?? undefined,
    perCustomerLimit: coupon?.perCustomerLimit ?? undefined,
    firstOrderOnly: coupon?.firstOrderOnly ?? false,
    startsAt: toDateInputValue(coupon?.startsAt) as unknown as Date | undefined,
    expiresAt: toDateInputValue(coupon?.expiresAt) as unknown as Date | undefined,
    description: coupon?.description ?? undefined,
    isActive: coupon?.isActive ?? true,
  };
}

export function CouponForm({ open, onClose, title, submitLabel, seed, onSubmit }: CouponFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const { data: categoriesData } = useQuery({
    queryKey: ["admin-categories-flat"],
    queryFn: () => categoriesApi.listCategories(),
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCouponInput>({
    resolver: zodResolver(createCouponSchema),
    defaultValues: toFormValues(seed),
  });

  // The same modal instance is reused for create/edit/duplicate — reseed the form (and the picker
  // state RHF can't own directly) every time it's opened against a (possibly different) coupon.
  useEffect(() => {
    if (!open) return;
    reset(toFormValues(seed));
    setProducts(seed?.products.map((p) => ({ id: p.productId, name: p.product?.name ?? p.productId })) ?? []);
    setCategoryIds(seed?.categories.map((c) => c.categoryId) ?? []);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed]);

  const type = watch("type");
  const scope = watch("scope");
  const value = watch("value");
  const maxDiscountAmount = watch("maxDiscountAmount");
  const minOrderAmount = watch("minOrderAmount");

  useEffect(() => {
    if (type === "FREE_SHIPPING") setValue("value", null);
  }, [type, setValue]);

  useEffect(() => {
    setValue("productIds", products.map((p) => p.id));
  }, [products, setValue]);

  useEffect(() => {
    setValue("categoryIds", categoryIds);
  }, [categoryIds, setValue]);

  async function submit(values: CreateCouponInput) {
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save coupon");
    }
  }

  const sampleSubtotal = Math.max(Number(minOrderAmount) || 1000, 100);
  let previewLine: string | null = null;
  if (type === "FREE_SHIPPING") {
    previewLine = "Waives the shipping fee at checkout.";
  } else if (value && value > 0) {
    let previewDiscount = type === "PERCENTAGE" ? Math.round((sampleSubtotal * value) / 100) : value;
    if (maxDiscountAmount) previewDiscount = Math.min(previewDiscount, maxDiscountAmount);
    previewDiscount = Math.min(previewDiscount, sampleSubtotal);
    const scopeNote = scope === "ALL_PRODUCTS" ? "" : " of eligible items";
    previewLine = `On a ${formatPrice(sampleSubtotal)} order${scopeNote}: ${formatPrice(previewDiscount)} off`;
  }

  return (
    <Modal open={open} onClose={onClose} title={title} widthClassName="max-w-3xl">
      {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
      <form onSubmit={handleSubmit(submit)} className="space-y-6">
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Basics</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="code">Code</Label>
              <Input id="code" placeholder="EID2026" {...register("code")} />
              {errors.code && <p className="mt-1 text-xs text-danger-600">{errors.code.message}</p>}
            </div>
            <div>
              <Label htmlFor="type">Type</Label>
              <Select id="type" {...register("type")}>
                <option value="PERCENTAGE">Percentage off</option>
                <option value="FIXED">Fixed amount off</option>
                <option value="FREE_SHIPPING">Free shipping</option>
              </Select>
            </div>
          </div>
          {type !== "FREE_SHIPPING" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="value">{type === "PERCENTAGE" ? "Percentage (%)" : "Amount (৳)"}</Label>
                <Input id="value" type="number" step="0.01" {...register("value", { valueAsNumber: true })} />
                {errors.value && <p className="mt-1 text-xs text-danger-600">{errors.value.message}</p>}
              </div>
              <div>
                <Label htmlFor="maxDiscountAmount">Max discount cap (optional)</Label>
                <Input id="maxDiscountAmount" type="number" step="0.01" {...register("maxDiscountAmount", { valueAsNumber: true })} />
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="description">Internal note (optional, admin-only)</Label>
            <Textarea id="description" rows={2} placeholder="e.g. Eid campaign, agreed with supplier X" {...register("description")} />
          </div>
          {previewLine && (
            <p className="rounded-lg bg-success-50 px-3 py-2 text-xs text-success-700">{previewLine}</p>
          )}
        </section>

        <section className="space-y-4 border-t border-ink-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Discount rules</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="minOrderAmount">Min order amount (optional)</Label>
              <Input id="minOrderAmount" type="number" step="0.01" {...register("minOrderAmount", { valueAsNumber: true })} />
            </div>
            <div>
              <Label htmlFor="minQuantity">Min eligible items (optional)</Label>
              <Input id="minQuantity" type="number" {...register("minQuantity", { valueAsNumber: true })} />
            </div>
            <div>
              <Label htmlFor="usageLimit">Total usage limit (optional)</Label>
              <Input id="usageLimit" type="number" {...register("usageLimit", { valueAsNumber: true })} />
            </div>
            <div>
              <Label htmlFor="perCustomerLimit">Per-customer limit (optional)</Label>
              <Input id="perCustomerLimit" type="number" {...register("perCustomerLimit", { valueAsNumber: true })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Checkbox {...register("firstOrderOnly")} />
            Only valid on a customer&rsquo;s first order
          </label>
        </section>

        <section className="space-y-4 border-t border-ink-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Scheduling</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="startsAt">Starts (optional)</Label>
              <Input id="startsAt" type="date" {...register("startsAt")} />
            </div>
            <div>
              <Label htmlFor="expiresAt">Expires (optional)</Label>
              <Input id="expiresAt" type="date" {...register("expiresAt")} />
            </div>
          </div>
          {errors.expiresAt && <p className="text-xs text-danger-600">{errors.expiresAt.message}</p>}
        </section>

        <section className="space-y-4 border-t border-ink-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Applies to</h3>
          <Select
            {...register("scope", {
              // Switching away from a scoped option must drop the now-hidden picker's selection —
              // otherwise it stays in form state invisibly and can be submitted alongside a scope
              // that no longer shows any UI for editing it.
              onChange: (e: ChangeEvent<HTMLSelectElement>) => {
                const next = e.target.value;
                if (next !== "SPECIFIC_PRODUCTS") setProducts([]);
                if (next !== "SPECIFIC_CATEGORIES") setCategoryIds([]);
              },
            })}
          >
            <option value="ALL_PRODUCTS">All products</option>
            <option value="SPECIFIC_PRODUCTS">Specific products</option>
            <option value="SPECIFIC_CATEGORIES">Specific categories</option>
          </Select>
          {scope === "SPECIFIC_PRODUCTS" && <ProductPicker selected={products} onChange={setProducts} />}
          {scope === "SPECIFIC_CATEGORIES" && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-ink-100 p-3">
              {categoriesData?.categories.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {categoriesData.categories.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm text-ink-700">
                      <Checkbox
                        checked={categoryIds.includes(c.id)}
                        onChange={(e) =>
                          setCategoryIds((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)))
                        }
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink-400">No categories yet.</p>
              )}
            </div>
          )}
        </section>

        <section className="space-y-3 border-t border-ink-100 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink-900">Active</p>
              <p className="text-xs text-ink-500">Inactive coupons can&rsquo;t be redeemed, even if the code is known.</p>
            </div>
            <Switch checked={watch("isActive")} onChange={(checked) => setValue("isActive", checked)} aria-label="Active" />
          </div>
        </section>

        <div className="flex justify-end gap-2 border-t border-ink-100 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="brass" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
