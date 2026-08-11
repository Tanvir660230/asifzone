"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { verifyEmail } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}

type Status = "verifying" | "success" | "error";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<Status>(token ? "verifying" : "error");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    verifyEmail({ token })
      .then(() => setStatus("success"))
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "Something went wrong, please try again");
      });
  }, [token]);

  if (status === "verifying") {
    return (
      <div>
        <h1 className="mb-1 font-display text-2xl text-ink-900">Verifying your email…</h1>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div>
        <h1 className="mb-1 font-display text-2xl text-ink-900">Email verified</h1>
        <p className="mb-6 text-sm text-ink-500">Your email address has been confirmed.</p>
        <Link href="/account" className="text-ink-700 underline hover:text-ink-900">
          Go to your account
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl text-ink-900">Couldn&rsquo;t verify email</h1>
      <p className="mb-6 text-sm text-danger-600">{message ?? "This verification link is invalid or has expired."}</p>
      <Link href="/account" className="text-ink-700 underline hover:text-ink-900">
        Go to your account
      </Link>
    </div>
  );
}
