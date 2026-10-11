/**
 * Two-installation isolation proof (docs/BUSINESS_DECISIONS.md D17–D21, docs/STORE_DEPLOYMENT.md "Several installations").
 *
 * Starts two real API processes from this checkout — installation `iso-a` and installation `iso-b` — each on its own
 * disposable database, both on ONE shared Redis, deliberately with the SAME JWT secrets (the misconfiguration the token
 * audience exists for). Then it drives both through HTTP and checks that neither store can see, use or disturb the other's
 * products, orders, customers, admins, analytics, cache entries, locks or queues.
 *
 *   pnpm --filter api test:installations
 *
 * Disposable resources only: the two databases `iso_store_a` / `iso_store_b` are created on the loopback Postgres from
 * `.env.test` (or ISO_PG_URL) and dropped afterwards; the Redis logical database (ISO_REDIS_URL, default `.env.test`'s
 * server, db 9) must be empty when the run starts and is left empty. Never points at a non-loopback host.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import dotenv from "dotenv";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const API_DIR = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(API_DIR, ".env.test") });

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
function loopbackUrl(raw: string | undefined, what: string): URL {
  if (!raw) throw new Error(`${what} is not set (ISO_PG_URL / ISO_REDIS_URL or apps/api/.env.test)`);
  const url = new URL(raw);
  if (!LOOPBACK.has(url.hostname)) throw new Error(`${what} must be a loopback host — refusing ${url.hostname}`);
  return url;
}

const pgBase = loopbackUrl(process.env.ISO_PG_URL ?? process.env.DATABASE_URL, "Postgres URL");
const redisUrl = loopbackUrl(process.env.ISO_REDIS_URL ?? process.env.REDIS_URL, "Redis URL");
if (!process.env.ISO_REDIS_URL) redisUrl.pathname = "/9";
const dbUrl = (name: string) => {
  const u = new URL(pgBase.toString());
  u.pathname = `/${name}`;
  return u.toString();
};

const OWNER = { email: "owner@iso.test", password: "Iso-Owner-2026!" };
const SHARED_SECRETS = {
  JWT_ACCESS_SECRET: "iso-shared-access-secret-on-purpose",
  JWT_CUSTOMER_ACCESS_SECRET: "iso-shared-customer-access-secret-on-purpose",
  JWT_CUSTOMER_REFRESH_SECRET: "iso-shared-customer-refresh-secret-on-purpose",
};

interface Store {
  key: "A" | "B";
  installId: string;
  database: string;
  port: number;
  base: string;
  db: PrismaClient;
  proc?: ChildProcess;
  log: string[];
}

const stores: Store[] = (
  [
    ["A", "iso-a", "iso_store_a", 4411],
    ["B", "iso-b", "iso_store_b", 4412],
  ] as const
).map(([key, installId, database, port]) => ({
  key,
  installId,
  database,
  port,
  base: `http://127.0.0.1:${port}`,
  db: new PrismaClient({ datasources: { db: { url: dbUrl(database) } } }),
  log: [],
}));
const [A, B] = stores as [Store, Store];

// ── tiny HTTP client with a cookie jar per actor ────────────────────────────────────────────────
// Response bodies are whatever each endpoint returns; the checks read a field or two from them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
function parseBody(text: string): Body {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

class Actor {
  cookies = new Map<string, string>();
  constructor(readonly label: string) {}
  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async call(store: Store, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const csrf = this.cookies.get("csrf_token");
    const res = await fetch(`${store.base}${url}`, {
      method,
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://localhost:${store.port}`,
        ...(this.cookies.size ? { Cookie: this.cookieHeader() } : {}),
        ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair!.indexOf("=");
      const name = pair!.slice(0, i).trim();
      const value = pair!.slice(i + 1).trim();
      if (value === "" || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    return { status: res.status, body: parseBody(text) };
  }
}

// ── checks ───────────────────────────────────────────────────────────────────────────────────────
const results: Array<{ area: string; check: string; ok: boolean; detail?: string }> = [];
function check(area: string, name: string, ok: boolean, detail?: string) {
  results.push({ area, check: name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  [${area}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── lifecycle ────────────────────────────────────────────────────────────────────────────────────
async function withMaintenance<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const admin = new PrismaClient({ datasources: { db: { url: dbUrl("postgres") } } });
  try {
    return await fn(admin);
  } finally {
    await admin.$disconnect();
  }
}

async function dropDatabases() {
  await withMaintenance(async (m) => {
    for (const s of stores) {
      if (!/^iso_store_[ab]$/.test(s.database)) throw new Error(`refusing to drop ${s.database}`);
      await m.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${s.database}" WITH (FORCE)`);
    }
  });
}

async function prepareDatabases() {
  await dropDatabases();
  await withMaintenance(async (m) => {
    for (const s of stores) await m.$executeRawUnsafe(`CREATE DATABASE "${s.database}"`);
  });
  for (const s of stores) {
    const env = { ...process.env, DATABASE_URL: dbUrl(s.database), NODE_ENV: "development", SEED_ADMIN_EMAIL: OWNER.email, SEED_ADMIN_PASSWORD: OWNER.password };
    execSync("npx prisma migrate deploy", { cwd: API_DIR, env, stdio: "pipe" });
    execSync("npx tsx prisma/seed.ts", { cwd: API_DIR, env, stdio: "pipe" });
  }
}

function startServer(s: Store) {
  const tsxCli = require.resolve("tsx/cli", { paths: [API_DIR] });
  s.proc = spawn(process.execPath, [tsxCli, "src/server.ts"], {
    cwd: API_DIR,
    env: {
      ...process.env,
      ...SHARED_SECRETS,
      NODE_ENV: "development",
      PORT: String(s.port),
      INSTALL_ID: s.installId,
      DATABASE_URL: dbUrl(s.database),
      REDIS_URL: redisUrl.toString(),
      LIVE_PROVIDERS: "off",
      WEB_ORIGIN: `http://localhost:${s.port}`,
      API_ORIGIN: s.base,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (d: Buffer) => {
    s.log.push(d.toString());
    if (s.log.length > 200) s.log.shift();
  };
  s.proc.stdout?.on("data", keep);
  s.proc.stderr?.on("data", keep);
}

async function waitHealthy(s: Store) {
  for (let i = 0; i < 120; i++) {
    if (s.proc?.exitCode !== null && s.proc?.exitCode !== undefined) throw new Error(`store ${s.key} exited:\n${s.log.join("")}`);
    const ok = await fetch(`${s.base}/health`).then((r) => r.ok, () => false);
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`store ${s.key} did not become healthy:\n${s.log.join("")}`);
}

function stopServer(s: Store) {
  if (!s.proc?.pid || s.proc.exitCode !== null) return;
  if (process.platform === "win32") execSync(`taskkill /pid ${s.proc.pid} /T /F`, { stdio: "ignore" });
  else s.proc.kill("SIGTERM");
}

async function redisKeys(redis: IORedis): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", "*", "COUNT", 500);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

// ── the proof ────────────────────────────────────────────────────────────────────────────────────
async function prove(redis: IORedis) {
  const RUN = Date.now().toString(36);
  const ownerA = new Actor("owner A");
  const ownerB = new Actor("owner B");

  // Admins: the same owner credentials exist in both stores (one person running two stores), yet sessions never cross.
  check("admins", "owner logs in to store A", (await ownerA.call(A, "POST", "/api/auth/login", OWNER)).status === 200);
  check("admins", "owner logs in to store B", (await ownerB.call(B, "POST", "/api/auth/login", OWNER)).status === 200);
  const meA = await ownerA.call(A, "GET", "/api/auth/me");
  check("admins", "store A session works on store A", meA.status === 200);
  check("admins", "store A's admin session is refused by store B", (await ownerA.call(B, "GET", "/api/auth/me")).status === 401);

  // Worst case for tokens: store B holds an admin row with the SAME id as store A's owner (e.g. restored from a copy).
  // Shared secrets + same id would let A's token in — the installation audience is what refuses it.
  const ownerAId: string = meA.body?.admin?.id ?? meA.body?.id;
  await B.db.adminUser.create({ data: { id: ownerAId, email: `twin-${RUN}@iso.test`, name: "Same-id twin", passwordHash: await bcrypt.hash("Twin-Admin-2026!", 10), role: "OWNER" } });
  const twin = await ownerA.call(B, "GET", "/api/auth/me");
  check("admins", "store A's token is refused by store B even when B has an admin with the same id", twin.status === 401, `status ${twin.status}`);

  // STAFF of store A only.
  await A.db.adminUser.create({ data: { email: `staff-${RUN}@iso.test`, name: "Staff A", passwordHash: await bcrypt.hash("Iso-Staff-2026!", 10), role: "STAFF" } });
  const staff = new Actor("staff A");
  check("admins", "store A staff logs in to store A", (await staff.call(A, "POST", "/api/auth/login", { email: `staff-${RUN}@iso.test`, password: "Iso-Staff-2026!" })).status === 200);
  check("admins", "store A staff cannot log in to store B", (await new Actor("x").call(B, "POST", "/api/auth/login", { email: `staff-${RUN}@iso.test`, password: "Iso-Staff-2026!" })).status === 401);
  check("admins", "store A staff session is refused by store B", (await staff.call(B, "GET", "/api/auth/me")).status === 401);

  // Products: each store gets its own product; neither can read the other's.
  const mkProduct = async (s: Store, tag: string) => {
    const category = await s.db.category.findFirstOrThrow({ where: { deletedAt: null } });
    return s.db.product.create({
      data: { name: `Only in ${tag} ${RUN}`, slug: `only-${tag.toLowerCase()}-${RUN}`, categoryId: category.id, basePrice: 777, status: "PUBLISHED", isActive: true, variants: { create: [{ sku: `ISO-${tag}-${RUN}`, size: "M", color: "Black", stock: 0 }] } },
    });
  };
  const productA = await mkProduct(A, "A");
  const productB = await mkProduct(B, "B");
  const guest = new Actor("guest");
  check("products", "store A serves its own product", (await guest.call(A, "GET", `/api/products/slug/${productA.slug}`)).status === 200);
  check("products", "store B cannot read store A's product", (await guest.call(B, "GET", `/api/products/slug/${productA.slug}`)).status === 404);
  check("products", "store A cannot read store B's product", (await guest.call(A, "GET", `/api/products/slug/${productB.slug}`)).status === 404);

  // Customers: separate identities; A's session and credentials mean nothing to B.
  const custA = new Actor("customer A");
  const custB = new Actor("customer B");
  const regA = await custA.call(A, "POST", "/api/customers/register", { name: "Customer A", email: `cust-a-${RUN}@iso.test`, password: "Iso-Cust-2026!" });
  const regB = await custB.call(B, "POST", "/api/customers/register", { name: "Customer B", email: `cust-b-${RUN}@iso.test`, password: "Iso-Cust-2026!" });
  check("customers", "customer registers on store A", regA.status === 201 || regA.status === 200, `status ${regA.status}`);
  check("customers", "customer registers on store B", regB.status === 201 || regB.status === 200, `status ${regB.status}`);
  const meCustA = await custA.call(A, "GET", "/api/customers/me");
  check("customers", "store A customer session works on store A", meCustA.status === 200);
  check("customers", "store A customer session is refused by store B", (await custA.call(B, "GET", "/api/customers/me")).status === 401);
  check("customers", "store A customer credentials do not log in to store B", (await new Actor("x").call(B, "POST", "/api/customers/login", { email: `cust-a-${RUN}@iso.test`, password: "Iso-Cust-2026!" })).status === 401);
  const custAId: string = meCustA.body?.customer?.id ?? meCustA.body?.id;
  check("customers", "store A admin opens store A's customer", (await ownerA.call(A, "GET", `/api/customers/admin/${custAId}`)).status === 200);
  const crossCustomer = await ownerB.call(B, "GET", `/api/customers/admin/${custAId}`);
  check("customers", "store B admin cannot open store A's customer", crossCustomer.status === 404, `status ${crossCustomer.status}`);
  // Same worst case as for admins: B holds a customer with A's customer id.
  await B.db.customer.create({ data: { id: custAId, name: "Same-id twin", email: `twin-cust-${RUN}@iso.test` } });
  const custTwin = await custA.call(B, "GET", "/api/customers/me");
  check("customers", "store A customer token is refused by store B even when B has a customer with the same id", custTwin.status === 401, `status ${custTwin.status}`);

  // Orders + locks: the same Idempotency-Key in both stores; store A's order lock is held — only store A waits on it.
  const variantA = await A.db.productVariant.findFirstOrThrow({ where: { sku: "DEMO-TEE-M-BLK" } });
  const checkout = (variantId: string) => ({ items: [{ variantId, quantity: 1 }], customerName: "Iso Buyer", customerPhone: "01712345678", shippingDivision: "Dhaka", shippingDistrict: "Dhaka", shippingArea: "Uttara", shippingAddressLine: "House 1", paymentMethod: "COD" });
  const IDEM = `iso-idem-${RUN}`;
  const lockA = `install:${A.installId}:lock:order-idem:${IDEM}`;
  await redis.set(lockA, "1", "PX", 10_000);
  const variantB = await B.db.productVariant.findFirstOrThrow({ where: { sku: "DEMO-TEE-M-BLK" } });
  let t = Date.now();
  const orderB = await custB.call(B, "POST", "/api/orders", checkout(variantB.id), { "Idempotency-Key": IDEM });
  const bMs = Date.now() - t;
  check("locks", "store B places an order with the same Idempotency-Key without waiting on store A's lock", orderB.status === 201 && bMs < 2_500, `status ${orderB.status}, ${bMs}ms`);
  t = Date.now();
  const orderA = await custA.call(A, "POST", "/api/orders", checkout(variantA.id), { "Idempotency-Key": IDEM });
  const aMs = Date.now() - t;
  check("locks", "store A's own request does wait on store A's lock", orderA.status === 201 && aMs >= 2_500, `status ${orderA.status}, ${aMs}ms`);
  await redis.del(lockA);
  const orderAId: string = orderA.body?.order?.id;
  const orderBId: string = orderB.body?.order?.id;
  check("orders", "the two orders are different records", Boolean(orderAId && orderBId && orderAId !== orderBId));
  check("orders", "store A admin sees store A's order", (await ownerA.call(A, "GET", `/api/orders/${orderAId}`)).status === 200);
  check("orders", "store B admin cannot open store A's order", (await ownerB.call(B, "GET", `/api/orders/${orderAId}`)).status === 404);
  check("orders", "store A customer cannot open store B's order on store A", (await custA.call(A, "GET", `/api/customers/me/orders/${orderBId}`)).status === 404);
  const crossVariant = await custB.call(B, "POST", "/api/orders", checkout(variantA.id), { "Idempotency-Key": `iso-x-${RUN}` });
  check("orders", "store B refuses to sell store A's variant", crossVariant.status >= 400 && crossVariant.status < 500, `status ${crossVariant.status}`);
  check("orders", "store B's database holds no trace of store A's order", (await B.db.order.count({ where: { id: orderAId } })) === 0 && (await B.db.outboxEvent.count({ where: { aggregateId: orderAId } })) === 0);
  check("orders", "store A recorded its order's outbox intents in its own database", (await A.db.outboxEvent.count({ where: { aggregateId: orderAId } })) > 0);

  // Analytics + cache: store A fills its cache first; store B (same logical cache keys, same Redis) must compute its own.
  await guest.call(A, "POST", `/api/products/${productA.id}/view`, {});
  const viewedA = await ownerA.call(A, "GET", "/api/analytics/most-viewed-products?days=7&limit=10");
  const viewedB = await ownerB.call(B, "GET", "/api/analytics/most-viewed-products?days=7&limit=10");
  const ids = (r: { body: Body }) => JSON.stringify(r.body).match(/c[a-z0-9]{24}/g) ?? [];
  check("analytics", "store A's most-viewed list includes its viewed product", viewedA.status === 200 && ids(viewedA).includes(productA.id), `status ${viewedA.status}`);
  check("analytics", "store B's most-viewed list (read after A cached) never shows store A's product", viewedB.status === 200 && !ids(viewedB).includes(productA.id));
  // Store A takes a second order, so the two stores' dashboards must now differ; A's is computed (and cached) first.
  const second = await custA.call(A, "POST", "/api/orders", checkout(variantA.id), { "Idempotency-Key": `iso-second-${RUN}` });
  const sumA = await ownerA.call(A, "GET", "/api/analytics/summary");
  const sumB = await ownerB.call(B, "GET", "/api/analytics/summary");
  check(
    "analytics",
    "dashboard summaries are each store's own (A: 2 orders, B: 1)",
    second.status === 201 && sumA.status === 200 && sumB.status === 200 && JSON.stringify(sumA.body) !== JSON.stringify(sumB.body),
    `A ${JSON.stringify(sumA.body).slice(0, 120)} | B ${JSON.stringify(sumB.body).slice(0, 120)}`,
  );

  const settingsB0 = (await guest.call(B, "GET", "/api/settings")).body;
  const rename = await ownerA.call(A, "PATCH", "/api/settings", { storeName: `Store A ${RUN}` });
  check("cache", "store A renames itself", rename.status === 200, `status ${rename.status}`);
  const settingsA1 = (await guest.call(A, "GET", "/api/settings")).body;
  const settingsB1 = (await guest.call(B, "GET", "/api/settings")).body;
  const nameOf = (s: Body) => s?.storeName ?? s?.settings?.storeName;
  check("cache", "store A serves its new name", nameOf(settingsA1) === `Store A ${RUN}`);
  check("cache", "store B's cached settings are untouched by store A's write and invalidation", nameOf(settingsB1) === nameOf(settingsB0) && nameOf(settingsB1) !== `Store A ${RUN}`);
  check("cache", "both stores hold their own settings cache entry", (await redis.exists(`install:${A.installId}:cache:settings:singleton`, `install:${B.installId}:cache:settings:singleton`)) === 2);

  // Queues: every key in the shared Redis belongs to exactly one installation; both run their own BullMQ queues.
  await sleep(1_500);
  const keys = await redisKeys(redis);
  const stray = keys.filter((k) => !k.startsWith(`install:${A.installId}:`) && !k.startsWith(`install:${B.installId}:`));
  check("queues", "every Redis key is inside one installation's namespace", stray.length === 0, stray.length ? `stray: ${stray.slice(0, 5).join(", ")}` : `${keys.length} keys`);
  const queuesOf = (s: Store) => new Set(keys.filter((k) => k.startsWith(`install:${s.installId}:bull:`)).map((k) => k.split(":")[3]));
  const qa = queuesOf(A);
  const qb = queuesOf(B);
  check("queues", "store A runs its own BullMQ queues", qa.size > 0, [...qa].sort().join(", "));
  check("queues", "store B runs its own BullMQ queues", qb.size > 0, [...qb].sort().join(", "));
  const bQueueKeys = keys.filter((k) => k.startsWith(`install:${B.installId}:bull:`));
  let bSeesA = false;
  for (const k of bQueueKeys) {
    const type = await redis.type(k);
    const dump = type === "hash" ? JSON.stringify(await redis.hgetall(k)) : type === "string" ? await redis.get(k) : "";
    if (dump?.includes(orderAId)) bSeesA = true;
  }
  check("queues", "no store B queue/job references store A's order", !bSeesA);
}

async function main() {
  const redis = new IORedis(redisUrl.toString(), { maxRetriesPerRequest: 1 });
  const before = await redis.dbsize();
  if (before > 0) throw new Error(`Redis ${redisUrl} db ${redisUrl.pathname} is not empty (${before} keys) — pick an empty ISO_REDIS_URL`);
  console.log(`two-installation isolation: Postgres ${pgBase.host} (iso_store_a, iso_store_b), shared Redis ${redisUrl.host}${redisUrl.pathname}`);
  let failed = false;
  try {
    console.log("· creating, migrating and seeding the two disposable databases");
    await prepareDatabases();
    console.log("· starting both installations");
    stores.forEach(startServer);
    await Promise.all(stores.map(waitHealthy));
    await prove(redis);
  } catch (err) {
    failed = true;
    console.error("run aborted:", err);
  } finally {
    stores.forEach(stopServer);
    await Promise.all(stores.map((s) => s.db.$disconnect()));
    await sleep(1_000);
    await dropDatabases().catch((e) => console.error("drop failed:", e));
    const left = await redisKeys(redis);
    if (left.length) await redis.del(...left.filter((k) => k.startsWith("install:iso-a:") || k.startsWith("install:iso-b:")));
    console.log(`· cleaned up: databases dropped, Redis keys left: ${await redis.dbsize()}`);
    await redis.quit();
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} isolation checks passed`);
  process.exit(failed || bad.length ? 1 : 0);
}

void main();
