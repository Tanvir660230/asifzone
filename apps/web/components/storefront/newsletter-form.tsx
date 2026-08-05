"use client";

import { useState, type FormEvent } from "react";
import { subscribeNewsletter } from "@/lib/api/newsletter";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function NewsletterForm({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      await subscribeNewsletter(email);
      setStatus("done");
      setEmail("");
    } catch (err) {
      setStatus("error");
      void err;
    }
  }

  if (status === "done") {
    return (
      <p className={cn("text-sm", variant === "dark" ? "text-brass-300" : "text-brass-600")}>
        You&rsquo;re subscribed — thanks for joining.
      </p>
    );
  }

  return (
    <div className="max-w-sm">
      <form onSubmit={onSubmit} className="flex min-w-0 gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className={cn(
            "h-10 min-w-0 flex-1 rounded-full border bg-transparent px-4 text-sm transition-colors duration-200 ease-smooth placeholder:opacity-60",
            variant === "dark"
              ? "border-cream-50/20 text-cream-50 focus:border-brass-400"
              : "border-ink-300 text-ink-900 focus:border-brass-400",
          )}
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className={cn(
            "glossy h-10 shrink-0 rounded-full px-4 text-xs uppercase tracking-wide shadow-sm transition-all duration-200 ease-smooth active:scale-95 disabled:opacity-50 disabled:active:scale-100",
            variant === "dark" ? "bg-brass-400 text-ink-900 hover:bg-brass-500" : "bg-ink-900 text-cream-50 hover:bg-ink-800",
          )}
        >
          {status === "loading" ? "…" : "Subscribe"}
        </button>
      </form>
      {status === "error" && <p className="mt-2 text-xs text-danger-600">Something went wrong — try again.</p>}
    </div>
  );
}
