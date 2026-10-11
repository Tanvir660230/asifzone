"use client";

import type { ReactNode } from "react";
import { setStoreConfig, type StoreConfigValue } from "@/lib/store-config";

/** Makes the store's currency and timezone (from the settings the root layout fetched) available to every formatter below
 * it. Set during render, so it is in place before any child — client render and SSR alike — formats a price or a date. */
export function StoreConfig({ currency, timezone, children }: StoreConfigValue & { children: ReactNode }) {
  setStoreConfig({ currency, timezone });
  return <>{children}</>;
}
