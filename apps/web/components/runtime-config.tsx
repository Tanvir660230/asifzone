"use client";

import type { ReactNode } from "react";
import type { PublicRuntimeConfig } from "@clothing-brand/shared";
import { setPublicRuntimeConfig } from "@/lib/runtime-config";

/** Hands this installation's public runtime configuration (read by the root layout on the server) to the browser. Set
 * during render, so it is in place before any child reads it — the same pattern as <StoreConfig>. */
export function RuntimeConfig({ value, children }: { value: PublicRuntimeConfig; children: ReactNode }) {
  setPublicRuntimeConfig(value);
  return <>{children}</>;
}
