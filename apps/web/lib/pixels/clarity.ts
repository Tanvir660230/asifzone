import { hasAdTrackingConsent } from "./consent";

/** Microsoft Clarity (heatmaps / session recordings): the same consent gate as the ad pixels — nothing is downloaded
 * until the shopper accepts tracking. Inert until NEXT_PUBLIC_CLARITY_ID is set at build time. Loaded by a script
 * element created from our own bundle (no inline snippet), which the nonce-based CSP's 'strict-dynamic' trusts. */
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID ?? "";

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };

export const clarityConfigured = Boolean(CLARITY_ID);

export function loadClarity(): void {
  if (!CLARITY_ID || typeof window === "undefined" || !hasAdTrackingConsent()) return;
  const w = window as unknown as { clarity?: ClarityFn };
  if (w.clarity) return;
  const queue: ClarityFn = (...args: unknown[]) => {
    (queue.q ??= []).push(args);
  };
  w.clarity = queue;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(CLARITY_ID)}`;
  document.head.appendChild(script);
}
