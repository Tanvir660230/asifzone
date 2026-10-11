/** Phase 9 (docs/PHASE_9_AUDIT.md D-8): e2e runs must never reach a live provider (SMS, email, courier, gateways, Meta). The
 * API under test has to be started with LIVE_PROVIDERS=off — it then blocks every outbound request to a non-local host
 * and reports `liveProviders: false` on /health. Anything else (live providers on, /health unreachable, an older API that
 * doesn't report the mode) stops the run before a single test executes. */
export default async function globalSetup(): Promise<void> {
  const api = process.env.E2E_API_URL ?? "http://localhost:4000";
  let body: { liveProviders?: unknown };
  try {
    const res = await fetch(`${api}/health`);
    body = (await res.json()) as { liveProviders?: unknown };
  } catch (err) {
    throw new Error(`[e2e safety] could not read ${api}/health to confirm live providers are off: ${err instanceof Error ? err.message : err}`);
  }
  if (body.liveProviders !== false) {
    throw new Error(
      `[e2e safety] the API at ${api} reports liveProviders=${JSON.stringify(body.liveProviders)} — start it with LIVE_PROVIDERS=off so no test can reach a real SMS/email/courier/payment/Meta provider.`,
    );
  }
}
