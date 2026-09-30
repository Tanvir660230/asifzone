import { prisma } from "./config/prisma";
import { installUnfilteredDeleteGuard } from "./test-guard";
import { installNetworkGuard, liveProvidersEnabled } from "./lib/provider-guard";

// Runs before every test file: see test-guard.ts for why.
installUnfilteredDeleteGuard(prisma);

// Phase 9 (D-8): no automated test may reach a live provider, whatever credentials .env holds. A test that needs a provider
// response stubs `fetch` itself; anything else to a non-local host fails.
if (liveProvidersEnabled()) throw new Error("[test-setup] live providers must be disabled under test (NODE_ENV=test)");
installNetworkGuard();
