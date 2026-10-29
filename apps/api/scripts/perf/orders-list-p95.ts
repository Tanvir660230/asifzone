/**
 * Order Operations phase 2 acceptance: the Orders list at 200 rows a page answers with p95 < 400 ms on the demo mirror.
 *
 *   DATABASE_URL=<a COPY of the demo mirror> LIVE_PROVIDERS=off npx tsx scripts/perf/orders-list-p95.ts [--runs 40] [--scale 20]
 *
 * Calls GET /api/orders through the real app (auth, validation, list mapping, JSON) as the first active OWNER, over the
 * views an operator actually uses: the default list (latest activity), a deep page, a queue, a status filter and a
 * search. `--scale N` first multiplies the database's orders (with their items) N times so the volume is closer to
 * production — refused unless the database name ends in "_p2"/"_perf"/"_test", so it can never run on a real store.
 */
import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/config/prisma";
import { signAccessToken } from "../../src/lib/jwt";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const RUNS = arg("runs", 40);
const SCALE = arg("scale", 0);

async function scale(times: number) {
  const db = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (!/_(p2|perf|test)$/.test(db)) throw new Error(`--scale refuses database "${db}" — use a disposable copy (…_p2 / …_perf / …_test)`);
  for (let n = 1; n <= times; n++) {
    // New ids/numbers/keys per copy; everything else (status, dates, money) as the original, items alongside.
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Order" SELECT (jsonb_populate_record(NULL::"Order", to_jsonb(o) || jsonb_build_object(
        'id', o.id || '_x${n}', 'orderNumber', o."orderNumber" || '-X${n}', 'idempotencyKey', NULL, 'trackingNumber', NULL,
        'courierConsignmentId', NULL, 'customerId', NULL, 'sessionId', NULL))).*
      FROM "Order" o WHERE o.id NOT LIKE '%\\_x%'`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "OrderItem" SELECT (jsonb_populate_record(NULL::"OrderItem", to_jsonb(i) || jsonb_build_object(
        'id', i.id || '_x${n}', 'orderId', i."orderId" || '_x${n}'))).*
      FROM "OrderItem" i WHERE i."orderId" NOT LIKE '%\\_x%'`);
  }
}

function p(sorted: number[], q: number) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
}

async function main() {
  if (SCALE > 0) await scale(SCALE);
  const owner = await prisma.adminUser.findFirstOrThrow({ where: { role: "OWNER", isActive: true }, select: { id: true } });
  const cookie = [`access_token=${signAccessToken({ adminId: owner.id, role: "OWNER" })}`];
  const total = await prisma.order.count({ where: { deletedAt: null } });
  const lastPage = Math.max(1, Math.ceil(total / 200));
  const views = [
    "pageSize=200",
    "pageSize=200&sortBy=statusChangedAt&sortDir=desc",
    `pageSize=200&page=${lastPage}`,
    "pageSize=200&needsAction=true",
    "pageSize=200&statusIn=CONFIRMED,PROCESSING,PACKED&courierBooked=false",
    "pageSize=200&status=DELIVERED",
    "pageSize=200&search=01",
    // The daily work list (finished orders left out) and Order history — the default views of the two pages.
    "pageSize=200&scope=active&sortBy=statusChangedAt&sortDir=desc",
    "pageSize=200&scope=history&sortBy=statusChangedAt&sortDir=desc",
    "pageSize=200&scope=history&status=CANCELLED&sortBy=statusChangedAt&sortDir=desc",
    "pageSize=200&scope=history&search=01",
  ];
  // Warm-up (connection pool, query plans).
  for (const v of views) await request(app).get(`/api/orders?${v}`).set("Cookie", cookie);

  const all: number[] = [];
  for (const v of views) {
    const times: number[] = [];
    let rows = 0;
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      const res = await request(app).get(`/api/orders?${v}`).set("Cookie", cookie);
      times.push(performance.now() - t);
      if (res.status !== 200) throw new Error(`${v} → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
      rows = res.body.items.length;
    }
    times.sort((a, b) => a - b);
    all.push(...times);
    console.log(`${v.padEnd(72)} rows ${String(rows).padStart(3)}  p50 ${p(times, 0.5).toFixed(0)} ms  p95 ${p(times, 0.95).toFixed(0)} ms`);
  }
  all.sort((a, b) => a - b);
  const p95 = p(all, 0.95);
  console.log(`\n${total} live orders · ${all.length} requests · overall p50 ${p(all, 0.5).toFixed(0)} ms · p95 ${p95.toFixed(0)} ms → ${p95 < 400 ? "PASS" : "FAIL"} (< 400 ms)`);
  await prisma.$disconnect();
  process.exit(p95 < 400 ? 0 : 1);
}

void main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
