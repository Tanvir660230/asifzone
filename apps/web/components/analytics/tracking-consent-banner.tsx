"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { storeLayout } from "@/lib/theme-layout";
import { configuredTrackerNames, isPixelExcludedPath, trackingConfigured } from "@/lib/pixels";
import {
  getAdTrackingConsent,
  OPEN_CONSENT_PREFERENCES_EVENT,
  setAdTrackingConsent,
  trackingConsentMode,
  type AdTrackingConsent,
} from "@/lib/pixels/consent";

/** Asks the shopper once whether advertising and analytics trackers (Meta / TikTok pixels, Clarity) may run. The answer is
 * the one consent decision `hasAdTrackingConsent()` reads (lib/pixels/consent.ts); until it is given nothing is tracked.
 * Shown only when this build has a tracker configured, never on admin or preview screens. The footer's "Tracking
 * preferences" link reopens it. */
export function TrackingConsentBanner() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!trackingConfigured()) return;
    if (getAdTrackingConsent() === null) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT_PREFERENCES_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_PREFERENCES_EVENT, reopen);
  }, []);

  if (!open || !trackingConfigured() || isPixelExcludedPath(pathname)) return null;

  const notice = trackingConsentMode() === "notice";
  // Only the trackers this store actually runs — naming one that isn't set up would be untrue.
  const trackers = configuredTrackerNames().join(", ");

  const choose = (decision: AdTrackingConsent) => {
    setOpen(false);
    setAdTrackingConsent(decision);
  };

  if (storeLayout() === "tahafi") {
    // The tahafi preset: one calm row above the dock — two short lines and two buttons, a fixed height so a font swap
    // can't reshape it (the old card grew and shrank as it loaded, moving the page), and solid rather than blurred.
    return (
      <div
        role="dialog"
        aria-live="polite"
        aria-label="Tracking preferences"
        className="solid-panel fixed inset-x-3 bottom-[calc(var(--dock-offset)+0.75rem)] z-50 mx-auto flex h-[3.75rem] max-w-xl items-center gap-2 rounded-full py-2 pl-4 pr-2 shadow-floatLg sm:bottom-[calc(var(--dock-offset)+1.5rem)]"
      >
        <p className="line-clamp-2 min-w-0 flex-1 text-[0.8125rem] leading-snug text-fg-muted">
          {notice ? "We use cookies to measure our ads." : "May we use cookies to measure our ads?"}{" "}
          <Link href="/privacy-policy" className="text-fg underline underline-offset-2">
            Privacy
          </Link>
        </p>
        <Button variant="ghost" size="sm" className="shrink-0 whitespace-nowrap px-3" onClick={() => choose("denied")}>
          Decline
        </Button>
        <Button size="sm" className="shrink-0 whitespace-nowrap px-4" onClick={() => choose("granted")}>
          {notice ? "OK" : "Allow"}
        </Button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Tracking preferences"
      className="glass fixed inset-x-3 bottom-[calc(var(--dock-offset)+0.75rem)] z-50 mx-auto max-w-2xl rounded-2xl border border-ink-200 p-3.5 shadow-floatLg sm:inset-x-6 sm:bottom-[calc(var(--dock-offset)+1.5rem)] sm:flex sm:items-center sm:gap-4 sm:p-4"
    >
      {/* Short enough to stay a strip at the bottom of a phone instead of covering half the page. */}
      <p className="text-sm text-ink-700 sm:flex-1">
        {notice
          ? `We use cookies (${trackers}) to measure our ads and improve the shop. You can decline.`
          : `May we use cookies (${trackers}) to measure our ads and improve the shop?`}{" "}
        <Link href="/privacy-policy" className="underline underline-offset-2 hover:text-ink-900">
          Privacy policy
        </Link>
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-0 sm:flex sm:shrink-0">
        <Button variant="outline" size="sm" onClick={() => choose("denied")}>
          Decline
        </Button>
        <Button size="sm" onClick={() => choose("granted")}>
          {notice ? "OK" : "Allow"}
        </Button>
      </div>
    </div>
  );
}
