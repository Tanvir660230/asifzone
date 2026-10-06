/**
 * Shared plumbing for the demo-data mirror (docs/DEMO_DATA.md): where snapshots live, how the source is reached, which
 * local database is the target, and the Postgres client binaries.
 *
 * The SOURCE (production) is never given a connection string anywhere in this repo. It is reached only by fetch-snapshot.ts
 * through SSH + `pg_dump` in a read-only session. Everything else here talks to the local demo TARGET.
 */
import { config } from "dotenv";
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import {
  DATABASE_ROLE_SETTING,
  DEMO_DATABASE,
  DEMO_IMPORTED_AT_SETTING,
  DEMO_SNAPSHOT_SETTING,
  DEMO_STAGING_DATABASE,
  isLoopbackHost,
  parseDatabaseTarget,
} from "../../src/config/database-guard";

export const API_DIR = resolve(__dirname, "..", "..");
// Reads apps/api/.env without overriding anything already exported in the shell.
config({ path: join(API_DIR, ".env") });

export { DATABASE_ROLE_SETTING, DEMO_DATABASE, DEMO_IMPORTED_AT_SETTING, DEMO_SNAPSHOT_SETTING, DEMO_STAGING_DATABASE };

/** Raw snapshots hold unsanitized production data — kept OUTSIDE the repo (which lives in a cloud-synced folder). */
export const SNAPSHOT_DIR = process.env.DEMO_SNAPSHOT_DIR || join(homedir(), ".asifzone-demo", "snapshots");

export const SOURCE = {
  ssh: process.env.DEMO_SOURCE_SSH || "root@187.77.137.12",
  sshKey: process.env.DEMO_SOURCE_SSH_KEY || join(homedir(), ".ssh", "asifzone_vps"),
  composeDir: process.env.DEMO_SOURCE_COMPOSE_DIR || "/opt/asifzone/docker",
  database: process.env.DEMO_SOURCE_DATABASE || "clothing_brand",
};

/** Origins that production stored uploaded-image URLs under; rewritten to the demo API origin on import. */
export const MEDIA_SOURCE_HOSTS = (process.env.DEMO_MEDIA_SOURCE_HOSTS || "asifzone.com,www.asifzone.com,187.77.137.12,187.127.217.33")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

export const DEMO_API_ORIGIN = (process.env.API_ORIGIN || "http://localhost:4000").replace(/\/$/, "");
export const UPLOADS_DIR = resolve(API_DIR, process.env.UPLOADS_DIR || "uploads");

export function fail(message: string): never {
  console.error(`\n[demo-data] ${message}`);
  process.exit(1);
}

/** The demo connection URL: DEMO_DATABASE_URL, else DATABASE_URL's server with the database name swapped. Refuses anything
 * that isn't a loopback host — the target is always this machine. */
export function demoDatabaseUrl(database: string = DEMO_DATABASE): string {
  const base = process.env.DEMO_DATABASE_URL || process.env.DATABASE_URL;
  if (!base) fail("set DEMO_DATABASE_URL (or DATABASE_URL) in apps/api/.env — see docs/DEMO_DATA.md");
  const url = new URL(base);
  const target = parseDatabaseTarget(base);
  if (!target || !isLoopbackHost(target.host)) fail(`the demo target must be a local database; got host "${target?.host ?? "?"}"`);
  url.pathname = `/${database}`;
  return url.toString();
}

/** PG* environment for the client binaries — keeps the password off the command line. */
export function pgEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username || "postgres"),
    PGPASSWORD: decodeURIComponent(url.password || process.env.PGPASSWORD || ""),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

/** pg_restore / psql: PG_BIN_DIR, then PATH, then the standard Windows install locations. */
export function pgBin(name: "psql" | "pg_restore"): string {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const candidates = [process.env.PG_BIN_DIR && join(process.env.PG_BIN_DIR, exe)];
  if (process.platform === "win32") {
    for (const v of ["18", "17", "16"]) candidates.push(`C:\\Program Files\\PostgreSQL\\${v}\\bin\\${exe}`);
  }
  for (const c of candidates) if (c && existsSync(c)) return c;
  const probe = spawnSync(exe, ["--version"], { encoding: "utf8" });
  if (probe.status === 0) return exe;
  return fail(`${name} not found — install the PostgreSQL client tools (16+) or set PG_BIN_DIR`);
}

export function run(command: string, args: string[], options: SpawnSyncOptions = {}): string {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ""} exited ${result.status}\n${String(result.stderr ?? "").trim()}`);
  }
  return String(result.stdout ?? "");
}

/** Runs SQL through psql against `databaseUrl`; returns unaligned, tuples-only output. */
export function psql(databaseUrl: string, sql: string): string {
  return run(pgBin("psql"), ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql], { env: pgEnv(databaseUrl) }).trim();
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A custom-format pg_dump archive starts with the bytes "PGDMP". */
export function isPgDumpArchive(file: string): boolean {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(5);
    readSync(fd, buf, 0, 5, 0);
    return buf.toString("latin1") === "PGDMP";
  } finally {
    closeSync(fd);
  }
}

export function latestFile(prefix: string, suffix: string): string | null {
  if (!existsSync(SNAPSHOT_DIR)) return null;
  const files = readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .map((f) => join(SNAPSHOT_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

/** The tables reported before/after an import — catalog first, then the (sanitized) operational data. */
export const REPORT_TABLES = [
  "Product", "ProductVariant", "ProductImage", "Category", "ProductTypeDef", "ProductTemplate", "AttributeDefinition",
  "ProductAttributeValue", "Material", "SizeGuidePreset", "CareGuidePreset", "ProductSection", "ProductFaq", "Banner",
  "HomepageSection", "Coupon", "FlashSale", "Bundle", "ProductReadModel", "Customer", "Address", "Order", "OrderItem",
  "Payment", "ProductReview", "AdminUser", "AuditLog",
];

export function tableCounts(databaseUrl: string): Map<string, number | null> {
  const selects = REPORT_TABLES.map(
    (t) => `SELECT ${quoteLiteral(t)}, CASE WHEN to_regclass(${quoteLiteral(`public.${quoteIdent(t)}`)}) IS NULL THEN NULL ELSE (xpath('/row/c/text()', query_to_xml(${quoteLiteral(`SELECT count(*) AS c FROM ${quoteIdent(t)}`)}, false, true, '')))[1]::text::bigint END`,
  );
  const out = psql(databaseUrl, selects.join(" UNION ALL "));
  const counts = new Map<string, number | null>();
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const [table, count] = line.split("|");
    counts.set(table!, count ? Number(count) : null);
  }
  return counts;
}

export function databaseExists(serverUrl: string, database: string): boolean {
  return psql(serverUrl, `SELECT 1 FROM pg_database WHERE datname = ${quoteLiteral(database)}`) === "1";
}
