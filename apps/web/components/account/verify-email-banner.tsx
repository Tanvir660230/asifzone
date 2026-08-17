"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useCurrentCustomer } from "@/hooks/use-current-customer";
import { resendVerificationEmail } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

export function VerifyEmailBanner() {
  const { data } = useCurrentCustomer();
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (dismissed || !data || data.customer.emailVerifiedAt) return null;

  async function resend() {
    setStatus("sending");
    try {
      await resendVerificationEmail();
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      console.error(err instanceof ApiError ? err.message : err);
    }
  }

  return (
    <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-ink-800">
      <span role="status" aria-live="polite">
        {status === "sent"
          ? "Verification email sent — check your inbox."
          : status === "error"
            ? "Couldn't resend the email — please try again."
            : "Please verify your email address to secure your account."}
      </span>
      <div className="flex shrink-0 items-center gap-3">
        {status !== "sent" && (
          <button
            type="button"
            onClick={resend}
            disabled={status === "sending"}
            className="font-medium text-warning-600 underline hover:text-warning-700 disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Resend email"}
          </button>
        )}
        <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-ink-400 hover:text-ink-700">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
