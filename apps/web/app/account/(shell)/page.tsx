"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateCustomerSchema, type UpdateCustomerInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useCurrentCustomer } from "@/hooks/use-current-customer";
import { updateCustomerProfile } from "@/lib/customer-auth";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { PushNotificationToggle } from "@/components/account/push-notification-toggle";

export default function AccountProfilePage() {
  const { data, isLoading, refetch } = useCurrentCustomer();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateCustomerInput>({ resolver: zodResolver(updateCustomerSchema) });

  useEffect(() => {
    if (data?.customer) {
      reset({
        name: data.customer.name,
        phone: data.customer.phone,
        smsMarketingOptIn: data.customer.smsMarketingOptIn,
        emailMarketingOptIn: data.customer.emailMarketingOptIn,
      });
    }
  }, [data, reset]);

  async function onSubmit(values: UpdateCustomerInput) {
    setServerError(null);
    try {
      await updateCustomerProfile(values);
      await refetch();
      toast.success("Profile updated");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to update profile");
    }
  }

  if (isLoading || !data?.customer) {
    return (
      <div className="animate-pulse">
        <div className="mb-6 h-7 w-24 rounded bg-ink-100" />
        <div className="max-w-md space-y-4">
          <div className="h-10 w-full rounded-lg bg-ink-100" />
          <div className="h-10 w-full rounded-lg bg-ink-100" />
          <div className="h-10 w-full rounded-lg bg-ink-100" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-ink-900">Profile</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-4">
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input id="name" {...register("name")} />
          {errors.name && <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>}
        </div>

        <div>
          <Label>Email</Label>
          <Input value={data.customer.email ?? ""} placeholder="No email on file" disabled />
        </div>

        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" placeholder="01XXXXXXXXX" {...register("phone")} />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-700">
          <Checkbox {...register("smsMarketingOptIn")} />
          Send me SMS updates about sales and offers
        </label>

        <label className="flex items-center gap-2 text-sm text-ink-700">
          <Checkbox {...register("emailMarketingOptIn")} />
          Send me email updates about sales and offers
        </label>

        {serverError && <p className="text-sm text-danger-600">{serverError}</p>}

        <Button type="submit" variant="brass" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </form>

      <div className="mt-8 max-w-md">
        <h2 className="mb-3 font-display text-lg text-ink-900">Notifications</h2>
        <PushNotificationToggle />
      </div>
    </div>
  );
}
