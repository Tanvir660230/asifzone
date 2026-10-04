"use client";

import { useQuery } from "@tanstack/react-query";
import { FormSection } from "@/components/admin/form-section";
import { getProviderStatus, type ProviderStatusEntry } from "@/lib/api/settings";

const CAPABILITY_LABEL: Record<ProviderStatusEntry["capability"], string> = {
  payments: "Online payment gateways",
  sms: "SMS",
  email: "Email",
  push: "Web push",
  courier: "Courier",
  serverEvents: "Meta Conversions API",
};

/** Phase 12 (D-4): read-only view of which provider backs each capability on this deployment. Provider choice and
 * credentials are deployment configuration (environment), not editable here — this only shows booleans. */
export function ProviderStatusPanel() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["provider-status"], queryFn: getProviderStatus });

  return (
    <FormSection title="Integrations" description="Which provider this store is connected to. Changed in the server configuration, not here.">
      {isLoading && <p className="text-sm text-ink-400">Loading…</p>}
      {isError && <p className="text-sm text-danger-600">Couldn&apos;t load the integration status.</p>}
      {data && (
        <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100">
          {data.providers.map((p) => {
            const state = !p.enabled ? "Off" : p.credentialsPresent ? "Connected" : "Missing credentials";
            const tone = !p.enabled ? "text-ink-400" : p.credentialsPresent ? "text-success-600" : "text-warning-600";
            return (
              <li key={p.capability} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span className="text-ink-900">{CAPABILITY_LABEL[p.capability]}</span>
                <span className="flex items-center gap-3">
                  <span className="text-ink-500">{p.enabled ? p.provider : "—"}</span>
                  <span className={`text-xs font-medium ${tone}`}>{state}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </FormSection>
  );
}
