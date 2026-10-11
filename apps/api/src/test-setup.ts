import { prisma } from "./config/prisma";
import { installUnfilteredDeleteGuard } from "./test-guard";
import { installNetworkGuard, liveProvidersEnabled } from "./lib/provider-guard";
import { env } from "./config/env";

// Runs before every test file: see test-guard.ts for why.
installUnfilteredDeleteGuard(prisma);

// Phase 9 (D-8): no automated test may reach a live provider, whatever credentials .env holds. A test that needs a provider
// response stubs `fetch` itself; anything else to a non-local host fails.
if (liveProvidersEnabled()) throw new Error("[test-setup] live providers must be disabled under test (NODE_ENV=test)");
installNetworkGuard();

// Redis db 0 is the one `pnpm dev` uses: a test there reads the dev API's cached reports and shares its job queue.
// vitest.config.ts moves tests to their own db; this catches a run that bypassed it (or a .env.test naming db 0).
if (["", "/", "/0"].includes(new URL(env.redisUrl).pathname)) {
  throw new Error(`[test-setup] tests must not use Redis db 0 (shared with pnpm dev) — got ${new URL(env.redisUrl).pathname || "/"}`);
}
