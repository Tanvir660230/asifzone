// One-off check of migration 20261206100000_return_follow_up_unify against stored configurations: runs the migration's
// own SQL on a scratch database (DATABASE_URL must name one ending in _migcheck) once per case.
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const url = process.env.DATABASE_URL ?? "";
if (!/_migcheck\?/.test(url)) throw new Error("DATABASE_URL must name a *_migcheck scratch database");
const prisma = new PrismaClient();
const sql = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261206100000_return_follow_up_unify/migration.sql"), "utf8");
const doBlock = sql.slice(sql.indexOf("DO $$"), sql.indexOf("END $$;") + "END $$;".length);
if (/DROP\s+COLUMN/i.test(sql.replace(/--.*$/gm, ""))) throw new Error("the migration must not drop a column");

const cases = [
  { name: "only the old setting changed → it moves across", businesses: [21], store: 14, expect: 21 },
  { name: "both changed → the Settings value stays", businesses: [21], store: 10, expect: 10 },
  { name: "old setting at its default → nothing changes", businesses: [14], store: 30, expect: 30 },
  { name: "no finance business → nothing changes", businesses: [], store: 14, expect: 14 },
  { name: "old value outside 3–60 → brought inside", businesses: [90], store: 14, expect: 60 },
  { name: "old value below 3 → brought inside", businesses: [1], store: 14, expect: 3 },
  { name: "two businesses disagree → nothing changes", businesses: [21, 30], store: 14, expect: 14 },
  { name: "no StoreSetting row yet → created with the old value", businesses: [21], store: null, expect: 21 },
];

(async () => {
  let failed = 0;
  for (const c of cases) {
    // fixtures only: the finance audit trigger stays off while the cases are set up, and is back on for the migration
    await prisma.$executeRawUnsafe('ALTER TABLE "FinanceBusiness" DISABLE TRIGGER USER');
    await prisma.$executeRawUnsafe('ALTER TABLE "FinanceBusiness" ADD COLUMN IF NOT EXISTS "returnFollowUpDays" INTEGER NOT NULL DEFAULT 14');
    await prisma.$executeRawUnsafe('DELETE FROM "FinanceBusiness" WHERE key LIKE \'migcheck-%\'');
    await prisma.$executeRawUnsafe('UPDATE "FinanceBusiness" SET "returnFollowUpDays" = 14');
    const others = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "FinanceBusiness"');
    if (others[0].n) throw new Error("scratch DB must have no FinanceBusiness rows of its own");
    for (const [i, d] of c.businesses.entries()) {
      await prisma.$executeRawUnsafe(`INSERT INTO "FinanceBusiness" (id, key, name, "baseCurrency", timezone, "returnFollowUpDays", "updatedAt") VALUES ('migcheck-${i}', 'migcheck-${i}', 'x', 'BDT', 'Asia/Dhaka', ${d}, NOW())`);
    }
    await prisma.$executeRawUnsafe('DELETE FROM "StoreSetting"');
    if (c.store !== null) await prisma.$executeRawUnsafe(`INSERT INTO "StoreSetting" (id, "returnNotBackDays", "updatedAt") VALUES ('singleton', ${c.store}, NOW())`);
    await prisma.$executeRawUnsafe('ALTER TABLE "FinanceBusiness" ENABLE TRIGGER USER');
    await prisma.$executeRawUnsafe(doBlock);
    const row = await prisma.$queryRawUnsafe('SELECT "returnNotBackDays" AS d FROM "StoreSetting" WHERE id = \'singleton\'');
    const got = row[0]?.d ?? null;
    const ok = got === c.expect;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}: returnNotBackDays = ${got} (expected ${c.expect})`);
  }
  await prisma.$disconnect();
  console.log(failed ? `${failed} failed` : `all ${cases.length} passed`);
  process.exit(failed ? 1 : 0);
})();
