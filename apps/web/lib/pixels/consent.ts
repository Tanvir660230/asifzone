/** The single tracking-consent gate for the storefront: every ad pixel (lib/pixels/) and the Clarity heatmap script ask
 * `hasAdTrackingConsent()` before anything loads or fires. The decision is the shopper's, made in the consent banner
 * (components/analytics/tracking-consent-banner.tsx) and kept in this browser. Until they choose, nothing is tracked
 * or downloaded — no decision means no consent. First-party, aggregate analytics to our own API (PageViewTracker) and
 * functional widgets (live chat) are not third-party tracking and are not gated here.
 *
 * Bump the key's version to ask everyone again (e.g. when a new kind of tracker is added). */
export type AdTrackingConsent = "granted" | "denied";

const STORAGE_KEY = "az_tracking_consent_v1";
const CHANGE_EVENT = "az:tracking-consent";

export function getAdTrackingConsent(): AdTrackingConsent | null {
  try {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null; // storage blocked (private mode, cookies off): treated as no decision
  }
}

export function hasAdTrackingConsent(): boolean {
  return getAdTrackingConsent() === "granted";
}

export function setAdTrackingConsent(decision: AdTrackingConsent): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, decision);
  } catch {
    // can't persist — the choice still applies to this page view through the event below
  }
  window.dispatchEvent(new CustomEvent<AdTrackingConsent>(CHANGE_EVENT, { detail: decision }));
}

/** Calls `listener` whenever the shopper makes or changes their choice in this tab. Returns the unsubscribe. */
export function onAdTrackingConsentChange(listener: (decision: AdTrackingConsent) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<AdTrackingConsent>).detail);
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/** Asks the banner to open again (the footer's "Tracking preferences" link). */
export const OPEN_CONSENT_PREFERENCES_EVENT = "az:open-tracking-consent";

export function openTrackingPreferences(): void {
  window.dispatchEvent(new Event(OPEN_CONSENT_PREFERENCES_EVENT));
}
