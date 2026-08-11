"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { acceptAdminInviteSchema, type AcceptAdminInviteInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/account/password-input";
import { PasswordStrengthMeter } from "@/components/account/password-strength-meter";
import { acceptAdminInvite } from "@/lib/auth";
import { ApiError } from "@/lib/api-client";

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AcceptAdminInviteInput>({
    resolver: zodResolver(acceptAdminInviteSchema),
    defaultValues: { token },
  });

  const password = watch("password") ?? "";

  async function onSubmit(values: AcceptAdminInviteInput) {
    setServerError(null);
    try {
      await acceptAdminInvite(values);
      router.replace("/admin/dashboard");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Something went wrong, please try again");
    }
  }

  if (!token) {
    return (
      <div>
        <h1 className="mb-1 font-display text-2xl text-ink-900">Invalid invite link</h1>
        <p className="text-sm text-ink-500">
          This link is missing its token. Ask whoever invited you to send a new one from{" "}
          <Link href="/admin/team" className="text-ink-700 underline hover:text-ink-900">
            Team
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl text-ink-900">Set your password</h1>
      <p className="mb-6 text-sm text-ink-500">You&rsquo;ve been invited to the store console. Choose a password to finish setting up your account.</p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <input type="hidden" {...register("token")} />

        <div>
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" autoComplete="new-password" {...register("password")} />
          <PasswordStrengthMeter password={password} />
          {errors.password && <p className="mt-1 text-xs text-danger-600">{errors.password.message}</p>}
        </div>

        {serverError && <p className="text-sm text-danger-600">{serverError}</p>}

        <Button type="submit" variant="brass" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Setting up…" : "Set password & sign in"}
        </Button>
      </form>
    </div>
  );
}
