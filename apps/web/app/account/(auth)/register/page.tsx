"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { customerRegisterSchema, type CustomerRegisterInput, type Customer } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/account/password-input";
import { PasswordStrengthMeter } from "@/components/account/password-strength-meter";
import { GoogleButton } from "@/components/account/google-button";
import { PhoneOtpForm } from "@/components/account/phone-otp-form";
import { registerCustomer } from "@/lib/customer-auth";
import { mergeGuestWishlist } from "@/lib/wishlist-merge";
import { ApiError } from "@/lib/api-client";
import { env } from "@/lib/env";

type Mode = "email" | "phone";

export default function AccountRegisterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("email");
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CustomerRegisterInput>({ resolver: zodResolver(customerRegisterSchema) });

  const password = watch("password") ?? "";

  async function goToAccount() {
    // Awaited so anything wishlisted as a guest before registering shows up immediately once the
    // new account is created, rather than after a delayed background sync.
    await mergeGuestWishlist();
    queryClient.invalidateQueries({ queryKey: ["wishlist"] });
    router.replace("/account");
  }

  async function onSubmit(values: CustomerRegisterInput) {
    setServerError(null);
    try {
      await registerCustomer(values);
      goToAccount();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Registration failed, please try again");
    }
  }

  function onAltSuccess(_customer: Customer) {
    goToAccount();
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl text-ink-900">Create an account</h1>
      <p className="mb-6 text-sm text-ink-500">Save addresses, track orders, and build a wishlist.</p>

      {env.googleClientId && (
        <>
          <GoogleButton onSuccess={onAltSuccess} onError={setServerError} />
          <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-ink-400">
            <span className="h-px flex-1 bg-ink-200" />
            or continue with
            <span className="h-px flex-1 bg-ink-200" />
          </div>
        </>
      )}
      {serverError && <p className="mt-3 text-sm text-danger-600">{serverError}</p>}

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
            <Label htmlFor="name">Full name</Label>
            <Input id="name" autoComplete="name" {...register("name")} />
            {errors.name && <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>}
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
            {errors.email && <p className="mt-1 text-xs text-danger-600">{errors.email.message}</p>}
          </div>

          <div>
            <Label htmlFor="phone">Phone (optional)</Label>
            <Input id="phone" placeholder="01XXXXXXXXX" autoComplete="tel" {...register("phone")} />
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <PasswordInput id="password" autoComplete="new-password" {...register("password")} />
            <PasswordStrengthMeter password={password} />
            {errors.password && <p className="mt-1 text-xs text-danger-600">{errors.password.message}</p>}
          </div>

          <Button type="submit" variant="brass" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Creating account…" : "Create account"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-ink-500">
        Already have an account?{" "}
        <Link href="/account/login" className="text-ink-700 underline hover:text-ink-900">
          Sign in
        </Link>
      </p>
    </div>
  );
}
