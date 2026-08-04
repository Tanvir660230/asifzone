"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { customerLoginSchema, type CustomerLoginInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginCustomer } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

export default function AccountLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerLoginInput>({ resolver: zodResolver(customerLoginSchema) });

  async function onSubmit(values: CustomerLoginInput) {
    setServerError(null);
    try {
      await loginCustomer(values);
      router.replace(searchParams.get("next") ?? "/account");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Login failed, please try again");
    }
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl text-ink-900">Sign in</h1>
      <p className="mb-6 text-sm text-ink-500">Access your orders, addresses, and wishlist.</p>

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
          <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
          {errors.password && <p className="mt-1 text-xs text-danger-600">{errors.password.message}</p>}
        </div>

        {serverError && <p className="text-sm text-danger-600">{serverError}</p>}

        <Button type="submit" variant="brass" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-500">
        New here?{" "}
        <Link href="/account/register" className="text-brass-600 underline hover:text-brass-500">
          Create an account
        </Link>
      </p>
    </div>
  );
}
