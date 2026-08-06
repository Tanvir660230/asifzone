"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";
import { updateSettingsSchema, type UpdateSettingsInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { toast } from "@/components/ui/toast";
import * as settingsApi from "@/lib/api/settings";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

interface LogoUploadFieldProps {
  label: string;
  helpText: string;
  value: string | null | undefined;
  onChange: (url: string) => void;
  onRemove: () => void;
  /** Preview swatch background — should match where this logo variant is actually shown, so the admin can judge contrast before saving. */
  previewBackground: "light" | "dark";
}

function LogoUploadField({ label, helpText, value, onChange, onRemove, previewBackground }: LogoUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadMutation = useMutation({ mutationFn: settingsApi.uploadLogo });

  async function handleSelected(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const { url } = await uploadMutation.mutateAsync(file);
      onChange(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Logo upload failed");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <Label>{label}</Label>
      {value ? (
        <div
          className={cn(
            "relative mt-1 flex h-20 w-40 items-center justify-center overflow-hidden rounded-lg border p-3",
            previewBackground === "dark" ? "border-ink-800 bg-ink-900" : "border-ink-100 bg-cream-50",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="h-full w-full object-contain" />
          <button
            type="button"
            onClick={onRemove}
            className="absolute right-1 top-1 rounded-full bg-ink-900/70 p-1 text-cream-50"
            aria-label={`Remove ${label.toLowerCase()}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className="mt-1 flex h-20 w-40 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-300 text-ink-500 transition-colors hover:border-brass-400 hover:text-brass-500 disabled:opacity-50"
        >
          <Upload size={18} />
          <span className="text-xs">{uploadMutation.isPending ? "Uploading…" : "Upload logo"}</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleSelected(e.target.files?.[0] ?? null)}
      />
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
      <p className="mt-1 text-xs text-ink-400">{helpText}</p>
    </div>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: settingsApi.getSettings });
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UpdateSettingsInput>({ resolver: zodResolver(updateSettingsSchema) });

  const logoUrl = watch("logoUrl");
  const logoOnDarkUrl = watch("logoOnDarkUrl");

  useEffect(() => {
    if (!data) return;
    const s = data.settings;
    reset({
      storeName: s.storeName,
      tagline: s.tagline,
      logoUrl: s.logoUrl,
      logoOnDarkUrl: s.logoOnDarkUrl,
      faviconUrl: s.faviconUrl,
      currency: s.currency,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      shippingFeeDhaka: Number(s.shippingFeeDhaka),
      shippingFeeOutsideDhaka: Number(s.shippingFeeOutsideDhaka),
      taxEnabled: s.taxEnabled,
      defaultTaxRate: s.defaultTaxRate ? Number(s.defaultTaxRate) : undefined,
      rewardPointsPerCurrency: Number(s.rewardPointsPerCurrency),
    });
  }, [data, reset]);

  const updateMutation = useMutation({
    mutationFn: settingsApi.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to save settings"),
  });

  const taxEnabled = watch("taxEnabled");

  if (isLoading) return <p className="text-ink-400">Loading…</p>;

  if (currentAdmin && !isOwner) {
    return (
      <div>
        <PageHeader title="Settings" />
        <p className="text-sm text-ink-500">Only store owners can view or change store settings.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" />

      <form onSubmit={handleSubmit((values) => updateMutation.mutate(values))} className="space-y-6">
        <FormSection title="Store information" description="Name and branding shown across the storefront.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="storeName">Store name</Label>
              <Input id="storeName" {...register("storeName")} />
              {errors.storeName && <p className="mt-1 text-xs text-danger-600">{errors.storeName.message}</p>}
            </div>
            <div>
              <Label htmlFor="currency">Currency code</Label>
              <Input id="currency" placeholder="BDT" {...register("currency")} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="tagline">Tagline</Label>
              <Input id="tagline" placeholder="Considered clothing, made to last" {...register("tagline")} />
            </div>
            <div>
              <Label htmlFor="faviconUrl">Favicon URL</Label>
              <Input id="faviconUrl" placeholder="https://…" {...register("faviconUrl")} />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <input type="hidden" {...register("logoUrl")} />
              <LogoUploadField
                label="Logo (light backgrounds)"
                helpText="Shown in the header and anywhere else with a light background. A transparent PNG works best."
                value={logoUrl}
                previewBackground="light"
                onChange={(url) => setValue("logoUrl", url, { shouldValidate: true })}
                onRemove={() => setValue("logoUrl", "", { shouldValidate: true })}
              />
            </div>
            <div>
              <input type="hidden" {...register("logoOnDarkUrl")} />
              <LogoUploadField
                label="Logo (dark backgrounds)"
                helpText="A bright/light-colored version, shown in the footer and other dark sections. Falls back to the light-background logo if left empty."
                value={logoOnDarkUrl}
                previewBackground="dark"
                onChange={(url) => setValue("logoOnDarkUrl", url, { shouldValidate: true })}
                onRemove={() => setValue("logoOnDarkUrl", "", { shouldValidate: true })}
              />
            </div>
          </div>
        </FormSection>

        <FormSection title="Contact" description="Shown in the footer and contact page. Social media links are managed on the Social Links page.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input id="contactEmail" type="email" {...register("contactEmail")} />
            </div>
            <div>
              <Label htmlFor="contactPhone">Contact phone</Label>
              <Input id="contactPhone" {...register("contactPhone")} />
            </div>
          </div>
        </FormSection>

        <FormSection title="Shipping, tax & rewards" description="Applied live to checkout and the customer rewards program.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="shippingFeeDhaka">Shipping fee — inside Dhaka (BDT)</Label>
              <Input id="shippingFeeDhaka" type="number" step="0.01" {...register("shippingFeeDhaka", { valueAsNumber: true })} />
              {errors.shippingFeeDhaka && <p className="mt-1 text-xs text-danger-600">{errors.shippingFeeDhaka.message}</p>}
            </div>
            <div>
              <Label htmlFor="shippingFeeOutsideDhaka">Shipping fee — outside Dhaka (BDT)</Label>
              <Input
                id="shippingFeeOutsideDhaka"
                type="number"
                step="0.01"
                {...register("shippingFeeOutsideDhaka", { valueAsNumber: true })}
              />
              {errors.shippingFeeOutsideDhaka && (
                <p className="mt-1 text-xs text-danger-600">{errors.shippingFeeOutsideDhaka.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="rewardPointsPerCurrency">Reward points per 1 BDT spent</Label>
              <Input
                id="rewardPointsPerCurrency"
                type="number"
                step="0.0001"
                placeholder="0 disables rewards"
                {...register("rewardPointsPerCurrency", { valueAsNumber: true })}
              />
              {errors.rewardPointsPerCurrency && (
                <p className="mt-1 text-xs text-danger-600">{errors.rewardPointsPerCurrency.message}</p>
              )}
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm text-ink-700">
              <Checkbox {...register("taxEnabled")} />
              Enable tax on new products by default
            </label>
            <div>
              <Label htmlFor="defaultTaxRate">Default tax rate (%)</Label>
              <Input
                id="defaultTaxRate"
                type="number"
                step="0.01"
                disabled={!taxEnabled}
                {...register("defaultTaxRate", { valueAsNumber: true })}
              />
              {errors.defaultTaxRate && <p className="mt-1 text-xs text-danger-600">{errors.defaultTaxRate.message}</p>}
            </div>
          </div>
        </FormSection>

        <div className="flex justify-end">
          <Button type="submit" variant="brass" disabled={isSubmitting || updateMutation.isPending}>
            {updateMutation.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
    </div>
  );
}
