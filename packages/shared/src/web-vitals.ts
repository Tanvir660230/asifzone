/**
 * Site health — real-visitor speed (Core Web Vitals). Shared by the storefront reporter (apps/web
 * components/analytics/web-vitals-reporter.tsx), the API that stores and summarises samples (apps/api modules/ops
 * web-vitals.*) and Admin › System health › Site speed. Thresholds are Google's published "good" / "poor" boundaries
 * (web.dev/articles/vitals), judged at the 75th percentile of visits.
 */

export const WEB_VITAL_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type WebVitalMetric = (typeof WEB_VITAL_METRICS)[number];

export const PAGE_KINDS = ["home", "category", "product", "search", "cart", "checkout", "landing", "account", "other"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const DEVICE_KINDS = ["mobile", "desktop"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export type VitalRating = "good" | "needs-improvement" | "poor";

/** LCP, INP, FCP, TTFB in milliseconds; CLS unitless. */
export const WEB_VITAL_THRESHOLDS: Record<WebVitalMetric, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

export function rateVital(metric: WebVitalMetric, value: number): VitalRating {
  const { good, poor } = WEB_VITAL_THRESHOLDS[metric];
  if (value <= good) return "good";
  if (value > poor) return "poor";
  return "needs-improvement";
}
