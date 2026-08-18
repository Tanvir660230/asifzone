"use client";

import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { adminLoginSchema, type AdminLoginInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/account/google-button";
import { OrDivider } from "@/components/account/or-divider";
import { loginAdmin, loginAdminWithGoogle } from "@/lib/auth";
import { ApiError } from "@/lib/api-client";
import { env } from "@/lib/env";

export default function LoginPage() {
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
  } = useForm<AdminLoginInput>({ resolver: zodResolver(adminLoginSchema) });

  function goToDashboard() {
    router.replace(searchParams.get("next") ?? "/admin/dashboard");
  }

  async function onSubmit(values: AdminLoginInput) {
    setServerError(null);
    try {
      await loginAdmin(values);
      goToDashboard();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Login failed, please try again");
    }
  }

  async function onGoogleCredential(idToken: string) {
    await loginAdminWithGoogle({ idToken });
    goToDashboard();
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl text-ink-900">Store Console</h1>
      <p className="mb-6 text-sm text-ink-500">Sign in to manage your store</p>

      {env.googleClientId && (
        <>
          <GoogleButton onCredential={onGoogleCredential} onError={setServerError} />
          <OrDivider />
        </>
      )}

      <form onSubmit={handleSubmit(onSubmit)} method="post" className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && <p className="mt-1 text-xs text-danger-600">{errors.email.message}</p>}
        </div>

        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
          {errors.password && <p className="mt-1 text-xs text-danger-600">{errors.password.message}</p>}
        </div>

        {serverError && <p className="text-sm text-danger-600">{serverError}</p>}

        <Button type="submit" variant="brass" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
