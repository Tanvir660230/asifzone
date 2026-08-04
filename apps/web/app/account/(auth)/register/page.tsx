"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { customerRegisterSchema, type CustomerRegisterInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerCustomer } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

export default function AccountRegisterPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerRegisterInput>({ resolver: zodResolver(customerRegisterSchema) });

  async function onSubmit(values: CustomerRegisterInput) {
    setServerError(null);
    try {
      await registerCustomer(values);
      router.replace("/account");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Registration failed, please try again");
    }
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl text-ink-900">Create an account</h1>
      <p className="mb-6 text-sm text-ink-500">Save addresses, track orders, and build a wishlist.</p>

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
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
          {errors.password && <p className="mt-1 text-xs text-danger-600">{errors.password.message}</p>}
        </div>

        {serverError && <p className="text-sm text-danger-600">{serverError}</p>}

        <Button type="submit" variant="brass" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-500">
        Already have an account?{" "}
        <Link href="/account/login" className="text-brass-600 underline hover:text-brass-500">
          Sign in
        </Link>
      </p>
    </div>
  );
}
