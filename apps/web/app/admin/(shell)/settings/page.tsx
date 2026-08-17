"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";
import { updateSettingsSchema, type UpdateSettingsInput, type UpdateSocialLinkInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { SettingsSubNav } from "@/components/admin/settings-subnav";
import { toast } from "@/components/ui/toast";
import * as settingsApi from "@/lib/api/settings";
import * as socialLinksApi from "@/lib/api/admin-social-links";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

/** wa.me and api.whatsapp.com/send?phone= are the two URL shapes admins tend to paste (or that this
 * form itself writes) — read whichever one is there back out to a plain number for editing. */
function phoneFromWhatsAppUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("phone")) return parsed.searchParams.get("phone") ?? "";
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return "";
  }
}

function whatsAppUrlFromPhone(phone: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}`;
}

/** Self-contained number + on/off control for the WhatsApp contact button. Saves straight to its
 * backing SocialLink record (platform WHATSAPP) rather than through the main settings form, since
 * that's a separate resource/mutation — full add/reorder/remove for every platform still lives on
 * the Social Links page, this is just a shortcut for the one platform the contact widget needs. */
function WhatsAppQuickConfig() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-social-links"], queryFn: socialLinksApi.listSocialLinks });
  const link = data?.links.find((l) => l.platform === "WHATSAPP");
  const [number, setNumber] = useState("");
  const [numberDirty, setNumberDirty] = useState(false);

  useEffect(() => {
    if (!numberDirty) setNumber(link ? phoneFromWhatsAppUrl(link.url) : "");
  }, [link, numberDirty]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-social-links"] });
  const createMutation = useMutation({ mutationFn: socialLinksApi.createSocialLink, onSuccess: invalidate });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & UpdateSocialLinkInput) => socialLinksApi.updateSocialLink(id, input),
    onSuccess: invalidate,
  });
  const saving = createMutation.isPending || updateMutation.isPending;

  async function saveNumber() {
    if (number.trim() === "") {
      toast.error("Enter a WhatsApp number first");
      return;
    }
    try {
      const url = whatsAppUrlFromPhone(number);
      if (link) await updateMutation.mutateAsync({ id: link.id, url });
      else await createMutation.mutateAsync({ platform: "WHATSAPP", url, isActive: true, sortOrder: 0 });
      setNumberDirty(false);
      toast.success("WhatsApp number saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save WhatsApp number");
    }
  }

  async function toggleEnabled(checked: boolean) {
    if (!link) {
      if (!checked) return;
      if (number.trim() === "") {
        toast.error("Enter a WhatsApp number first");
        return;
      }
      await createMutation.mutateAsync({ platform: "WHATSAPP", url: whatsAppUrlFromPhone(number), isActive: true, sortOrder: 0 });
      return;
    }
    await updateMutation.mutateAsync({ id: link.id, isActive: checked });
  }

  return (
    <div className="mt-3 grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
      <div>
        <Label htmlFor="whatsappNumber">WhatsApp number</Label>
        <Input
          id="whatsappNumber"
          placeholder="8801XXXXXXXXX"
          value={number}
          onChange={(e) => {
            setNumber(e.target.value);
            setNumberDirty(true);
          }}
        />
      </div>
      <Button type="button" variant="outline" onClick={saveNumber} disabled={saving}>
        {saving ? "Saving…" : "Save number"}
      </Button>
      <label className="flex items-center gap-2 pb-2.5 text-sm text-ink-700">
        <Checkbox checked={link?.isActive ?? false} onChange={(e) => toggleEnabled(e.target.checked)} disabled={saving} />
        Show on storefront
      </label>
    </div>
  );
}

const TABS = [
  { value: "branding", label: "Store & Branding" },
  { value: "contact", label: "Contact & Support" },
  { value: "shipping", label: "Shipping, Tax & Rewards" },
] as const;
type SettingsTab = (typeof TABS)[number]["value"];

interface LogoUploadFieldProps {
  label: string;
  helpText: string;
  value: string | null | undefined;
  onChange: (url: string) => void;
  onRemove: () => void;
  /** Preview swatch background — should match where this logo variant is actually shown, so the admin can judge contrast before saving. */
  previewBackground: "light" | "dark";
  /** Which endpoint to upload through — logo and favicon are processed differently server-side (favicon gets square-cropped to a small PNG). */
  uploadFn: (file: File) => Promise<{ url: string }>;
  uploadLabel?: string;
}

function LogoUploadField({
  label,
  helpText,
  value,
  onChange,
  onRemove,
  previewBackground,
  uploadFn,
  uploadLabel = "Upload logo",
}: LogoUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadMutation = useMutation({ mutationFn: uploadFn });

  async function handleSelected(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const { url } = await uploadMutation.mutateAsync(file);
      onChange(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
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
          <span className="text-xs">{uploadMutation.isPending ? "Uploading…" : uploadLabel}</span>
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
  const [tab, setTab] = useState<SettingsTab>("branding");
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
  const faviconUrl = watch("faviconUrl");

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
      courierReturnFeeDhaka: Number(s.courierReturnFeeDhaka),
      courierReturnFeeOutsideDhaka: Number(s.courierReturnFeeOutsideDhaka),
      taxEnabled: s.taxEnabled,
      defaultTaxRate: s.defaultTaxRate ? Number(s.defaultTaxRate) : undefined,
      rewardPointsPerCurrency: Number(s.rewardPointsPerCurrency),
      whatsappMessage: s.whatsappMessage,
      whatsappLabel: s.whatsappLabel,
      callEnabled: s.callEnabled,
      callLabel: s.callLabel,
      liveChatEnabled: s.liveChatEnabled,
      liveChatLabel: s.liveChatLabel,
      tawkPropertyId: s.tawkPropertyId,
      tawkWidgetId: s.tawkWidgetId,
      codEnabled: s.codEnabled,
      onlinePaymentEnabled: s.onlinePaymentEnabled,
      epsPaymentEnabled: s.epsPaymentEnabled,
      googleSiteVerification: s.googleSiteVerification,
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
  const callEnabled = watch("callEnabled");
  const liveChatEnabled = watch("liveChatEnabled");
  const codEnabled = watch("codEnabled");
  const onlinePaymentEnabled = watch("onlinePaymentEnabled");
  const epsPaymentEnabled = watch("epsPaymentEnabled");
  const isLastPaymentMethodEnabled =
    (codEnabled ? 1 : 0) + (onlinePaymentEnabled ? 1 : 0) + (epsPaymentEnabled ? 1 : 0) === 1;

  if (isLoading) return <p className="text-ink-400">Loading…</p>;

  if (currentAdmin && !isOwner) {
    return (
      <div>
        <PageHeader title="Settings" />
        <SettingsSubNav />
        <p className="text-sm text-ink-500">Only store owners can view or change store settings.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" />
      <SettingsSubNav />

      <div className="mb-6 flex flex-wrap gap-1 border-b border-ink-100">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-150 ease-smooth",
              tab === t.value ? "border-ink-900 text-ink-900" : "border-transparent text-ink-400 hover:text-ink-700",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit((values) => updateMutation.mutate(values))} className="space-y-6">
        {tab === "branding" && (
        <>
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
          </div>

          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div>
              <input type="hidden" {...register("logoUrl")} />
              <LogoUploadField
                label="Logo (light backgrounds)"
                helpText="Shown in the header and anywhere else with a light background. A transparent PNG works best."
                value={logoUrl}
                previewBackground="light"
                uploadFn={settingsApi.uploadLogo}
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
                uploadFn={settingsApi.uploadLogo}
                onChange={(url) => setValue("logoOnDarkUrl", url, { shouldValidate: true })}
                onRemove={() => setValue("logoOnDarkUrl", "", { shouldValidate: true })}
              />
            </div>
            <div>
              <input type="hidden" {...register("faviconUrl")} />
              <LogoUploadField
                label="Favicon"
                helpText="The small icon shown in the browser tab. Square images work best — it's cropped to a square automatically."
                value={faviconUrl}
                previewBackground="light"
                uploadFn={settingsApi.uploadFavicon}
                uploadLabel="Upload favicon"
                onChange={(url) => setValue("faviconUrl", url, { shouldValidate: true })}
                onRemove={() => setValue("faviconUrl", "", { shouldValidate: true })}
              />
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Search engines"
          description="Helps Google (and other search engines) find and understand this store."
        >
          <div>
            <Label htmlFor="googleSiteVerification">Google Search Console verification code</Label>
            <p className="mb-1 text-xs text-ink-400">
              From Search Console&rsquo;s HTML tag verification method — paste just the{" "}
              <code className="rounded bg-ink-50 px-1">content=&quot;...&quot;</code> value, not the full tag.
            </p>
            <Input id="googleSiteVerification" placeholder="abc123XYZ..." {...register("googleSiteVerification")} />
          </div>
        </FormSection>
        </>
        )}

        {tab === "contact" && (
        <>
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

        <FormSection
          title="Contact options"
          description="Controls the floating contact button on the storefront (WhatsApp, Call, Live Chat)."
        >
          <div className="space-y-5">
            <div className="rounded-lg border border-ink-100 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink-900">WhatsApp</p>
                <Link href="/admin/social-links" className="text-xs text-ink-400 underline hover:text-ink-700">
                  Manage all social links →
                </Link>
              </div>
              <WhatsAppQuickConfig />
              <div className="mt-4 grid grid-cols-1 gap-4 border-t border-ink-100 pt-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="whatsappLabel">Button label</Label>
                  <Input id="whatsappLabel" placeholder="WhatsApp" {...register("whatsappLabel")} />
                </div>
                <div>
                  <Label htmlFor="whatsappMessage">Prefilled message</Label>
                  <Input id="whatsappMessage" placeholder="Hi! I have a question about…" {...register("whatsappMessage")} />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-ink-100 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink-900">Direct Call</p>
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <Checkbox {...register("callEnabled")} />
                  On
                </label>
              </div>
              <p className="mt-0.5 text-xs text-ink-400">Uses the contact phone number set above.</p>
              <div className="mt-3">
                <Label htmlFor="callLabel">Button label</Label>
                <Input id="callLabel" placeholder="Call Us" disabled={!callEnabled} {...register("callLabel")} />
              </div>
            </div>

            <div className="rounded-lg border border-ink-100 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink-900">Live Chat</p>
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <Checkbox {...register("liveChatEnabled")} />
                  On
                </label>
              </div>
              <p className="mt-0.5 text-xs text-ink-400">Powered by Tawk.to — free to sign up at tawk.to.</p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="liveChatLabel">Button label</Label>
                  <Input id="liveChatLabel" placeholder="Live Chat" disabled={!liveChatEnabled} {...register("liveChatLabel")} />
                </div>
                <div>
                  <Label htmlFor="tawkPropertyId">Tawk.to property ID</Label>
                  <Input id="tawkPropertyId" disabled={!liveChatEnabled} {...register("tawkPropertyId")} />
                </div>
                <div>
                  <Label htmlFor="tawkWidgetId">Tawk.to widget ID</Label>
                  <Input id="tawkWidgetId" disabled={!liveChatEnabled} {...register("tawkWidgetId")} />
                </div>
              </div>
            </div>
          </div>
        </FormSection>
        </>
        )}

        {tab === "shipping" && (
        <>
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
              <Label htmlFor="courierReturnFeeDhaka">Courier return fee — inside Dhaka (BDT)</Label>
              <Input
                id="courierReturnFeeDhaka"
                type="number"
                step="0.01"
                {...register("courierReturnFeeDhaka", { valueAsNumber: true })}
              />
              {errors.courierReturnFeeDhaka && (
                <p className="mt-1 text-xs text-danger-600">{errors.courierReturnFeeDhaka.message}</p>
              )}
              <p className="mt-1 text-xs text-ink-400">
                Estimated round-trip cost when a booked order is cancelled or partially returned — Steadfast doesn&apos;t
                report this per order, so it&apos;s used to total up the dashboard&apos;s cancellation-loss figure only.
              </p>
            </div>
            <div>
              <Label htmlFor="courierReturnFeeOutsideDhaka">Courier return fee — outside Dhaka (BDT)</Label>
              <Input
                id="courierReturnFeeOutsideDhaka"
                type="number"
                step="0.01"
                {...register("courierReturnFeeOutsideDhaka", { valueAsNumber: true })}
              />
              {errors.courierReturnFeeOutsideDhaka && (
                <p className="mt-1 text-xs text-danger-600">{errors.courierReturnFeeOutsideDhaka.message}</p>
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

        <FormSection
          title="Payment methods at checkout"
          description="Turn Cash on Delivery or online payment off whenever needed — at least one must stay on."
        >
          <div className="space-y-3">
            <label className="flex items-center justify-between rounded-lg border border-ink-100 p-4">
              <div>
                <p className="text-sm font-medium text-ink-900">Cash on Delivery</p>
                <p className="mt-0.5 text-xs text-ink-400">Pay in cash when the order arrives.</p>
              </div>
              <Checkbox {...register("codEnabled")} disabled={codEnabled && isLastPaymentMethodEnabled} />
            </label>
            <label className="flex items-center justify-between rounded-lg border border-ink-100 p-4">
              <div>
                <p className="text-sm font-medium text-ink-900">Online Payment (SSLCommerz)</p>
                <p className="mt-0.5 text-xs text-ink-400">bKash, Nagad &amp; Card via SSLCommerz.</p>
              </div>
              <Checkbox {...register("onlinePaymentEnabled")} disabled={onlinePaymentEnabled && isLastPaymentMethodEnabled} />
            </label>
            <label className="flex items-center justify-between rounded-lg border border-ink-100 p-4">
              <div>
                <p className="text-sm font-medium text-ink-900">Online Payment (EPS-PG)</p>
                <p className="mt-0.5 text-xs text-ink-400">bKash, Nagad &amp; Card via EPS. Requires EPS_* env vars to be set.</p>
              </div>
              <Checkbox {...register("epsPaymentEnabled")} disabled={epsPaymentEnabled && isLastPaymentMethodEnabled} />
            </label>
            {!codEnabled && !onlinePaymentEnabled && !epsPaymentEnabled && (
              <p className="text-xs text-danger-600">At least one payment method must stay enabled.</p>
            )}
          </div>
        </FormSection>
        </>
        )}

        <div className="flex justify-end">
          <Button type="submit" variant="brass" disabled={isSubmitting || updateMutation.isPending}>
            {updateMutation.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
    </div>
  );
}
