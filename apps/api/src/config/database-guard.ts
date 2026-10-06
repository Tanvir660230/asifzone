/**
 * Database-target safety (docs/DEMO_DATA.md §5). Two layers, so no development process can reach the production database and
 * the demo mirror can't be mistaken for anything else:
 *
 *   1. `applyDatabaseUrlPolicy` — synchronous, run by config/env.ts before any other module reads the environment:
 *        - outside NODE_ENV=production the DATABASE_URL host must be loopback. Production Postgres only exists on the VPS's
 *          private Docker network, so a dev/test process can never be pointed at it by a config slip;
 *        - production refuses the demo databases outright;
 *        - a process pointed at the demo database runs with live providers OFF (LIVE_PROVIDERS=off: SMS/email log locally,
 *          courier/payment/Meta calls are blocked) unless DEMO_LIVE_PROVIDERS=on is set explicitly.
 *   2. `verifyDatabaseRole` — async, run by server.ts once Prisma is connected: checks the database-level marker the demo
 *      import sets (`ALTER DATABASE … SET asifzone.environment = 'demo'`) agrees with the database name, and refuses a
 *      half-built import (`demo-staging`, which still holds unsanitized rows until the import finishes).
 */
export const DEMO_DATABASE = "asifzone_demo";
export const DEMO_STAGING_DATABASE = "asifzone_demo_staging";
export const DATABASE_ROLE_SETTING = "asifzone.environment";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface DatabaseTarget {
  host: string;
  database: string;
}

export function parseDatabaseTarget(url: string): DatabaseTarget | null {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname.toLowerCase(), database: decodeURIComponent(parsed.pathname.replace(/^\//, "")) };
  } catch {
    return null;
  }
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

function isDemoDatabase(database: string): boolean {
  return database === DEMO_DATABASE || database === DEMO_STAGING_DATABASE;
}

/** Throws when `url` is not an allowed target for `nodeEnv`; returns the parsed target otherwise. Mutates `environment` only
 * to switch live providers off for the demo database. */
export function applyDatabaseUrlPolicy(url: string, nodeEnv: string, environment: Record<string, string | undefined> = process.env): DatabaseTarget {
  const target = parseDatabaseTarget(url);
  if (!target) throw new Error("[database-guard] DATABASE_URL is not a valid connection URL");

  if (nodeEnv === "production") {
    if (isDemoDatabase(target.database)) {
      throw new Error(`[database-guard] refusing to start: NODE_ENV=production with the demo database "${target.database}"`);
    }
    return target;
  }

  if (!isLoopbackHost(target.host)) {
    throw new Error(
      `[database-guard] refusing to start: NODE_ENV="${nodeEnv}" may only use a database on this machine, but DATABASE_URL points at ` +
        `"${target.host}". Use the local demo database (${DEMO_DATABASE}, see docs/DEMO_DATA.md) instead of a remote one.`,
    );
  }
  if (target.database === DEMO_STAGING_DATABASE) {
    throw new Error(`[database-guard] refusing to start: "${DEMO_STAGING_DATABASE}" is a half-built demo import (may hold unsanitized data)`);
  }
  if (target.database === DEMO_DATABASE && environment.DEMO_LIVE_PROVIDERS !== "on") {
    environment.LIVE_PROVIDERS = "off";
  }
  return target;
}

type RawQueryClient = { $queryRawUnsafe<T = unknown>(query: string): Promise<T> };

/** Reads the marker and refuses an inconsistent combination. Returns the role ("demo" or null) for the startup log. */
export async function verifyDatabaseRole(client: RawQueryClient, nodeEnv: string): Promise<{ role: string | null; database: string; importedAt: string | null }> {
  const [row] = await client.$queryRawUnsafe<{ role: string | null; database: string; imported_at: string | null }[]>(
    `SELECT current_setting('${DATABASE_ROLE_SETTING}', true) AS role, current_database() AS database, ` +
      `current_setting('asifzone.demo_imported_at', true) AS imported_at`,
  );
  const role = row?.role || null;
  const database = row?.database ?? "";

  if (role === "demo-staging") throw new Error(`[database-guard] refusing to start: "${database}" is a half-built demo import`);
  if (role === "demo" && nodeEnv === "production") throw new Error(`[database-guard] refusing to start: NODE_ENV=production on the demo database "${database}"`);
  if (role === "demo" && database !== DEMO_DATABASE) {
    throw new Error(`[database-guard] refusing to start: "${database}" carries the demo marker but is not named ${DEMO_DATABASE} — live-provider isolation keys on the name`);
  }
  if (database === DEMO_DATABASE && role !== "demo") {
    throw new Error(`[database-guard] refusing to start: "${DEMO_DATABASE}" has no demo marker — it was not built by the demo import (pnpm --filter api demo:import)`);
  }
  return { role, database, importedAt: row?.imported_at || null };
}
