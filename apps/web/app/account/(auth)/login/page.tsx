"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { customerLoginSchema, type CustomerLoginInput, type Customer } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PasswordInput } from "@/components/account/password-input";
import { GoogleButton } from "@/components/account/google-button";
import { PhoneOtpForm } from "@/components/account/phone-otp-form";
import { OrDivider } from "@/components/account/or-divider";
import { AuthModeToggle } from "@/components/account/auth-mode-toggle";
import { loginCustomer } from "@/lib/customer-auth";
import { mergeGuestWishlist } from "@/lib/wishlist-merge";
import { ApiError } from "@/lib/api-client";
import { env } from "@/lib/env";

export default function AccountLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

type Mode = "email" | "phone";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("email");
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerLoginInput>({
    resolver: zodResolver(customerLoginSchema),
    defaultValues: { rememberMe: true },
  });

  async function goToAccount() {
    // Awaited so a redirect straight back to /wishlist (e.g. from the "sign in" prompt on that
    // page) shows the merged items immediately rather than a stale, still-empty server list.
    await mergeGuestWishlist();
    queryClient.invalidateQueries({ queryKey: ["wishlist"] });
    router.replace(searchParams.get("next") ?? "/account");
  }

  async function onSubmit(values: CustomerLoginInput) {
    setServerError(null);
    try {
      await loginCustomer(values);
      goToAccount();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Login failed, please try again");
    }
  }

  function onAltSuccess(_customer: Customer) {
    goToAccount();
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl text-ink-900">Sign in</h1>
      <p className="mb-6 text-sm text-ink-500">Access your orders, addresses, and wishlist.</p>

      {env.googleClientId && (
        <>
          <GoogleButton onSuccess={onAltSuccess} onError={setServerError} />
          <OrDivider />
        </>
      )}
      {serverError && (
        <p role="alert" aria-live="polite" className="mt-3 text-sm text-danger-600">
          {serverError}
        </p>
      )}

      <AuthModeToggle mode={mode} onChange={setMode} />

      {mode === "phone" ? (
        <PhoneOtpForm onSuccess={onAltSuccess} />
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "email-error" : undefined}
              {...register("email")}
            />
            {errors.email && (
              <p id="email-error" className="mt-1 text-xs text-danger-600">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/account/forgot-password" className="text-xs text-ink-700 underline hover:text-ink-900">
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "password-error" : undefined}
              {...register("password")}
            />
            {errors.password && (
              <p id="password-error" className="mt-1 text-xs text-danger-600">
                {errors.password.message}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Checkbox {...register("rememberMe")} />
            Remember me
          </label>

          <Button type="submit" variant="brass" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-ink-500">
        New here?{" "}
        <Link href="/account/register" className="text-ink-700 underline hover:text-ink-900">
          Create an account
        </Link>
      </p>
    </div>
  );
}
