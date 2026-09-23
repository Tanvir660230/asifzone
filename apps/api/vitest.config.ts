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
    },
  },
});
