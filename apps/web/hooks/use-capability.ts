"use client";

import { useCallback } from "react";
import { can, CAPABILITIES, type Capability } from "@/lib/admin/capabilities";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { useProviderCapabilities } from "@/hooks/use-provider-capabilities";

/**
 * The admin capability checker (P1.3) — `const { can, ready } = useCapabilities()`. UX only: the API enforces every
 * permission itself. `ready` is false until the admin profile has loaded, so callers can avoid flashing a "not allowed"
 * state; until then every capability reads as unavailable.
 */
export function useCapabilities() {
  const { data } = useCurrentAdmin();
  const providers = useProviderCapabilities();
  const permissions = data?.admin.permissions;
  const check = useCallback(
    (capability: Capability) => can(capability, { permissions, providers }),
    // providers is a fresh object each render; its booleans are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissions, providers.courier, providers.sms, providers.email, providers.push],
  );
  return { can: check, ready: Boolean(data?.admin) };
}

/** One capability: `useCapability("orders.manage")`. */
export function useCapability(capability: Capability): boolean {
  return useCapabilities().can(capability);
}

/** Whether a capability depends on a provider — exported for screens that explain "configure the courier first". */
export function capabilityNeedsProvider(capability: Capability): boolean {
  return "provider" in CAPABILITIES[capability];
}
