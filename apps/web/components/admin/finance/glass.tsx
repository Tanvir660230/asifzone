"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { formatPrice, storeCurrencySymbol } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Money "Liquid Glass" building blocks (owner, 2026-10-31): every everyday entry is a few taps — a big amount, then
 * choices shown as chips instead of drop-downs. Styling is the .liquid-* recipes in globals.css (finance only).
 */

/** The amount first and large, like Apple Pay: the currency sign, then the figure, nothing else competing. */
export function AmountInput({ id, value, onChange, label = "Amount", autoFocus, error }: { id: string; value: string; onChange: (v: string) => void; label?: string; autoFocus?: boolean; error?: string }) {
  return (
    <div className="text-center">
      <label htmlFor={id} className="text-sm text-fg-muted">{label}</label>
      {/* the whole row focuses the field: the input is only as wide as the number */}
      <label htmlFor={id} className={cn("mx-auto mt-1 flex max-w-xs cursor-text items-baseline justify-center gap-1 rounded-2xl px-3 py-2", error && "ring-2 ring-danger-500/60")}>
        <span className="text-3xl font-semibold text-fg-muted" aria-hidden="true">{storeCurrencySymbol()}</span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          style={{ width: `${Math.max(value.length, 1) + 0.6}ch` }}
          className="min-w-0 max-w-full bg-transparent text-left text-[2.75rem] font-semibold leading-none tracking-tight tabular-nums text-fg outline-none placeholder:text-ink-300"
          data-testid={`${id}-input`}
          data-display=""
        />
      </label>
      {error && <p id={`${id}-error`} className="mt-1 text-sm text-danger-600">{error}</p>}
    </div>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

/** One choice out of a few, as tappable chips (a radio group: arrow keys move, Space/Enter picks). */
export function ChoiceChips<T extends string>({ label, hint, options, value, onChange, testId, className }: { label: string; hint?: ReactNode; options: Array<Choice<T>>; value: T | ""; onChange: (v: T) => void; testId?: string; className?: string }) {
  const labelId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.filter((o) => !o.disabled);
  const move = (e: KeyboardEvent, i: number) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta || !enabled.length) return;
    e.preventDefault();
    const at = enabled.findIndex((o) => o.value === options[i]!.value);
    const next = enabled[(at + delta + enabled.length) % enabled.length]!;
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  };
  const tabStop = value && options.some((o) => o.value === value && !o.disabled) ? value : enabled[0]?.value;
  return (
    <div className={className}>
      <p id={labelId} className="mb-2 text-sm font-medium text-fg">{label}</p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2" data-testid={testId}>
        {options.map((o, i) => (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={o.disabled}
            tabIndex={o.value === tabStop ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => move(e, i)}
            className="liquid-chip disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="min-w-0">
              <span className="block font-medium">{o.label}</span>
              {o.hint && <span className="block text-xs text-fg-muted tabular-nums">{o.hint}</span>}
            </span>
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

/** Which money account (cash box, bank, bKash…) — each chip shows what it holds now. */
export function AccountChips({ label, accounts, value, onChange, showBalance = true, extra = [], hint, empty, testId }: {
  label: string;
  accounts: Array<{ id: string; name: string; currentBalance: number }>;
  value: string;
  onChange: (id: string) => void;
  showBalance?: boolean;
  /** Choices before the accounts (e.g. the owner's own money). */
  extra?: Array<Choice<string>>;
  hint?: ReactNode;
  empty?: ReactNode;
  testId?: string;
}) {
  if (!accounts.length && !extra.length) return <div><p className="mb-1 text-sm font-medium text-fg">{label}</p><p className="text-sm text-fg-muted">{empty}</p></div>;
  return (
    <ChoiceChips
      label={label}
      hint={hint}
      value={value}
      onChange={onChange}
      testId={testId}
      options={[...extra, ...accounts.map((a) => ({ value: a.id, label: a.name, hint: showBalance ? formatPrice(a.currentBalance) : undefined }))]}
    />
  );
}
