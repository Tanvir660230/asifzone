/**
 * Step 2 of the demo-data mirror (docs/DEMO_DATA.md §3): rebuild the local demo database from a snapshot taken by
 * fetch-snapshot.ts. Idempotent — every run builds a fresh copy and swaps it in; the previous demo database (and any edits
 * made in it) is replaced.
 *
 *   1. restore the snapshot into <INSTALL_ID>_demo_staging (marked "demo-staging" — the API refuses to start on it);
 *   2. `prisma migrate deploy` — bring it to this checkout's schema (touches only the staging copy);
 *   3. sanitize.sql — anonymise people, drop credentials/tokens/queues (one transaction);
 *   4. rewrite-media.sql + extract the image archive into the local uploads dir;
 *   5. upsert the local demo OWNER (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD);
 *   6. assert the sanitization held — any leftover aborts the import;
 *   7. mark it "demo" and swap: DROP <INSTALL_ID>_demo, RENAME staging -> <INSTALL_ID>_demo;
 *   8. rebuild the storefront read model with this checkout's pricing engine.
 * On any failure the staging database is dropped, so unsanitized data never outlives a failed run.
 *
 *   pnpm --filter api demo:import                                   # latest snapshot in SNAPSHOT_DIR
 *   pnpm --filter api demo:import --snapshot <file.dump> [--uploads <file.tar.gz>] [--skip-media]
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { resolveSeedAdminCredentials } from "../../src/lib/seed-credentials";
import {
  API_DIR, DATABASE_ROLE_SETTING, DEMO_API_ORIGIN, DEMO_DATABASE, DEMO_IMPORTED_AT_SETTING, DEMO_SNAPSHOT_SETTING, DEMO_STAGING_DATABASE, MEDIA_SOURCE_HOSTS, REPORT_TABLES, SNAPSHOT_DIR, UPLOADS_DIR,
  databaseExists, demoDatabaseUrl, fail, isPgDumpArchive, latestFile, pgBin, pgEnv, psql, quoteIdent, quoteLiteral, run, tableCounts,
} from "./lib";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const snapshot = arg("--snapshot") ?? latestFile("asifzone-", ".dump");
const skipMedia = process.argv.includes("--skip-media");
const uploadsArchive = skipMedia ? null : arg("--uploads") ?? (snapshot ? snapshot.replace(/\.dump$/, ".uploads.tar.gz") : null);

const demoUrl = demoDatabaseUrl(DEMO_DATABASE);
const stagingUrl = demoDatabaseUrl(DEMO_STAGING_DATABASE);
const serverUrl = demoDatabaseUrl("postgres"); // maintenance connection for CREATE/DROP/RENAME DATABASE

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MEDIA_PATTERN = `https?://(${MEDIA_SOURCE_HOSTS.map(escapeRegex).join("|")})(:[0-9]+)?/uploads/`;

function step(message: string) {
  console.log(`[demo-data] ${message}`);
}

function dropStaging() {
  psql(serverUrl, `DROP DATABASE IF EXISTS ${quoteIdent(DEMO_STAGING_DATABASE)} WITH (FORCE)`);
}

/** Each check must return 0. Covers every class of data sanitize.sql is responsible for. */
const SANITIZATION_CHECKS: [string, string][] = [
  ["customer emails", `SELECT count(*) FROM "Customer" WHERE email IS NOT NULL AND email NOT LIKE '%@demo.invalid'`],
  ["customer passwords / Google links", `SELECT count(*) FROM "Customer" WHERE "passwordHash" IS NOT NULL OR "googleId" IS NOT NULL`],
  ["customer phones", `SELECT count(*) FROM "Customer" WHERE phone IS NOT NULL AND phone !~ '^019[0-9]{8}$'`],
  ["order emails", `SELECT count(*) FROM "Order" WHERE "customerEmail" IS NOT NULL AND "customerEmail" NOT LIKE '%@demo.invalid'`],
  ["order phones", `SELECT count(*) FROM "Order" WHERE "customerPhone" !~ '^019[0-9]{8}$'`],
  ["address phones", `SELECT count(*) FROM "Address" WHERE phone !~ '^019[0-9]{8}$'`],
  ["newsletter emails", `SELECT count(*) FROM "NewsletterSubscriber" WHERE email NOT LIKE '%@demo.invalid'`],
  ["staff logins", `SELECT count(*) FROM "AdminUser" WHERE email NOT LIKE '%@demo.invalid' AND email <> $ADMIN$`],
  [
    "tokens / sessions / push subscriptions",
    `SELECT (SELECT count(*) FROM "RefreshToken") + (SELECT count(*) FROM "CustomerRefreshToken") + (SELECT count(*) FROM "PasswordResetToken")
          + (SELECT count(*) FROM "EmailVerificationToken") + (SELECT count(*) FROM "CustomerClaim") + (SELECT count(*) FROM "PhoneOtp")
          + (SELECT count(*) FROM "AdminInvite") + (SELECT count(*) FROM "PushSubscription")`,
  ],
  ["queued outbox events", `SELECT count(*) FROM "OutboxEvent"`],
  ["gateway payloads", `SELECT (SELECT count(*) FROM "Payment" WHERE "rawResponse" IS NOT NULL) + (SELECT count(*) FROM "PaymentEvent" WHERE "rawResponse" IS NOT NULL) + (SELECT count(*) FROM "PaymentSession" WHERE "checkoutPayload" IS NOT NULL)`],
  ["scheduled campaigns", `SELECT count(*) FROM "Campaign" WHERE status IN ('SCHEDULED', 'SENDING')`],
  ["admin alert phones", `SELECT count(*) FROM "SmsNotificationSetting" WHERE "adminAlertPhones" <> ''`],
];

function report(before: Map<string, number | null> | null, source: Map<string, number | null>, after: Map<string, number | null>) {
  const rows = REPORT_TABLES.map((t) => ({
    table: t,
    "demo before": before ? (before.get(t) ?? "-") : "-",
    "source snapshot": source.get(t) ?? "-",
    "demo after": after.get(t) ?? "-",
  }));
  console.table(rows);
}

(async () => {
  if (!snapshot || !existsSync(snapshot)) fail(`no snapshot found (looked in ${SNAPSHOT_DIR}). Run: pnpm --filter api demo:fetch`);
  if (!isPgDumpArchive(snapshot)) fail(`${snapshot} is not a pg_dump custom-format archive`);
  if (uploadsArchive && !existsSync(uploadsArchive)) fail(`image archive ${uploadsArchive} not found — pass --uploads <file> or --skip-media`);

  step(`snapshot: ${snapshot}`);
  step(`target:   ${new URL(demoUrl).host}/${DEMO_DATABASE} (built as ${DEMO_STAGING_DATABASE}, then swapped in)`);

  const before = databaseExists(serverUrl, DEMO_DATABASE) ? tableCounts(demoUrl) : null;

  try {
    step("1/8 restoring snapshot into staging...");
    dropStaging();
    psql(serverUrl, `CREATE DATABASE ${quoteIdent(DEMO_STAGING_DATABASE)} TEMPLATE template0 ENCODING 'UTF8'`);
    psql(serverUrl, `ALTER DATABASE ${quoteIdent(DEMO_STAGING_DATABASE)} SET ${DATABASE_ROLE_SETTING} = 'demo-staging'`);
    run(pgBin("pg_restore"), ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", DEMO_STAGING_DATABASE, snapshot], { env: pgEnv(stagingUrl) });
    const source = tableCounts(stagingUrl);

    step("2/8 applying this checkout's migrations (staging copy only)...");
    run("npx", ["prisma", "migrate", "deploy"], {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: stagingUrl },
      shell: process.platform === "win32",
    });

    step("3/8 sanitizing personal data, credentials and queues...");
    run(pgBin("psql"), ["-X", "-q", "-1", "-v", "ON_ERROR_STOP=1", "-f", join(__dirname, "sanitize.sql")], { env: pgEnv(stagingUrl) });

    step(`4/8 pointing media at ${DEMO_API_ORIGIN}/uploads/ ...`);
    run(
      pgBin("psql"),
      ["-X", "-q", "-1", "-v", "ON_ERROR_STOP=1", "-v", `pattern=${MEDIA_PATTERN}`, "-v", `target=${DEMO_API_ORIGIN}/uploads/`, "-f", join(__dirname, "rewrite-media.sql")],
      { env: pgEnv(stagingUrl) },
    );
    if (uploadsArchive) {
      mkdirSync(UPLOADS_DIR, { recursive: true });
      // Windows' bundled bsdtar: a GNU tar earlier on PATH (Git Bash) would read "C:\..." as a remote host.
      const systemTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
      run(process.platform === "win32" && existsSync(systemTar) ? systemTar : "tar", ["-xzf", uploadsArchive, "-C", UPLOADS_DIR]);
      step(`    images extracted into ${UPLOADS_DIR}`);
      const prefix = `${DEMO_API_ORIGIN}/uploads/`;
      const urls = psql(stagingUrl, `SELECT url FROM "ProductImage" WHERE url LIKE ${quoteLiteral(`${prefix}%`)}`).split(/\r?\n/).filter(Boolean);
      const present = urls.filter((u) => existsSync(join(UPLOADS_DIR, ...u.slice(prefix.length).split("/")))).length;
      step(`    product image files present: ${present}/${urls.length}${present < urls.length ? " (missing files will show as broken images)" : ""}`);
    } else {
      step("    --skip-media: image files not copied (images will 404 until an archive is imported)");
    }

    step("5/8 creating the local demo OWNER login...");
    const admin = resolveSeedAdminCredentials();
    const prisma = new PrismaClient({ datasourceUrl: stagingUrl });
    try {
      const passwordHash = await bcrypt.hash(admin.password, 12);
      await prisma.adminUser.upsert({
        where: { email: admin.email },
        update: { passwordHash, role: "OWNER", isActive: true },
        create: { name: "Demo Owner", email: admin.email, passwordHash, role: "OWNER" },
      });
    } finally {
      await prisma.$disconnect();
    }

    step("6/8 verifying sanitization...");
    const failures: string[] = [];
    for (const [label, sql] of SANITIZATION_CHECKS) {
      const n = Number(psql(stagingUrl, sql.replace("$ADMIN$", quoteLiteral(admin.email))));
      if (n !== 0) failures.push(`${label}: ${n}`);
    }
    const leftoverMedia = Number(
      psql(
        stagingUrl,
        `SELECT count(*) FROM "ProductImage" WHERE url ~ ${quoteLiteral(MEDIA_PATTERN)}`,
      ),
    );
    if (leftoverMedia) failures.push(`product images still on the production origin: ${leftoverMedia}`);
    if (failures.length) throw new Error(`sanitization check failed — nothing was swapped in:\n  ${failures.join("\n  ")}`);

    step("7/8 swapping staging in as the demo database...");
    const importedAt = new Date().toISOString();
    psql(serverUrl, `ALTER DATABASE ${quoteIdent(DEMO_STAGING_DATABASE)} SET ${DATABASE_ROLE_SETTING} = 'demo'`);
    psql(serverUrl, `ALTER DATABASE ${quoteIdent(DEMO_STAGING_DATABASE)} SET ${DEMO_IMPORTED_AT_SETTING} = ${quoteLiteral(importedAt)}`);
    psql(serverUrl, `ALTER DATABASE ${quoteIdent(DEMO_STAGING_DATABASE)} SET ${DEMO_SNAPSHOT_SETTING} = ${quoteLiteral(basename(snapshot))}`);
    psql(
      serverUrl,
      `COMMENT ON DATABASE ${quoteIdent(DEMO_STAGING_DATABASE)} IS ${quoteLiteral(`DEMO mirror - sanitized copy of ${basename(snapshot)}, imported ${importedAt}. Independent of production.`)}`,
    );
    psql(serverUrl, `DROP DATABASE IF EXISTS ${quoteIdent(DEMO_DATABASE)} WITH (FORCE)`);
    psql(serverUrl, `ALTER DATABASE ${quoteIdent(DEMO_STAGING_DATABASE)} RENAME TO ${quoteIdent(DEMO_DATABASE)}`);

    step("8/8 rebuilding the storefront read model...");
    try {
      run("npx", ["tsx", "scripts/read-model-rebuild.ts"], {
        cwd: API_DIR,
        env: { ...process.env, DATABASE_URL: demoUrl, NODE_ENV: "development" },
        shell: process.platform === "win32",
      });
    } catch (err) {
      console.warn(`[demo-data] read-model rebuild reported a problem (demo data is still usable): ${(err as Error).message.split("\n")[0]}`);
    }

    const after = tableCounts(demoUrl);
    console.log("");
    report(before, source, after);
    console.log(`\n[demo-data] done. ${DEMO_DATABASE} is an independent, sanitized copy of ${basename(snapshot)}.`);
    console.log(`[demo-data] demo admin login: ${admin.email}${admin.usedDefaults ? ` / ${admin.password}` : " (password: SEED_ADMIN_PASSWORD)"}`);
    console.log(`[demo-data] point the API at it with DATABASE_URL=${demoUrl.replace(/:[^:@/]+@/, ":***@")}`);
  } catch (err) {
    try {
      dropStaging();
    } catch {
      // best effort — reported below
    }
    fail(`import failed, staging database dropped:\n${(err as Error).message}`);
  }
})();
