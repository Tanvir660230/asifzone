"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ─────────────────────────── SegmentedControl ───────────────────────────
   A small set of mutually exclusive options that switch a view in place (chart range, login
   method, device preview). Toggle buttons with aria-pressed; Arrow keys move between options. */

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is icon-only. */
  ariaLabel?: string;
  testId?: string;
}

interface SegmentedControlProps<T extends string | number> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  size?: "sm" | "md";
  className?: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line-subtle bg-ink-900/[0.035] p-1", className)}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            aria-pressed={active}
            aria-label={option.ariaLabel}
            data-testid={option.testId}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,box-shadow] duration-base ease-smooth",
              size === "sm" ? "px-3.5 py-1.5 text-xs" : "px-4 py-2 text-sm",
              active ? "bg-surface text-fg shadow-float ring-1 ring-ink-900/[0.06]" : "text-fg-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── NavTabs ───────────────────────────
   Route-level tabs: each tab is a real link to its own page (admin sub-navigation). The active tab
   is the one whose href prefixes the current path. */

export interface NavTab {
  label: string;
  href: string;
}

interface NavTabsProps {
  tabs: readonly NavTab[];
  /** One non-wrapping, horizontally scrolling row — for long tab sets on narrow screens. */
  scrollable?: boolean;
  className?: string;
  "aria-label"?: string;
  /** The active tab's href when the caller knows it (the navigation manifest resolves it exactly) — otherwise the tab
   * whose href prefixes the current path is active. */
  activeHref?: string;
}

export function NavTabs({ tabs, scrollable = false, className, "aria-label": ariaLabel = "Section navigation", activeHref }: NavTabsProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("flex gap-1 border-b border-line-subtle", scrollable ? "overflow-x-auto" : "flex-wrap", className)}
    >
      {tabs.map((t) => {
        const active = activeHref !== undefined ? t.href === activeHref : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium transition-colors duration-fast ease-smooth sm:px-4",
              active ? "border-accent text-fg" : "border-transparent text-fg-subtle hover:border-line-strong hover:text-ink-700",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
