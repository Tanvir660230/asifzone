import { hasAdTrackingConsent } from "./consent";
import { publicRuntimeConfig } from "../runtime-config";

/** Microsoft Clarity (heatmaps / session recordings): the same consent gate as the ad pixels — nothing is downloaded
 * until the shopper accepts tracking. Inert until this installation's clarityId() is set (runtime configuration). Loaded by a script
 * element created from our own bundle (no inline snippet), which the nonce-based CSP's 'strict-dynamic' trusts. */
const clarityId = () => publicRuntimeConfig().clarityId;

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };

export function clarityConfigured(): boolean {
  return Boolean(clarityId());
}

export function loadClarity(): void {
  if (!clarityId() || typeof window === "undefined" || !hasAdTrackingConsent()) return;
  const w = window as unknown as { clarity?: ClarityFn };
  if (w.clarity) return;
  const queue: ClarityFn = (...args: unknown[]) => {
    (queue.q ??= []).push(args);
  };
  w.clarity = queue;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(clarityId())}`;
  document.head.appendChild(script);
}
