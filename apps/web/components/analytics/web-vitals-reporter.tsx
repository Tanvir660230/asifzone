"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { WEB_VITAL_METRICS, type DeviceKind, type PageKind, type WebVitalMetric } from "@clothing-brand/shared";
import { sendBeaconJson } from "@/lib/beacon";
import { pageKindFromPath } from "@/lib/page-kind";
import { apiBaseUrl } from "@/lib/runtime-config";

/** Site health › Site speed: sends this visit's Core Web Vitals (anonymous: metric, value, kind of page, phone or
 * computer) to POST /api/v1/vitals. Queued and sent in one beacon when the tab is hidden or the queue holds 10, so a
 * visit costs one request. Admin and product-preview pages are not measured. Renders nothing. */

interface Sample {
  metric: WebVitalMetric;
  value: number;
  pageKind: PageKind;
  device: DeviceKind;
}

const MAX_BATCH = 10;
const queue: Sample[] = [];
/** The page this visit loaded on. LCP, CLS and INP are reported late (on the first tap, or when the tab is hidden) —
 * often after the shopper has moved to another page in the app — but they describe the page that was loaded, so that
 * is the page they are filed under (the same way Google's field data attributes them). */
const landingPath = typeof window !== "undefined" ? window.location.pathname : "/";

function flush() {
  if (queue.length === 0) return;
  sendBeaconJson(`${apiBaseUrl()}/api/v1/vitals`, { samples: queue.splice(0, MAX_BATCH) });
}

const isMetric = (name: string): name is WebVitalMetric => (WEB_VITAL_METRICS as readonly string[]).includes(name);

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (!isMetric(metric.name) || !Number.isFinite(metric.value)) return;
    const pageKind = pageKindFromPath(landingPath);
    if (!pageKind) return;
    const device: DeviceKind = window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop";
    queue.push({ metric: metric.name, value: Math.min(Math.max(metric.value, 0), metric.name === "CLS" ? 10 : 60_000), pageKind, device });
    if (queue.length >= MAX_BATCH) flush();
  });

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  return null;
}
