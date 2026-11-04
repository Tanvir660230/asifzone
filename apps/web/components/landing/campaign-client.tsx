"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { bn } from "@/lib/landing-content";
import { percentOffLabel, variantDisplayPrice } from "@/lib/pricing-display";
import { cn, isPaleColor } from "@/lib/utils";
import { colorImage, useLandingSelection } from "./landing-selection";

/** The price of what the shopper has chosen (the page's "from" price before a choice) — server-resolved numbers only. */
export function LandingLivePrice() {
  const { product, options, size, color } = useLandingSelection();
  const variant = options.resolve(size, color);
  // Before a choice: the lowest price among the variants this page offers, not the product's overall "from".
  const cheapest = variant ?? [...product.variants].sort((a, b) => Number(variantDisplayPrice(product, a.id).price) - Number(variantDisplayPrice(product, b.id).price))[0];
  const shown = variantDisplayPrice(product, cheapest?.id);
  const hasWas = shown.was !== null && Number(shown.was) > Number(shown.price);
  const off = hasWas ? percentOffLabel(shown.price, shown.was!) : null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-3xl font-bold tabular-nums text-fg" data-testid="landing-price">
        {formatPrice(shown.price)}
      </span>
      {hasWas && (
        <>
          <span className="text-lg tabular-nums text-fg-muted line-through">{formatPrice(shown.was!)}</span>
          {off !== null && <span className="rounded-[var(--chip-radius)] bg-sale-500 px-2.5 py-1 text-sm font-bold text-white">{bn(off)}% ছাড়</span>}
        </>
      )}
    </div>
  );
}

/** One tile per colour the page offers, with that colour's own photo; a tap chooses it and goes to the order form. */
export function LandingColorShowcase() {
  const { product, options, color, setColor, sellable } = useLandingSelection();
  if (!options.showColors) return null;
  const imageFor = (c: string) => colorImage(product, c);
  function choose(c: string) {
    setColor(c);
    document.getElementById("order")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="landing-colors">
      {options.colors.map((c) => {
        const img = imageFor(c);
        const hex = product.variants.find((v) => v.color === c)?.colorHex;
        const ok = sellable(null, c);
        const selected = color === c;
        return (
          <li key={c}>
            <button
              type="button"
              onClick={() => choose(c)}
              disabled={!ok}
              aria-pressed={selected}
              className={cn(
                "group block w-full overflow-hidden rounded-xl border bg-surface text-left transition-[border-color,box-shadow] duration-base ease-smooth active:scale-[0.99]",
                selected ? "border-ink-900 ring-1 ring-ink-900" : "border-line hover:border-line-strong",
                !ok && "cursor-not-allowed opacity-50",
              )}
            >
              <span className="relative block aspect-[4/5] bg-surface-muted">
                {img ? (
                  <Image src={resolveImageUrl(img.url)} alt={img.altText ?? `${product.name} — ${c}`} fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" />
                ) : hex ? (
                  <span className="absolute inset-0" style={{ backgroundColor: hex }} aria-hidden="true" />
                ) : null}
                {selected && (
                  <span className={cn("absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full", hex && isPaleColor(hex) ? "bg-ink-900 text-cream-50" : "bg-surface text-fg")}>
                    <Check size={16} strokeWidth={3} aria-hidden="true" />
                  </span>
                )}
              </span>
              <span className="flex items-center justify-between gap-2 px-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  {hex && <span className={cn("h-3.5 w-3.5 shrink-0 rounded-full", isPaleColor(hex) && "ring-1 ring-line-strong")} style={{ backgroundColor: hex }} aria-hidden="true" />}
                  <span className="truncate text-sm font-semibold text-fg">{c}</span>
                </span>
                {!ok && <span className="shrink-0 text-xs text-fg-muted">স্টকে নেই</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Days, hours, minutes and seconds left to `endsAt`; renders nothing once it has passed. */
export function LandingCountdown({ endsAt }: { endsAt: string }) {
  const end = new Date(endsAt).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Nothing until mounted: the server's clock and the visitor's would disagree on the seconds.
  if (now === null || now >= end) return null;
  const s = Math.floor((end - now) / 1000);
  const parts = [
    { v: Math.floor(s / 86400), l: "দিন" },
    { v: Math.floor((s % 86400) / 3600), l: "ঘণ্টা" },
    { v: Math.floor((s % 3600) / 60), l: "মিনিট" },
    { v: s % 60, l: "সেকেন্ড" },
  ];
  return (
    <div className="mt-5 flex justify-center gap-2" role="timer" aria-label="অফার শেষ হতে বাকি">
      {parts.map(({ v, l }) => (
        <span key={l} className="flex min-w-[4rem] flex-col items-center rounded-xl bg-surface px-3 py-2 shadow-sm">
          <span className="text-2xl font-bold tabular-nums text-fg">{bn(String(v).padStart(2, "0"))}</span>
          <span className="text-xs text-fg-muted">{l}</span>
        </span>
      ))}
    </div>
  );
}
