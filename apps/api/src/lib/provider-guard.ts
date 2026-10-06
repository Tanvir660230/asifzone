/**
 * External-provider isolation (Phase 9, docs/PHASE_9_AUDIT.md D-8). Automated tests and e2e runs must never reach a live
 * provider (SMS, email, courier, payment gateways, Meta, AI), whatever credentials happen to be in the environment.
 *
 * `liveProvidersEnabled()` is false under vitest (NODE_ENV=test) and whenever the API is started with LIVE_PROVIDERS=off
 * (the e2e server). Then:
 *   - SMS and email adapters run in their dev mode (log / .devmail), Meta CAPI is disabled;
 *   - `installNetworkGuard()` makes every outbound HTTP(S) request to a non-local host fail — covering `fetch`, the
 *     `http`/`https` modules (EPS) and SDKs built on them — so a forgotten adapter can't slip through either.
 * `/api/health` reports the mode, and Playwright's global setup refuses to run against an API with live providers.
 */
import http from "node:http";
import https from "node:https";

export class LiveProviderBlockedError extends Error {
  readonly retryable = false;
  constructor(host: string) {
    super(`[provider-guard] outbound request to ${host} blocked — live providers are disabled in this environment`);
    this.name = "LiveProviderBlockedError";
  }
}

export function liveProvidersEnabled(): boolean {
  return process.env.NODE_ENV !== "test" && process.env.LIVE_PROVIDERS !== "off";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
let installed = false;

export function networkGuardInstalled(): boolean {
  return installed;
}

function hostOf(target: unknown): string | null {
  try {
    if (typeof target === "string") return new URL(target).hostname;
    if (target instanceof URL) return target.hostname;
    if (target && typeof target === "object") {
      const t = target as { url?: unknown; hostname?: unknown; host?: unknown };
      if (typeof t.url === "string") return new URL(t.url).hostname;
      if (typeof t.hostname === "string") return t.hostname;
      if (typeof t.host === "string") return t.host.split(":")[0]!;
    }
  } catch {
    return null;
  }
  return null;
}

/** Patches fetch and http(s).request/get to refuse non-local hosts. Idempotent. `allowHosts` adds internal hosts (e.g. the
 * web app the API revalidates). */
export function installNetworkGuard(allowHosts: string[] = []): void {
  if (installed) return;
  installed = true;
  const allowed = new Set([...LOCAL_HOSTS, ...allowHosts]);
  const blocked = (host: string | null) => host !== null && !allowed.has(host);

  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const host = hostOf(input);
    if (blocked(host)) return Promise.reject(new LiveProviderBlockedError(host!));
    return realFetch(input, init);
  }) as typeof fetch;

  for (const mod of [http, https] as const) {
    for (const method of ["request", "get"] as const) {
      const original = mod[method] as (...args: unknown[]) => http.ClientRequest;
      (mod as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        const host = hostOf(args[0]);
        if (blocked(host)) throw new LiveProviderBlockedError(host!);
        return original.apply(mod, args);
      };
    }
  }
}

/**
 * Live payment gateways are a production-only setting (P0-05). Outside NODE_ENV=production `EPS_SANDBOX=false` or
 * `SSLCOMMERZ_IS_LIVE=true` refuses to start, so a dev, test or demo process can never charge through a live merchant
 * account — even with live credentials copied into its .env. Production gets them from the deploy secrets
 * (docs/DEPLOYMENT.md), never from a file in the working tree. Called by config/env.ts at startup.
 */
export function assertPaymentGatewayMode(nodeEnv: string, gateways: { epsLive: boolean; sslcommerzLive: boolean }): void {
  if (nodeEnv === "production") return;
  const live = [gateways.epsLive && "EPS_SANDBOX=false", gateways.sslcommerzLive && "SSLCOMMERZ_IS_LIVE=true"].filter(Boolean);
  if (live.length) {
    throw new Error(
      `[provider-guard] refusing to start: ${live.join(" and ")} selects a live payment gateway, which only NODE_ENV=production ` +
        `may use (NODE_ENV="${nodeEnv}"). Use the sandbox gateways and sandbox credentials outside production.`,
    );
  }
}
