"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Moon, Smartphone, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseColorMode, setColorMode, shownColorMode, type ColorMode } from "@/lib/color-mode";

type Choice = ColorMode | "auto";

const CHOICES: { value: Choice; label: string; icon: typeof Sun }[] = [
  { value: "auto", label: "Auto (phone setting)", icon: Smartphone },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/**
 * Light or dark: a round button showing the mode the page is in, opening a small glass menu — Auto (follow the device),
 * Light, Dark. The choice applies at once and is remembered (lib/color-mode.ts); Auto forgets it.
 */
export function ModeToggle({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>("auto");
  const [shown, setShown] = useState<ColorMode>("light");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChoice(parseColorMode(document.documentElement.dataset.mode) ?? "auto");
    setShown(shownColorMode());
    // Auto follows the device live, as an iPhone switching at sunset does.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setShown(shownColorMode());
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function pick(value: Choice) {
    setColorMode(value === "auto" ? null : value);
    setChoice(value);
    setShown(shownColorMode());
    setOpen(false);
  }

  const Icon = shown === "dark" ? Moon : Sun;
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Light or dark" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={className}>
        <Icon size={20} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Light or dark" className="glass-panel absolute right-0 top-12 z-50 w-56 rounded-[1.125rem] p-1.5">
          {CHOICES.map(({ value, label, icon: ItemIcon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={choice === value}
              onClick={() => pick(value)}
              className={cn(
                "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[0.9375rem] text-fg transition-colors duration-150 ease-smooth hover:bg-ink-900/[0.06]",
                choice === value && "font-semibold",
              )}
            >
              <ItemIcon size={18} aria-hidden="true" className="text-fg-muted" />
              <span className="flex-1">{label}</span>
              {choice === value && <Check size={17} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
