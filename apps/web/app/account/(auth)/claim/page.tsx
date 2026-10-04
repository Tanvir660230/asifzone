"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { confirmCustomerClaim } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

/** Phase 11 (BD-11.6 a): the link emailed when someone registers with an email an existing guest record already holds.
 * Following it proves the email; only then does the new password attach to that record (with its order history). */
export default function ClaimAccountPage() {
  return (
    <Suspense>
      <ClaimAccountContent />
    </Suspense>
  );
}

type Status = "confirming" | "error";

function ClaimAccountContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<Status>(token ? "confirming" : "error");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // single-use link: never submit twice (e.g. React strict-mode double effects)
    confirmCustomerClaim({ token })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["current-customer"] });
        router.replace("/account");
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "Something went wrong, please try again");
      });
  }, [token, router, queryClient]);

  if (status === "confirming") {
    return (
      <div>
        <h1 className="mb-1 font-display text-2xl text-ink-900">Confirming your account…</h1>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl text-ink-900">Couldn&rsquo;t confirm your account</h1>
      <p className="mb-6 text-sm text-danger-600">{message ?? "This link is invalid or has expired."}</p>
      <Link href="/account/login" className="text-ink-700 underline hover:text-ink-900">
        Back to sign in
      </Link>
    </div>
  );
}
