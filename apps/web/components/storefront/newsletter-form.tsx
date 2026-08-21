"use client";

import { useState, type FormEvent } from "react";
import { subscribeNewsletter } from "@/lib/api/newsletter";
import { cn } from "@/lib/utils";

interface NewsletterFormProps {
  variant?: "dark" | "light";
  /** Stack the input above the button instead of side-by-side — for narrow containers (e.g. one
   * column of a multi-column footer grid) where a side-by-side row has no room to breathe and
   * would otherwise overflow its container (a flex/grid item's default min-width is its content's
   * min-content size, not 0, so a row this wide doesn't just shrink to fit on its own). */
  stacked?: boolean;
  className?: string;
}

export function NewsletterForm({ variant = "dark", stacked = false, className }: NewsletterFormProps) {
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
    <div className={cn("min-w-0 max-w-sm", className)}>
      <form onSubmit={onSubmit} className={cn("flex min-w-0 gap-2", stacked && "flex-col")}>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          aria-label="Email address"
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
            "glossy h-10 rounded-full px-4 text-xs uppercase tracking-wide shadow-sm transition-all duration-200 ease-smooth active:scale-95 disabled:opacity-50 disabled:active:scale-100",
            stacked ? "w-full" : "shrink-0",
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
