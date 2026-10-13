"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DesignAnnouncement } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";

const ROTATE_MS = 5000;

const TONE: Record<NonNullable<DesignAnnouncement["tone"]>, string> = {
  // A dark band: follows the theme's (or the store's) band palette like every other dark section.
  dark: "ui-band-inverse bg-ink-950 text-cream-50",
  accent: "bg-accent text-accent-fg",
  light: "border-b border-line-subtle bg-surface-muted text-fg",
};

/**
 * The thin strip above the header (Storefront Studio → Site design → Announcement bar): one to three short messages,
 * each optionally a link. Several messages take turns every 5 seconds, pausing while the pointer or keyboard focus is on
 * the bar, and never move on their own for a reader who prefers reduced motion (the arrows still step through them).
 */
export function AnnouncementBar({ announcement }: { announcement: DesignAnnouncement | null | undefined }) {
  const messages = announcement?.enabled ? (announcement.messages ?? []).filter((m) => m.text?.trim()) : [];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = messages.length;

  useEffect(() => {
    if (count < 2 || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(t);
  }, [count, paused]);

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;
  const tone = announcement?.tone ?? "dark";
  const current = index % count;
  const active = messages[current]!;
  const step = (by: number) => setIndex((i) => (i + by + count) % count);

  return (
    <div
      data-band="announcement"
      role="region"
      aria-label="Announcements"
      className={cn("relative", TONE[tone])}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="mx-auto flex min-h-9 max-w-7xl items-center justify-center gap-2 px-10 py-2 text-center text-xs font-medium sm:text-sm">
        {/* Only the current message is in the page (a hidden one's link must not take keyboard focus); the key change
            replays the fade-in each turn. */}
        <p key={current} className="animate-fade-in">
          {active.href ? (
            <Link href={active.href} className="underline-offset-4 hover:underline">
              {active.text}
            </Link>
          ) : (
            active.text
          )}
        </p>
      </div>
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous announcement"
            className="absolute left-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full opacity-70 hover:opacity-100"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next announcement"
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full opacity-70 hover:opacity-100"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}
