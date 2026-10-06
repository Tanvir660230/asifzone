import { defineConfig } from "vitest/config";
import { config as parseEnvFile } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// If apps/api/.env.test exists (git-ignored, like .env — see .env.test.example for how to set one up),
// point every test run at the database it names instead of whatever DATABASE_URL a developer's own
// .env or shell environment already has. Parsed here (not loaded into this process's env) so it only
// ever reaches Vitest's `test.env`, below — never `pnpm dev` or anything else.
const testEnvPath = resolve(__dirname, ".env.test");
const testEnv = existsSync(testEnvPath) ? (parseEnvFile({ path: testEnvPath, processEnv: {} }).parsed ?? {}) : {};

// Tests get their own Redis logical database on whatever Redis server dev uses. Cache entries (keyed by report, not by
// database), order/payment locks and the BullMQ queue all live in Redis, so sharing db 0 with a running `pnpm dev` let a
// test read the dev/demo API's cached numbers — and let a dev worker pick up a test's jobs. A separate db index isolates
// all three without a second Redis or any app-code change. `.env.test` may set REDIS_URL explicitly (it must then name a
// non-zero db — test-setup.ts refuses db 0); otherwise the dev URL (shell, then .env, then the default) is reused with
// only its db index replaced. In CI, REDIS_URL comes from the job and gets the same treatment.
const TEST_REDIS_DB = 15;
function testRedisUrl(): string {
  if (testEnv.REDIS_URL) return testEnv.REDIS_URL;
  const devEnvPath = resolve(__dirname, ".env");
  const devEnv = existsSync(devEnvPath) ? (parseEnvFile({ path: devEnvPath, processEnv: {} }).parsed ?? {}) : {};
  const url = new URL(process.env.REDIS_URL ?? devEnv.REDIS_URL ?? "redis://localhost:6379");
  url.pathname = `/${TEST_REDIS_DB}`;
  return url.toString();
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Refuses cleanup calls whose filter is empty (an undefined id would otherwise delete every row): see src/test-guard.ts.
    setupFiles: ["./src/test-setup.ts"],
    testTimeout: 15000,
    // Some integration tests mutate genuinely global, single-row tables (CatalogSetting's SKU pattern,
    // GlobalSection's store-wide page-section defaults) that have no per-test namespacing — they ARE the
    // one store-wide setting. Vitest's default file-level parallelism runs test files in separate
    // workers against the same database, so one file's in-flight write to such a row was occasionally
    // visible to another file's read, producing an intermittent, file-varying failure (seen for both
    // product-media.integration.test.ts and product-sections.integration.test.ts, and once as a knock-on
    // in product-security.integration.test.ts's SKU-generate call). Running files sequentially removes
    // the race entirely; it costs real wall-clock time (~5x locally: ~4s parallel vs ~21s sequential for
    // this suite), accepted here because a correct 21s run beats an occasionally-flaky 4s one.
    fileParallelism: false,
    env: {
      // Tests must never call a real mail provider: with a live RESEND_API_KEY in a developer's .env, the customer tests
      // hit Resend over the network (which rejects example.com and is timing-dependent). An empty key — dotenv won't
      // override a defined variable — makes the mailer use its write-to-disk fallback, so the suite is hermetic.
      RESEND_API_KEY: "",
      // Vitest applies `test.env` before any test file (or its config/env.ts, which does `import "dotenv/config"`) runs,
      // so this wins over a plain .env without needing any import-order trick. Empty object when there is no .env.test:
      // tests then fall back to the ambient DATABASE_URL, exactly as before this file existed.
      ...testEnv,
      REDIS_URL: testRedisUrl(),
    },
  },
});
