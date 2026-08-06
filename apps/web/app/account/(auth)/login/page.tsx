"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { customerLoginSchema, type CustomerLoginInput, type Customer } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PasswordInput } from "@/components/account/password-input";
import { GoogleButton } from "@/components/account/google-button";
import { PhoneOtpForm } from "@/components/account/phone-otp-form";
import { loginCustomer } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

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

  function goToAccount() {
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

      <GoogleButton onSuccess={onAltSuccess} onError={setServerError} />
      {serverError && <p className="mt-3 text-sm text-danger-600">{serverError}</p>}

      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-ink-400">
        <span className="h-px flex-1 bg-ink-200" />
        or continue with
        <span className="h-px flex-1 bg-ink-200" />
      </div>

      <div className="mb-4 flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setMode("email")}
          className={mode === "email" ? "font-medium text-ink-900 underline" : "text-ink-500 hover:text-ink-700"}
        >
          Email
        </button>
        <span className="text-ink-300">·</span>
        <button
          type="button"
          onClick={() => setMode("phone")}
          className={mode === "phone" ? "font-medium text-ink-900 underline" : "text-ink-500 hover:text-ink-700"}
        >
          Phone
        </button>
      </div>

      {mode === "phone" ? (
        <PhoneOtpForm onSuccess={onAltSuccess} />
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
            {errors.email && <p className="mt-1 text-xs text-danger-600">{errors.email.message}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/account/forgot-password" className="text-xs text-brass-600 underline hover:text-brass-500">
                Forgot password?
              </Link>
            </div>
            <PasswordInput id="password" autoComplete="current-password" {...register("password")} />
            {errors.password && <p className="mt-1 text-xs text-danger-600">{errors.password.message}</p>}
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
        <Link href="/account/register" className="text-brass-600 underline hover:text-brass-500">
          Create an account
        </Link>
      </p>
    </div>
  );
}
