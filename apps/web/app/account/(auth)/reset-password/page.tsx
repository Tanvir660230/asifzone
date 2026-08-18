"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPasswordSchema, type ResetPasswordInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/account/password-input";
import { PasswordStrengthMeter } from "@/components/account/password-strength-meter";
import { resetPassword } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token },
  });
  const password = watch("password") ?? "";

  async function onSubmit(values: ResetPasswordInput) {
    setServerError(null);
    try {
      await resetPassword(values);
      router.replace("/account/login");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Something went wrong, please try again");
    }
  }

  if (!token) {
    return (
      <div>
        <h1 className="mb-1 font-display text-2xl text-ink-900">Invalid link</h1>
        <p className="text-sm text-ink-500">
          This reset link is missing its token. Please request a new one from the{" "}
          <Link href="/account/forgot-password" className="text-ink-700 underline hover:text-ink-900">
            forgot password
          </Link>{" "}
          page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl text-ink-900">Reset password</h1>
      <p className="mb-6 text-sm text-ink-500">Choose a new password for your account.</p>

      <form onSubmit={handleSubmit(onSubmit)} method="post" className="space-y-4">
        <input type="hidden" {...register("token")} />

        <div>
          <Label htmlFor="password">New password</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            autoFocus
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          <PasswordStrengthMeter password={password} />
          {errors.password && (
            <p id="password-error" className="mt-1 text-xs text-danger-600">
              {errors.password.message}
            </p>
          )}
        </div>

        {serverError && (
          <p role="alert" aria-live="polite" className="text-sm text-danger-600">
            {serverError}
          </p>
        )}

        <Button type="submit" variant="brass" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Updating…" : "Update password"}
        </Button>
      </form>
    </div>
  );
}
