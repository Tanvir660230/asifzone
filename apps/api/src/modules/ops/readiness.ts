/**
 * Liveness vs readiness (Phase 11, contract §6.4).
 *   GET /health        liveness — the process is up (unchanged; e2e tooling reads `liveProviders` from it).
 *   GET /health/ready  readiness — PostgreSQL answers, Redis answers, the outbox dispatcher is ticking. 200 / 503.
 * Read-only: readiness never repairs anything, and returns booleans only (no counts, ids or customer data).
 */
import { prisma } from "../../config/prisma";
import { queueConnection } from "../../lib/queue";
import { dispatcherHealthy } from "../../domain/outbox/processor";

export const READINESS_CHECK_TIMEOUT_MS = 2_000;

export interface ReadinessProbes {
  postgres: () => Promise<unknown>;
  redis: () => Promise<unknown>;
  outboxDispatcher: () => Promise<boolean>;
}

export const defaultProbes: ReadinessProbes = {
  postgres: () => prisma.$queryRaw`SELECT 1`,
  // The queue connection, not the cache client (whose very first command is dropped by design).
  redis: () => queueConnection.ping(),
  outboxDispatcher: () => dispatcherHealthy(),
};

async function check(probe: () => Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("readiness check timed out")), READINESS_CHECK_TIMEOUT_MS);
      }),
    ]);
    return result !== false;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readinessReport(probes: ReadinessProbes = defaultProbes) {
  const [postgres, redis, outboxDispatcher] = await Promise.all([check(probes.postgres), check(probes.redis), check(probes.outboxDispatcher)]);
  const checks = { postgres, redis, outboxDispatcher };
  return { ready: postgres && redis && outboxDispatcher, checks };
}
