"use client";

import { useQuery } from "@tanstack/react-query";
import { getProviderCapabilities, type ProviderCapabilities } from "@/lib/api/settings";

const NONE: ProviderCapabilities = { sms: false, email: false, push: false, courier: false, payments: { SSLCOMMERZ: false, EPS_PG: false } };

/**
 * Phase 12 D-4: which provider-backed admin actions can actually work on this deployment. An action backed by a provider
 * that is disabled, unselected or missing credentials is not offered. Until the answer arrives (or if it can't be read)
 * everything counts as unavailable, so an action never flashes up and then disappears.
 */
export function useProviderCapabilities(): ProviderCapabilities & { loaded: boolean } {
  const { data } = useQuery({ queryKey: ["provider-capabilities"], queryFn: getProviderCapabilities, staleTime: 5 * 60_000 });
  return { ...(data?.capabilities ?? NONE), loaded: Boolean(data) };
}
