"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { isPixelExcludedPath, trackingConfigured } from "@/lib/pixels";
import {
  getAdTrackingConsent,
  OPEN_CONSENT_PREFERENCES_EVENT,
  setAdTrackingConsent,
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
    if (!trackingConfigured) return;
    if (getAdTrackingConsent() === null) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT_PREFERENCES_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_PREFERENCES_EVENT, reopen);
  }, []);

  if (!open || !trackingConfigured || isPixelExcludedPath(pathname)) return null;

  const choose = (decision: AdTrackingConsent) => {
    setOpen(false);
    setAdTrackingConsent(decision);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Tracking preferences"
      className="glass fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-2xl border border-ink-200 p-4 shadow-floatLg sm:inset-x-6 sm:bottom-6"
    >
      <p className="text-sm text-ink-700">
        We&apos;d like to use advertising and analytics cookies (Meta, TikTok, Microsoft Clarity) to measure our ads and
        improve the shop. They only run if you allow them.{" "}
        <Link href="/privacy-policy" className="underline underline-offset-2 hover:text-ink-900">
          Privacy policy
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => choose("denied")}>
          Decline
        </Button>
        <Button size="sm" onClick={() => choose("granted")}>
          Allow
        </Button>
      </div>
    </div>
  );
}
