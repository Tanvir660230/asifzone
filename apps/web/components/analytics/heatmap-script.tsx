"use client";

import { useEffect } from "react";
import { loadClarity } from "@/lib/pixels/clarity";
import { onAdTrackingConsentChange } from "@/lib/pixels/consent";

/** "Heatmap ready": Microsoft Clarity, wired up the moment this installation's CLARITY_ID is set (runtime configuration,
 * lib/runtime-config.ts — no rebuild). Loads only once the shopper has accepted tracking — on first render if they
 * already had, or the moment they accept in the consent banner (lib/pixels/clarity.ts). Renders nothing. */
export function HeatmapScript() {
  useEffect(() => {
    loadClarity();
    return onAdTrackingConsentChange((decision) => {
      if (decision === "granted") loadClarity();
    });
  }, []);

  return null;
}
