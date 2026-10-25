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
import { loginAdmin, loginAdminTwoStep, loginAdminWithGoogle, needsTwoStep, type SignInResponse } from "@/lib/auth";
import { ApiError } from "@/lib/api-client";
import { publicRuntimeConfig } from "@/lib/runtime-config";

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
  // Set after the password (or Google) when this admin has 2-step sign-in on: the code step replaces the form.
  const [challenge, setChallenge] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AdminLoginInput>({ resolver: zodResolver(adminLoginSchema) });

  function goToDashboard() {
    router.replace(searchParams.get("next") ?? "/admin/dashboard");
  }

  function afterFirstStep(result: SignInResponse) {
    if (needsTwoStep(result)) setChallenge(result.challenge);
    else goToDashboard();
  }

  async function onSubmit(values: AdminLoginInput) {
    setServerError(null);
    try {
      afterFirstStep(await loginAdmin(values));
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Login failed, please try again");
    }
  }

  async function onGoogleCredential(idToken: string) {
    afterFirstStep(await loginAdminWithGoogle({ idToken }));
  }

  if (challenge) {
    return (
      <TwoStepForm
        challenge={challenge}
        onDone={goToDashboard}
        onRestart={() => {
          setChallenge(null);
          setServerError(null);
        }}
      />
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Sign in</h1>
      <p className="mb-7 mt-1 text-sm text-fg-muted">to manage your store</p>

      {publicRuntimeConfig().googleClientId && (
        <>
          <GoogleButton onCredential={onGoogleCredential} onError={setServerError} />
          <OrDivider />
        </>
      )}

      <form onSubmit={handleSubmit(onSubmit)} method="post" className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && <p className="ui-field-error">{errors.email.message}</p>}
        </div>

        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
          {errors.password && <p className="ui-field-error">{errors.password.message}</p>}
        </div>

        {serverError && <p className="text-sm text-danger-600">{serverError}</p>}

        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

/** The second step: a 6-digit code from the authenticator app, or one of the recovery codes. */
function TwoStepForm({ challenge, onDone, onRestart }: { challenge: string; onDone: () => void; onRestart: () => void }) {
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await loginAdminTwoStep(challenge, code);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work — try again");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Enter your code</h1>
      <p className="mb-7 mt-1 text-sm text-fg-muted">
        {useRecovery ? "Type one of the recovery codes you saved when you turned on 2-step sign-in. Each works once." : "Open your authenticator app and type the 6-digit code for this store."}
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="two-step-code">{useRecovery ? "Recovery code" : "Code"}</Label>
          <Input
            id="two-step-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            autoComplete="one-time-code"
            inputMode={useRecovery ? "text" : "numeric"}
            placeholder={useRecovery ? "xxxxx-xxxxx" : "123 456"}
            maxLength={useRecovery ? 20 : 7}
            className="text-center text-lg tracking-[0.3em] tabular-nums"
          />
        </div>
        {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={submitting || code.replace(/\s/g, "").length < 6}>
          {submitting ? "Checking…" : "Continue"}
        </Button>
      </form>
      <div className="mt-5 flex items-center justify-between gap-3 text-sm">
        <button
          type="button"
          className="text-left text-accent hover:underline"
          onClick={() => {
            setUseRecovery((v) => !v);
            setCode("");
            setError(null);
          }}
        >
          {useRecovery ? "Use the app's code" : "Lost your phone? Use a recovery code"}
        </button>
        <button type="button" className="shrink-0 text-fg-muted hover:text-fg" onClick={onRestart}>
          Start over
        </button>
      </div>
    </div>
  );
}
