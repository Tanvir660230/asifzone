"use client";

import { useState, type ComponentProps } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";

/*
 * A second number the courier can call when the first is off or mistyped (owner, 2026-11-25). Many shoppers here carry
 * two SIMs. Hidden behind a quiet link so the form stays short; never required.
 */

const COPY = {
  en: { add: "Add another number", label: "Another number", hint: "The courier calls it if the first one doesn't answer." },
  bn: { add: "আরেকটা নম্বর দিন", label: "আরেকটা নম্বর", hint: "প্রথম নম্বরে না পেলে ডেলিভারিম্যান এই নম্বরে কল করবে।" },
} as const;

export function AltPhoneField({
  id,
  lang,
  error,
  inputProps,
  className,
}: {
  id: string;
  lang: "en" | "bn";
  error?: string;
  /** react-hook-form's register("altPhone"). */
  inputProps: ComponentProps<typeof Input>;
  className?: string;
}) {
  const t = COPY[lang];
  const [open, setOpen] = useState(Boolean(error));
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-9 items-center gap-1 text-sm font-medium text-fg-muted underline-offset-2 hover:text-fg hover:underline ${className ?? ""}`}
        data-testid="alt-phone-open"
      >
        <Plus size={14} aria-hidden="true" /> {t.add}
      </button>
    );
  }
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">
        {t.label}
      </label>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="01XXXXXXXXX"
        aria-invalid={!!error}
        aria-describedby={`${id}-hint`}
        autoFocus
        {...inputProps}
      />
      <p id={`${id}-hint`} className={error ? "mt-1 text-xs text-danger-600" : "mt-1 text-xs text-fg-muted"}>
        {error ?? t.hint}
      </p>
    </div>
  );
}
