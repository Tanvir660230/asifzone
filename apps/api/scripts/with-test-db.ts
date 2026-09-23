/**
 * Runs the given command with DATABASE_URL pointed at apps/api/.env.test's database instead of the
 * ambient one (a developer's real dev database, or nothing at all). Used by the `db:test:*` package
 * scripts so `prisma migrate deploy`/`prisma studio` don't need to know `.env.test` exists.
 *
 * See .env.test.example for what this is for and how to set one up. Run with tsx, like the other
 * one-off scripts in this package (prisma/seed.ts, prisma/seed-presets.ts):
 *   tsx scripts/with-test-db.ts <command> [...args]
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const envPath = resolve(__dirname, "..", ".env.test");

if (!existsSync(envPath)) {
  console.error(
    "apps/api/.env.test not found.\n" +
      "Copy .env.test.example to .env.test (pointing at a database you don't mind wiping — e.g. clothing_brand_test)\n" +
      "and try again. See .env.test.example for the one-time setup steps.",
  );
  process.exit(1);
}

const parsed = config({ path: envPath, processEnv: {} }).parsed ?? {};
const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: tsx scripts/with-test-db.ts <command> [...args]");
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ...parsed },
});
process.exit(result.status ?? 1);
