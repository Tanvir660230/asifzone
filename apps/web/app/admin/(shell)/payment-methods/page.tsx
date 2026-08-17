"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CreditCard, ImageIcon, Plus, Trash2, Upload } from "lucide-react";
import { createPaymentMethodSchema, type CreatePaymentMethodInput, type PaymentMethodOption } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/admin/page-header";
import { SettingsSubNav } from "@/components/admin/settings-subnav";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import * as paymentMethodsApi from "@/lib/api/payment-methods";
import * as settingsApi from "@/lib/api/settings";
import { ApiError } from "@/lib/api-client";

const QUERY_KEY = ["admin-payment-methods"];
const SETTINGS_QUERY_KEY = ["settings"];

export default function PaymentMethodsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: paymentMethodsApi.listPaymentMethods });
  const { data: settingsData } = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: settingsApi.getSettings });
  const [showCreate, setShowCreate] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [combinedImageError, setCombinedImageError] = useState<string | null>(null);
  const combinedImageInputRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const combinedImageUrl = settingsData?.settings.paymentMethodsImageUrl ?? null;
  const uploadCombinedImageMutation = useMutation({ mutationFn: settingsApi.uploadPaymentMethodsImage });
  const updateCombinedImageMutation = useMutation({
    mutationFn: settingsApi.updateSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
  });

  async function handleCombinedImageSelected(file: File | null) {
    if (!file) return;
    setCombinedImageError(null);
    try {
      const { url } = await uploadCombinedImageMutation.mutateAsync(file);
      await updateCombinedImageMutation.mutateAsync({ paymentMethodsImageUrl: url });
      toast.success("Combined payment image saved");
    } catch (err) {
      setCombinedImageError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      if (combinedImageInputRef.current) combinedImageInputRef.current.value = "";
    }
  }

  async function handleRemoveCombinedImage() {
    try {
      await updateCombinedImageMutation.mutateAsync({ paymentMethodsImageUrl: null });
    } catch (err) {
      setCombinedImageError(err instanceof ApiError ? err.message : "Failed to remove image");
    }
  }

  const createMutation = useMutation({ mutationFn: paymentMethodsApi.createPaymentMethod, onSuccess: invalidate });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof paymentMethodsApi.updatePaymentMethod>[1]) =>
      paymentMethodsApi.updatePaymentMethod(id, input),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: paymentMethodsApi.deletePaymentMethod,
    onSuccess: () => {
      invalidate();
      toast.success("Payment method deleted");
    },
  });
  const uploadMutation = useMutation({ mutationFn: paymentMethodsApi.uploadPaymentMethodLogo });
  const reorderMutation = useMutation({
    mutationFn: paymentMethodsApi.reorderPaymentMethods,
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't reorder payment methods — try again"),
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreatePaymentMethodInput>({
    resolver: zodResolver(createPaymentMethodSchema),
    defaultValues: { name: "", logoUrl: null, isActive: true, sortOrder: 0 },
  });
  const logoUrl = watch("logoUrl");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const methods = data?.methods ?? [];

  async function handleLogoSelected(file: File | null) {
    if (!file) return;
    try {
      const { url } = await uploadMutation.mutateAsync(file);
      setValue("logoUrl", url, { shouldValidate: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Logo upload failed");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onSubmit(values: CreatePaymentMethodInput) {
    setFormError(null);
    try {
      await createMutation.mutateAsync({ ...values, sortOrder: methods.length });
      setShowCreate(false);
      reset({ name: "", logoUrl: null, isActive: true, sortOrder: 0 });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to add payment method");
    }
  }

  async function handleDelete(method: PaymentMethodOption) {
    if (!(await confirm(`Remove "${method.name}"?`))) return;
    await deleteMutation.mutateAsync(method.id);
  }

  function move(index: number, direction: -1 | 1) {
    const target = methods[index + direction];
    const current = methods[index];
    if (!target || !current) return;
    // One atomic request for both swapped rows — previously two separate PATCH calls, so a
    // failure of the second after the first succeeded could leave sort order corrupted with no
    // rollback or error surfaced.
    reorderMutation.mutate({
      items: [
        { id: current.id, sortOrder: target.sortOrder },
        { id: target.id, sortOrder: current.sortOrder },
      ],
    });
  }

  return (
    <div>
      <PageHeader
        title="Payment Methods"
        action={
          <Button variant="brass" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Add method
          </Button>
        }
      />
      <SettingsSubNav />
      <p className="mb-6 text-sm text-ink-500">
        Show payment logos two ways: upload one combined image with everything already laid out, or add each logo
        separately below for individual control (reordering, toggling one on/off).
      </p>

      <div className="mb-6 rounded-lg border border-ink-100 bg-cream-50 p-5">
        <h2 className="mb-1 text-sm font-medium text-ink-900">Combined image</h2>
        <p className="mb-4 text-xs text-ink-500">
          One image with all your payment logos already arranged — quicker than uploading each logo one by one. When
          set, this replaces the list below everywhere on the site.
        </p>
        <div className="flex items-center gap-4">
          {combinedImageUrl ? (
            <div className="relative flex h-16 w-56 items-center justify-center rounded-lg border border-ink-200 bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={combinedImageUrl} alt="" className="h-full w-full object-contain" />
              <button
                type="button"
                onClick={handleRemoveCombinedImage}
                disabled={updateCombinedImageMutation.isPending}
                className="absolute right-1 top-1 rounded-full bg-ink-900/70 p-1 text-cream-50"
                aria-label="Remove combined image"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => combinedImageInputRef.current?.click()}
              disabled={uploadCombinedImageMutation.isPending}
              className="flex h-16 w-56 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ink-300 text-ink-500 transition-colors hover:border-brass-400 hover:text-brass-500 disabled:opacity-50"
            >
              <ImageIcon size={16} />
              <span className="text-xs">
                {uploadCombinedImageMutation.isPending ? "Uploading…" : "Upload combined image"}
              </span>
            </button>
          )}
          <input
            ref={combinedImageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => handleCombinedImageSelected(e.target.files?.[0] ?? null)}
          />
        </div>
        {combinedImageError && <p className="mt-2 text-xs text-danger-600">{combinedImageError}</p>}
      </div>

      <h2 className="mb-1 text-sm font-medium text-ink-900">Individual logos</h2>
      <p className="mb-4 text-xs text-ink-500">
        Ignored while a combined image (above) is set. Only active methods appear on the site — keep logos roughly
        the same aspect ratio, since they&rsquo;re all displayed at a fixed height.
      </p>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        {isLoading && <p className="p-6 text-sm text-ink-400">Loading…</p>}
        {!isLoading && methods.length === 0 && (
          <p className="p-6 text-sm text-ink-400">No payment methods yet — add one to show its logo on the site.</p>
        )}
        {methods.length > 0 && (
          <ul className="divide-y divide-ink-100">
            {methods.map((method, index) => (
              <li key={method.id} className="flex items-center gap-4 px-4 py-3">
                <span className="flex h-9 w-14 shrink-0 items-center justify-center rounded border border-ink-200 bg-white">
                  {method.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={method.logoUrl} alt="" className="h-full w-full object-contain p-1" />
                  ) : (
                    <CreditCard size={16} className="text-ink-300" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">{method.name}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => move(index, -1)}
                    disabled={index === 0 || reorderMutation.isPending}
                    className="rounded p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:pointer-events-none disabled:opacity-30"
                    aria-label="Move up"
                    title="Move up"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === methods.length - 1 || reorderMutation.isPending}
                    className="rounded p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:pointer-events-none disabled:opacity-30"
                    aria-label="Move down"
                    title="Move down"
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-ink-600">
                  <Checkbox
                    checked={method.isActive}
                    onChange={(e) => updateMutation.mutate({ id: method.id, isActive: e.target.checked })}
                  />
                  Active
                </label>
                <button
                  onClick={() => handleDelete(method)}
                  className="shrink-0 text-ink-400 hover:text-danger-600"
                  aria-label="Delete"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add payment method">
        {formError && <p className="mb-3 text-sm text-danger-600">{formError}</p>}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="e.g. bKash" {...register("name")} />
            {errors.name && <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>}
          </div>

          <div>
            <input type="hidden" {...register("logoUrl")} />
            <Label>Logo</Label>
            {logoUrl ? (
              <div className="relative mt-1 flex h-16 w-28 items-center justify-center rounded-lg border border-ink-100 bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl} alt="" className="h-full w-full object-contain" />
                <button
                  type="button"
                  onClick={() => setValue("logoUrl", null, { shouldValidate: true })}
                  className="absolute right-1 top-1 rounded-full bg-ink-900/70 p-1 text-cream-50"
                  aria-label="Remove logo"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="mt-1 flex h-16 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ink-300 text-ink-500 transition-colors hover:border-brass-400 hover:text-brass-500 disabled:opacity-50"
              >
                <Upload size={16} />
                <span className="text-xs">{uploadMutation.isPending ? "Uploading…" : "Upload logo"}</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => handleLogoSelected(e.target.files?.[0] ?? null)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Checkbox {...register("isActive")} defaultChecked />
            Show on storefront
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brass" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Add method"}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
