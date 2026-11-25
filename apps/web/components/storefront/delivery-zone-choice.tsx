"use client";

import { bdZoneChoiceLabel, estimateDelivery, isInsideDhaka, type QuoteDto } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";

/*
 * Inside / outside Dhaka, asked only when it changes the price: the address names no district or thana (both optional)
 * and the zones cost different amounts for this cart. A free delivery — or a district already known — asks nothing.
 */

type Choice = NonNullable<QuoteDto["zoneChoices"]>[number];

const COPY = {
  en: { label: "Where should we deliver?", days: (a: number, b: number) => `${a}–${b} days`, free: "Free" },
  bn: { label: "কোথায় ডেলিভারি হবে?", days: (a: number, b: number) => `${a}–${b} দিন`, free: "ফ্রি" },
} as const;

export function DeliveryZoneChoice({
  id,
  lang,
  choices,
  value,
  onChange,
  error,
}: {
  id: string;
  lang: "en" | "bn";
  choices: Choice[];
  value: string;
  onChange: (key: string) => void;
  error?: string | null;
}) {
  const t = COPY[lang];
  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined} data-testid="delivery-zone-choice">
      <legend className="mb-1.5 text-sm font-medium text-fg">{t.label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {choices.map((c) => {
          const inside = c.districts.length > 0 && c.districts.every((d) => isInsideDhaka(d));
          const est = estimateDelivery(inside ? c.districts[0]! : "");
          const selected = value === c.key;
          return (
            <label
              key={c.key}
              className={cn(
                "flex min-h-14 cursor-pointer flex-col justify-center rounded-xl border px-3 py-2.5 transition-colors",
                selected ? "border-fg bg-surface ring-1 ring-fg" : "border-line bg-surface hover:border-line-strong",
                error && !value && "border-danger-600",
              )}
            >
              <input type="radio" name={id} value={c.key} checked={selected} onChange={() => onChange(c.key)} className="sr-only" />
              <span className="text-sm font-semibold text-fg">{bdZoneChoiceLabel(c, choices, lang)}</span>
              <span className="text-xs text-fg-muted">
                {c.waived ? t.free : formatPrice(c.charged)} · {t.days(est.minDays, est.maxDays)}
              </span>
            </label>
          );
        })}
      </div>
      {error && !value && (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger-600">
          {error}
        </p>
      )}
    </fieldset>
  );
}
