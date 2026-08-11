"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { unsubscribeFromEmailMarketing } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

export default function UnsubscribePage() {
  return (
    <Suspense>
      <UnsubscribeContent />
    </Suspense>
  );
}

type Status = "working" | "success" | "error";

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const customerId = searchParams.get("customerId") ?? "";
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<Status>(customerId && token ? "working" : "error");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId || !token) return;
    unsubscribeFromEmailMarketing({ customerId, token })
      .then(() => setStatus("success"))
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "Something went wrong, please try again");
      });
  }, [customerId, token]);

  if (status === "working") {
    return (
      <div>
        <h1 className="mb-1 font-display text-2xl text-ink-900">Unsubscribing…</h1>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div>
        <h1 className="mb-1 font-display text-2xl text-ink-900">You&rsquo;re unsubscribed</h1>
        <p className="mb-6 text-sm text-ink-500">
          You won&rsquo;t receive marketing emails from us anymore. You&rsquo;ll still get order and account emails.
        </p>
        <Link href="/" className="text-ink-700 underline hover:text-ink-900">
          Back to the store
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl text-ink-900">Couldn&rsquo;t unsubscribe</h1>
      <p className="mb-6 text-sm text-danger-600">{message ?? "This unsubscribe link is invalid."}</p>
      <Link href="/" className="text-ink-700 underline hover:text-ink-900">
        Back to the store
      </Link>
    </div>
  );
}
