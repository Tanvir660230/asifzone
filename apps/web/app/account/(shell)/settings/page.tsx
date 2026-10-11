"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateCustomerSchema, type UpdateCustomerInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentCustomer } from "@/hooks/use-current-customer";
import { updateCustomerProfile } from "@/lib/customer-auth";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { PushNotificationToggle } from "@/components/account/push-notification-toggle";
import { PhoneVerificationPanel } from "@/components/account/phone-verification-panel";
import { AccountSecurity } from "@/components/account/account-security";
import { AccountTitle } from "@/components/account/account-ui";

/** A settings group: a short heading and explanation on the left, the controls on a solid surface on the right. */
function SettingsGroup({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-4 border-t border-line pt-8 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight text-fg">
          {title}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">{description}</p>
      </div>
      <div className="min-w-0 rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-6">{children}</div>
    </section>
  );
}

export default function AccountSettingsPage() {
  const { data, isLoading, refetch } = useCurrentCustomer();
  const [serverError, setServerError] = useState<string | null>(null);
  const [verifyingPhone, setVerifyingPhone] = useState(false);
  // Forces the loading skeleton on the very first client render regardless of how fast the query
  // resolves — react-query can settle before hydration's DOM comparison in some navigation timings,
  // which would otherwise make the client's first paint (form) diverge from the server's (skeleton).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
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

  // /account/settings#phone (the home's "Finish setting up" row) opens phone verification straight away.
  useEffect(() => {
    if (mounted && window.location.hash === "#phone" && data?.customer && !data.customer.phoneVerifiedAt) setVerifyingPhone(true);
  }, [mounted, data]);

  async function onSubmit(values: UpdateCustomerInput) {
    setServerError(null);
    try {
      await updateCustomerProfile(values);
      await refetch();
      toast.success("Changes saved");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Your changes weren't saved. Try again.");
    }
  }

  const profileLoading = !mounted || isLoading || !data?.customer;
  // Phase 11: a verified phone is the sign-in phone — it changes only through a code sent to the new number.
  const phoneVerified = Boolean(data?.customer.phoneVerifiedAt);

  return (
    <div>
      <AccountTitle title="Settings" description="Your details, how you sign in, and what we send you." />

      <div className="space-y-10">
        <SettingsGroup id="details" title="Personal details" description="Used on your orders and receipts.">
          {profileLoading ? (
            <div className="space-y-5" aria-busy="true">
              <Skeleton className="h-11 rounded-lg" />
              <Skeleton className="h-11 rounded-lg" />
              <Skeleton className="h-11 rounded-lg" />
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <Label htmlFor="name">Full name</Label>
                <Input id="name" autoComplete="name" {...register("name")} />
                {errors.name && <p className="ui-field-error">{errors.name.message}</p>}
              </div>

              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={data!.customer.email ?? ""} placeholder="No email on file" disabled />
              </div>

              <div id="phone" className="scroll-mt-28">
                <Label htmlFor="phone-input">Phone</Label>
                <Input id="phone-input" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" {...register("phone", { disabled: phoneVerified })} />
                <p className="mt-1.5 text-xs text-fg-muted">
                  {phoneVerified ? "Verified, you can sign in with this number. " : "Not verified yet. "}
                  <button type="button" className="font-medium text-fg underline underline-offset-2" onClick={() => setVerifyingPhone(true)}>
                    {phoneVerified ? "Change sign-in phone" : "Verify a number"}
                  </button>
                  {!phoneVerified && " to sign in with a code."}
                </p>
              </div>

              <div role="group" aria-labelledby="offers-title" className="space-y-3 border-t border-line-subtle pt-5">
                <p id="offers-title" className="text-sm font-medium text-fg">
                  Offers and news
                </p>
                <label className="flex items-center gap-3 text-sm text-ink-700">
                  <Checkbox {...register("smsMarketingOptIn")} />
                  SMS about sales and new arrivals
                </label>
                <label className="flex items-center gap-3 text-sm text-ink-700">
                  <Checkbox {...register("emailMarketingOptIn")} />
                  Email about sales and new arrivals
                </label>
              </div>

              {serverError && (
                <p role="alert" className="text-sm text-danger-600">
                  {serverError}
                </p>
              )}

              <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
                Save changes
              </Button>
            </form>
          )}
          {/* Outside the profile form: Enter in the code field must not submit the profile. */}
          {verifyingPhone && data?.customer && (
            <div className="mt-6">
              <PhoneVerificationPanel
                initialPhone={phoneVerified ? "" : (data.customer.phone ?? "")}
                onCancel={() => setVerifyingPhone(false)}
                onVerified={async () => {
                  setVerifyingPhone(false);
                  await refetch();
                  toast.success("Phone verified");
                }}
              />
            </div>
          )}
        </SettingsGroup>

        <SettingsGroup id="security" title="Sign-in & security" description="Changing your password signs you out on every other device.">
          <AccountSecurity hasEmail={Boolean(data?.customer.email)} />
        </SettingsGroup>

        <PushNotificationToggle
          renderShell={(control) => (
            <SettingsGroup id="notifications" title="Notifications" description="Order updates and flash sales in this browser.">
              {control}
            </SettingsGroup>
          )}
        />
      </div>
    </div>
  );
}
