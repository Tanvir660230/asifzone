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
            "h-12 min-w-0 flex-1 rounded-full border bg-transparent px-5 text-sm transition-colors duration-200 ease-smooth placeholder:opacity-60",
            variant === "dark"
              ? "border-cream-50/25 text-cream-50 focus:border-cream-50/70 focus:outline-none"
              : "border-ink-300 text-ink-900 focus:border-brass-400",
          )}
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className={cn(
            "h-12 rounded-full px-6 text-sm font-medium transition-[transform,opacity] duration-200 ease-smooth hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100",
            stacked ? "w-full" : "shrink-0",
            // On the dark band the theme's band accent if it has one, else white; a light band mirrors it automatically.
            variant === "dark" ? "bg-[color:var(--band-accent,rgb(var(--color-cream-50)))] text-ink-950" : "bg-ink-900 text-cream-50 hover:bg-ink-800",
          )}
        >
          {status === "loading" ? "…" : "Subscribe"}
        </button>
      </form>
      {status === "error" && <p role="alert" className={cn("mt-2 text-xs", variant === "dark" ? "text-danger-200" : "text-danger-600")}>Something went wrong — try again.</p>}
    </div>
  );
}
