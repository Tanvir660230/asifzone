"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  updateSmsSettingsSchema,
  DEFAULT_CUSTOMER_SMS_TEMPLATES,
  type UpdateSmsSettingsInput,
  type CustomerSmsTouchpoint,
} from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { SettingsSubNav } from "@/components/admin/settings-subnav";
import { toast } from "@/components/ui/toast";
import * as smsSettingsApi from "@/lib/api/sms-settings";
import { ApiError } from "@/lib/api-client";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

const CUSTOMER_TOUCHPOINTS = [
  {
    touchpoint: "PLACED" as CustomerSmsTouchpoint,
    enabledField: "customerOrderPlacedEnabled",
    templateField: "customerOrderPlacedTemplate",
    label: "Order placed",
    helpText: "Sent the moment a customer completes checkout.",
  },
  {
    touchpoint: "CONFIRMED" as CustomerSmsTouchpoint,
    enabledField: "customerOrderConfirmedEnabled",
    templateField: "customerOrderConfirmedTemplate",
    label: "Order confirmed",
    helpText: "Sent when an order is marked Confirmed (or paid online).",
  },
  {
    touchpoint: "SHIPPED" as CustomerSmsTouchpoint,
    enabledField: "customerOrderShippedEnabled",
    templateField: "customerOrderShippedTemplate",
    label: "Order shipped",
    helpText: "Sent when an order is marked Shipped.",
  },
  {
    touchpoint: "DELIVERED" as CustomerSmsTouchpoint,
    enabledField: "customerOrderDeliveredEnabled",
    templateField: "customerOrderDeliveredTemplate",
    label: "Order delivered",
    helpText: "Sent when an order is marked Delivered.",
  },
  {
    touchpoint: "CANCELLED" as CustomerSmsTouchpoint,
    enabledField: "customerOrderCancelledEnabled",
    templateField: "customerOrderCancelledTemplate",
    label: "Order cancelled",
    helpText: "Sent when an order is marked Cancelled.",
  },
] as const;

export default function SmsNotificationsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["sms-settings"], queryFn: smsSettingsApi.getSmsSettings });
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UpdateSmsSettingsInput>({ resolver: zodResolver(updateSmsSettingsSchema) });

  useEffect(() => {
    if (!data) return;
    const s = data.settings;
    reset({
      adminAlertPhones: s.adminAlertPhones,
      adminOrderAlertEnabled: s.adminOrderAlertEnabled,
      customerOrderPlacedEnabled: s.customerOrderPlacedEnabled,
      customerOrderConfirmedEnabled: s.customerOrderConfirmedEnabled,
      customerOrderShippedEnabled: s.customerOrderShippedEnabled,
      customerOrderDeliveredEnabled: s.customerOrderDeliveredEnabled,
      customerOrderCancelledEnabled: s.customerOrderCancelledEnabled,
      customerOrderPlacedTemplate: s.customerOrderPlacedTemplate,
      customerOrderConfirmedTemplate: s.customerOrderConfirmedTemplate,
      customerOrderShippedTemplate: s.customerOrderShippedTemplate,
      customerOrderDeliveredTemplate: s.customerOrderDeliveredTemplate,
      customerOrderCancelledTemplate: s.customerOrderCancelledTemplate,
    });
  }, [data, reset]);

  const updateMutation = useMutation({
    mutationFn: smsSettingsApi.updateSmsSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sms-settings"] });
      toast.success("SMS settings saved");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to save SMS settings"),
  });

  const adminOrderAlertEnabled = watch("adminOrderAlertEnabled");

  if (isLoading) return <p className="text-ink-400">Loading…</p>;

  if (currentAdmin && !isOwner) {
    return (
      <div>
        <PageHeader title="SMS Notifications" />
        <SettingsSubNav />
        <p className="text-sm text-ink-500">Only store owners can view or change SMS notification settings.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="SMS Notifications"
        description="Text messages sent automatically over the order lifecycle, via BulkSMSBD."
      />
      <SettingsSubNav />

      <form onSubmit={handleSubmit((values) => updateMutation.mutate(values))} className="space-y-6">
        <FormSection
          title="Admin alerts"
          description="Get texted on your own phone the moment a new order comes in — handy while you're not watching the dashboard."
        >
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <Checkbox {...register("adminOrderAlertEnabled")} />
              Text me when a new order comes in
            </label>
            <div>
              <Label htmlFor="adminAlertPhones">Alert phone number(s)</Label>
              <Input
                id="adminAlertPhones"
                placeholder="01712345678, 01898765432"
                disabled={!adminOrderAlertEnabled}
                {...register("adminAlertPhones")}
              />
              <p className="mt-1 text-xs text-ink-400">Comma-separated if you want more than one phone to receive the alert.</p>
              {errors.adminAlertPhones && <p className="mt-1 text-xs text-danger-600">{errors.adminAlertPhones.message}</p>}
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Customer notifications"
          description="Each message can be switched off, and its wording edited, independently. Placeholders {customerName}, {orderNumber}, {total} and {storeName} are filled in automatically when the SMS is sent."
        >
          <div className="space-y-5">
            {CUSTOMER_TOUCHPOINTS.map((t) => (
              <div key={t.enabledField} className="rounded-lg border border-ink-100 p-4">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink-900">
                    <Checkbox {...register(t.enabledField)} />
                    {t.label}
                  </label>
                  <button
                    type="button"
                    onClick={() => setValue(t.templateField, "", { shouldDirty: true })}
                    className="text-xs text-ink-400 underline hover:text-ink-700"
                  >
                    Reset to default
                  </button>
                </div>
                <p className="mt-0.5 text-xs text-ink-400">{t.helpText}</p>
                <Textarea
                  className="mt-2"
                  rows={2}
                  maxLength={320}
                  placeholder={DEFAULT_CUSTOMER_SMS_TEMPLATES[t.touchpoint]}
                  {...register(t.templateField)}
                />
                {errors[t.templateField] && (
                  <p className="mt-1 text-xs text-danger-600">{errors[t.templateField]?.message}</p>
                )}
              </div>
            ))}
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
